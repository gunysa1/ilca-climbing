// The judge pad's outbox: every tap is queued here and sent in the background, so scoring goes on
// through signal drops and a page reload. Pure: storage (localStorage) and the sender are injected
// (src/lib/judgeOutbox.ts wires Supabase and the browser events).
//  * Each save is the FULL result row, so the outbox keeps only the latest row per climber and boulder.
//  * One request at a time, oldest key first; a newer row for the key in flight is sent after it, so
//    the newest always wins on the server.
//  * Network / timeout / 5xx / 408 / 429: kept and retried with backoff (and at once on kick());
//    any other 4xx (RLS, locked by an admin, not a starter, check violation): moved to `failed`.

export type ResultTable = 'boulder_results' | 'lead_results';

export interface OutboxEntry {
  /** `<table>|<boulder_id>|<climber_id>` (outboxKey). */
  key: string;
  table: ResultTable;
  /** The whole row to upsert (without `locked`; see lock). */
  row: Record<string, unknown>;
  /** Lock the result with this row. Sticky: a later row for the same key keeps it. */
  lock: boolean;
  /** When the key was first queued (ms). */
  queuedAt: number;
  /** For the failed-results notice: who and where. */
  meta?: { climber: string; boulder: number };
}
export interface FailedEntry extends OutboxEntry { error: string }
export interface OutboxSnapshot { pending: OutboxEntry[]; failed: FailedEntry[] }
export type KeyState = 'saved' | 'pending' | 'failed';
/** `status` is the HTTP status; 0 for a network failure or timeout. */
export type SendResult = { ok: true } | { ok: false; status: number; message: string };
type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const outboxKey = (table: ResultTable, boulderId: string, climberId: string) => `${table}|${boulderId}|${climberId}`;
export const outboxStorageKey = (profileId: string) => `ilca.outbox.${profileId}`;

/** Worth retrying: no answer (network, timeout), a server error, 408 or 429. */
export const isTransient = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
/** Wait before the next try after `failures` failures in a row (1 s … 30 s). */
export const retryDelay = (failures: number) => RETRY_DELAYS_MS[Math.min(Math.max(failures, 1), RETRY_DELAYS_MS.length) - 1];

export function keyState(snap: OutboxSnapshot, key: string): KeyState {
  if (snap.pending.some((e) => e.key === key)) return 'pending';
  return snap.failed.some((e) => e.key === key) ? 'failed' : 'saved';
}

const TABLES: readonly string[] = ['boulder_results', 'lead_results'];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEntry = (v: unknown): v is OutboxEntry => isObject(v) && typeof v.key === 'string' && TABLES.includes(v.table as string)
  && isObject(v.row) && typeof v.lock === 'boolean' && typeof v.queuedAt === 'number' && (v.meta === undefined || isObject(v.meta));

/** Stored outbox; anything malformed is dropped. */
export function parseOutbox(raw: string | null): OutboxSnapshot {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (!isObject(v)) return { pending: [], failed: [] };
    const list = (x: unknown) => (Array.isArray(x) ? x : []);
    return {
      pending: list(v.pending).filter(isEntry),
      failed: list(v.failed).filter((e): e is FailedEntry => isEntry(e) && typeof (e as FailedEntry).error === 'string'),
    };
  } catch {
    return { pending: [], failed: [] };
  }
}

export interface SaveQueueOptions {
  storageKey: string;
  /** null: memory only. */
  storage: StorageLike | null;
  send: (entry: OutboxEntry) => Promise<SendResult>;
  now?: () => number;
}

export class SaveQueue {
  private snap: OutboxSnapshot;
  private listeners = new Set<() => void>();
  private flushing = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private opts: SaveQueueOptions) {
    let raw: string | null = null;
    try { raw = opts.storage?.getItem(opts.storageKey) ?? null; } catch { /* storage unavailable: start empty */ }
    this.snap = parseOutbox(raw);
  }

  /** Same object until something changes (useSyncExternalStore). */
  snapshot = (): OutboxSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The unsent row for a key, if any (the judge's work the server doesn't have yet). */
  pendingRow(key: string): Record<string, unknown> | undefined {
    return this.snap.pending.find((e) => e.key === key)?.row;
  }

  /** Queue a row (replacing an unsent one for the same key, in its place) and start sending. */
  enqueue(entry: Omit<OutboxEntry, 'queuedAt'>) {
    const pending = [...this.snap.pending];
    const at = pending.findIndex((e) => e.key === entry.key);
    if (at >= 0) pending[at] = { ...entry, lock: pending[at].lock || entry.lock, queuedAt: pending[at].queuedAt };
    else pending.push({ ...entry, queuedAt: (this.opts.now ?? Date.now)() });
    // A new row for a failed key is a new try.
    this.commit({ pending, failed: this.snap.failed.filter((e) => e.key !== entry.key) });
    void this.flush();
  }

  /** Retry now (back online, app visible again) instead of waiting for the backoff. */
  kick() {
    if (this.stopped) return;
    void this.flush();
  }

  /** The judge read the failed notice: forget one failed row, or all of them. */
  dismiss(key?: string) {
    this.commit({ ...this.snap, failed: key ? this.snap.failed.filter((e) => e.key !== key) : [] });
  }

  /** No more sending (tests: the page went away). */
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private commit(next: OutboxSnapshot) {
    this.snap = next;
    try { this.opts.storage?.setItem(this.opts.storageKey, JSON.stringify(next)); } catch { /* full or blocked: memory only */ }
    for (const l of this.listeners) l();
  }

  private async flush() {
    if (this.flushing || this.stopped) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flushing = true;
    try {
      while (!this.stopped && this.snap.pending.length) {
        const entry = this.snap.pending[0];
        let result: SendResult;
        try { result = await this.opts.send(entry); }
        catch (e) { result = { ok: false, status: 0, message: String(e) }; }
        // A newer row for this key arrived while it was in flight: it replaced `entry` in place
        // and is sent next (whatever happened to the older one).
        const replaced = this.snap.pending.find((e) => e.key === entry.key) !== entry;
        if (result.ok) {
          this.failures = 0;
          if (!replaced) this.commit({ ...this.snap, pending: this.snap.pending.filter((e) => e !== entry) });
        } else if (isTransient(result.status)) {
          this.failures++;
          if (!this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, retryDelay(this.failures));
          return;
        } else if (!replaced) {
          this.commit({
            pending: this.snap.pending.filter((e) => e !== entry),
            failed: [...this.snap.failed.filter((e) => e.key !== entry.key), { ...entry, error: result.message }],
          });
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
