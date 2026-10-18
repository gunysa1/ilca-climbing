// Error reporting for the staff app (the viewer never writes, so it does not report). Unexpected
// errors (window error, unhandled rejection, the React error boundary) and the judge pad's permanent
// save failures go to the `report_client_error` RPC; admins read them on admin/errors.
//  * Never while signed out (dropped, not kept).
//  * The same message is sent once a minute.
//  * Offline: up to 20 wait in memory and go when the browser is back online.
//  * Reporting never throws and never reports its own failures.
import { supabase } from './supabase';

export interface ErrorReport {
  message: string;
  stack?: string;
  path?: string;
  context?: Record<string, unknown>;
}

export type SendReport = (report: ErrorReport & { app: string; build: string; userAgent: string }) => Promise<boolean>;

export const DEDUPE_MS = 60_000;
export const OFFLINE_KEEP = 20;
/** Browser noise that is not a bug of ours. */
const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i];

export interface ReporterOptions {
  send: SendReport;
  app?: string;
  build?: () => string;
  userAgent?: () => string;
  online?: () => boolean;
  now?: () => number;
}

export class ErrorReporter {
  private signedIn = false;
  private seen = new Map<string, number>();
  private waiting: ErrorReport[] = [];
  private flushing = false;

  constructor(private opts: ReporterOptions) {}

  /** Follows the session: reports only while signed in; what waited for another session is dropped. */
  setSignedIn(signedIn: boolean) {
    if (!signedIn) this.waiting = [];
    this.signedIn = signedIn;
    if (signedIn) void this.flush();
  }

  /** Count of reports kept for later (tests). */
  get queued() { return this.waiting.length; }

  report(r: ErrorReport) {
    try {
      const message = r.message.trim();
      if (!this.signedIn || !message || IGNORED.some((re) => re.test(message))) return;
      const now = (this.opts.now ?? Date.now)();
      const last = this.seen.get(message);
      if (last !== undefined && now - last < DEDUPE_MS) return;
      this.seen.set(message, now);
      if (this.seen.size > 200) for (const [k, at] of this.seen) if (now - at >= DEDUPE_MS) this.seen.delete(k);
      this.waiting.push({ ...r, message });
      if (this.waiting.length > OFFLINE_KEEP) this.waiting.shift();
      void this.flush();
    } catch { /* never throw from reporting */ }
  }

  /** Send what waits (one at a time); stops at the first failure and keeps the rest for 'online'. */
  async flush() {
    if (this.flushing || !this.signedIn) return;
    this.flushing = true;
    try {
      while (this.signedIn && this.waiting.length && (this.opts.online ? this.opts.online() : true)) {
        const next = this.waiting[0];
        let ok = false;
        try {
          ok = await this.opts.send({
            ...next, app: this.opts.app ?? 'staff', build: this.opts.build?.() ?? '', userAgent: this.opts.userAgent?.() ?? '',
          });
        } catch { ok = false; }
        if (!ok) break;
        this.waiting.shift();
      }
    } finally {
      this.flushing = false;
    }
  }
}

let buildId = 'dev';
/** The build the service worker is registered for (the main bundle's file name). */
export function setBuildId(id: string) { buildId = id || 'dev'; }

const route = () => { try { return window.location.pathname; } catch { return undefined; } };

async function sendToSupabase(r: Parameters<SendReport>[0]): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('report_client_error', {
      p_app: r.app, p_path: r.path ?? null, p_message: r.message, p_stack: r.stack ?? null,
      p_user_agent: r.userAgent, p_build: r.build, p_context: r.context ?? null,
    });
    // A refusal (signed out, policy) is not worth keeping; only "no answer" is retried.
    return !error || !!error.code; // a network failure has no code
  } catch { return false; }
}

export const reporter = new ErrorReporter({
  send: sendToSupabase,
  build: () => buildId,
  userAgent: () => (typeof navigator === 'undefined' ? '' : navigator.userAgent),
  online: () => (typeof navigator === 'undefined' ? true : navigator.onLine),
});

/** Report an error caught by hand (error boundary, judge pad failures). */
export function reportClientError(message: string, extra: { stack?: string; context?: Record<string, unknown> } = {}) {
  reporter.report({ message, path: route(), ...extra });
}

const messageOf = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Window error and unhandled rejection handlers; call once at start-up of the staff app. */
export function installErrorReporting() {
  window.addEventListener('error', (e) => {
    reportClientError(e.error ? messageOf(e.error) : e.message, { stack: e.error instanceof Error ? e.error.stack : undefined });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason: unknown = e.reason;
    reportClientError(`Unhandled rejection: ${messageOf(reason)}`, { stack: reason instanceof Error ? reason.stack : undefined });
  });
  window.addEventListener('online', () => { void reporter.flush(); });
}
