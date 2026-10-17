// The judge pad's outbox: every tap is queued here and sent in the background, so scoring goes on
// through signal drops and a page reload. Pure: storage (localStorage), the sender and the checks are
// injected (src/lib/judgeOutbox.ts wires Supabase and the browser events).
//  * Each save is the FULL result row, so the outbox keeps only the latest row per climber and boulder.
//  * One request at a time, oldest key first; a newer row for the key in flight is sent after it, so
//    the newest always wins on the server. Only one tab per profile sends (the leader).
//  * Network / timeout / 5xx / 408 / 429: kept and retried with backoff (and at once on kick()); after
//    6 failures in a row an entry goes behind the others. 401: refresh the session once, else pause
//    and ask to sign in again (rows kept). Any other 4xx (RLS, locked by an admin, not a starter,
//    check violation): moved to `failed`, never retried.
//  * A row that waited (a failed try, queued over 30 s ago, or the first after a "changed" / "held"
//    failure) is verified first: still this judge's climber, and the server row unchanged since the
//    row the judge built on (`baseRow`); else failed. Already on the server (an answer that was lost):
//    taken as saved, not sent again.
//  * The server's answer to each save is kept (`acked`): the pad's base after a reload.

export type ResultTable = 'boulder_results' | 'lead_results';
type Row = Record<string, unknown>;

export interface OutboxEntry {
  /** `<table>|<boulder_id>|<climber_id>` (outboxKey). */
  key: string;
  /** This row's id (a newer row for the key gets a new one). */
  id: string;
  table: ResultTable;
  /** The whole row to upsert (without `locked`; see lock). */
  row: Row;
  /** Lock the result with this row. Sticky: a later row for the same key keeps it. */
  lock: boolean;
  /** When the key was first queued (ms). */
  queuedAt: number;
  /** Failed tries of this key so far. */
  tries: number;
  /** The server row the judge built on (data, lock, updated_at); null: there was none; undefined:
   *  unknown (first-round outboxes, which have only `base`). */
  baseRow?: Row | null;
  /** updated_at of baseRow (null: none; undefined: unknown, first format). */
  base?: string | null;
  /** Verify before sending even if it didn't wait (after a "changed" / "held" failure for this key). */
  verify?: boolean;
  /** Rows sent for this key whose answer was lost (network): they may be on the server. */
  inDoubt?: Row[];
  /** For the failed-results notice: who and where. */
  meta?: { climber: string; boulder: number };
}
/** `held`: another judge holds the climber (error: their name); `changed`: changed on the server meanwhile. */
export type FailCode = 'held' | 'changed';
/** `server`: the server's row when it was refused for having changed (the pad shows it). */
export interface FailedEntry extends OutboxEntry { error: string; code?: FailCode; server?: Row }
/** The server's row as returned by a save, and when it came (ms). */
export interface Acked { row: Row; at: number }
interface Stored {
  pending: OutboxEntry[];
  failed: FailedEntry[];
  acked: Record<string, Acked>;
  /** Keys whose next row is verified however fresh (a "changed" / "held" failure, until a save). */
  recheck: string[];
}
export interface OutboxSnapshot extends Stored {
  /** Paused: the session is gone; the judge must sign in again (rows kept). */
  needsSignIn: boolean;
  /** Storage refused a write: unsent rows live only in memory (a reload loses them). */
  storageFailed: boolean;
}
export type KeyState = 'saved' | 'pending' | 'failed';
/** `status` is the HTTP status; 0 for a network failure or timeout. `row`: the server's row.
 *  From verify: `done` (the row is already on the server: saved, don't send). */
export type SendResult = { ok: true; row?: Row; done?: boolean } | { ok: false; status: number; message: string; code?: string; row?: Row };
export type AuthRefresh = 'ok' | 'signed-out' | 'offline';
type StorageLike = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export const outboxKey = (table: ResultTable, boulderId: string, climberId: string) => `${table}|${boulderId}|${climberId}`;
export const outboxStorageKey = (profileId: string) => `ilca.outbox.${profileId}`;

/** Worth retrying: no answer (network, timeout), a server error, 408 or 429. */
export const isTransient = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;
/** Not signed in (expired or missing session): never a reason to drop a row. */
export const isAuthFailure = (r: SendResult) => !r.ok && (r.status === 401 || r.code === 'PGRST301');

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
/** Wait before the next try after `failures` failures in a row (1 s … 30 s). */
export const retryDelay = (failures: number) => RETRY_DELAYS_MS[Math.min(Math.max(failures, 1), RETRY_DELAYS_MS.length) - 1];
/** Queued longer than this before its send: checked first. */
const WAITED_MS = 30_000;
/** Failures in a row after which an entry lets the others go first. */
const MOVE_BACK_AFTER = 6;
const ACKED_KEEP = 500;
const IN_DOUBT_KEEP = 5;

export function keyState(snap: OutboxSnapshot, key: string): KeyState {
  if (snap.pending.some((e) => e.key === key)) return 'pending';
  return snap.failed.some((e) => e.key === key) ? 'failed' : 'saved';
}

/** The server confirmed a save for this key at or after `since` (ms): only then "saved". */
export const ackedSince = (snap: OutboxSnapshot, key: string, since: number) => (snap.acked[key]?.at ?? -1) >= since;

const time = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);

/** The newer row by updated_at; equal or unknown: the server's. */
export function latestRow<T extends { updated_at?: unknown }>(acked: T | undefined, server: T | undefined): T | undefined {
  if (!acked || !server) return acked ?? server;
  return time(acked.updated_at) > time(server.updated_at) ? acked : server;
}

const IDS = new Set(['boulder_id', 'climber_id', 'round_id']);
/** The result's own columns (attempts … / hold …), compared on `row`'s keys. */
const sameData = (row: Row, server: Row) => Object.keys(row).every((k) => IDS.has(k) || (row[k] ?? null) === (server[k] ?? null));
const sameLock = (a: Row, b: Row) => !!a.locked === !!b.locked;

/** The server already holds this row, with its lock: a save whose answer was lost landed. */
export const landed = (entry: OutboxEntry, server: Row | null) => !!server && sameData(entry.row, server) && !!server.locked === entry.lock;

/** A waited row would overwrite someone else's change: the server row is not the one the judge built
 *  on (data and lock), nor one of the judge's own writes (whose answer may have been lost). */
export function conflict(entry: OutboxEntry, server: Row | null): boolean {
  const ours = (s: Row) => [entry.row, ...(entry.inDoubt ?? [])].some((r) => sameData(r, s));
  if (entry.baseRow !== undefined) {
    if (!server) return entry.baseRow !== null;
    const base = entry.baseRow;
    if (base && Object.keys(entry.row).every((k) => IDS.has(k) || (base[k] ?? null) === (server[k] ?? null)) && sameLock(base, server)) return false;
    return server.locked && !base?.locked ? true : !ours(server); // locked meanwhile (ours would have landed)
  }
  // First-round outboxes: only the base's updated_at.
  if (entry.base === undefined) return false;
  if (!server) return entry.base !== null;
  if (entry.base !== null && time(server.updated_at) === time(entry.base)) return false;
  return !ours(server);
}

const TABLES: readonly string[] = ['boulder_results', 'lead_results'];
const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEntry = (v: unknown): v is OutboxEntry => isObject(v) && typeof v.key === 'string' && TABLES.includes(v.table as string)
  && isObject(v.row) && typeof v.lock === 'boolean' && typeof v.queuedAt === 'number' && (v.meta === undefined || isObject(v.meta));
// First format: no id or tries.
const upgrade = <T extends OutboxEntry>(e: T): T => ({ ...e, id: typeof e.id === 'string' ? e.id : `${e.key}@${e.queuedAt}`,
  tries: typeof e.tries === 'number' ? e.tries : 0 });

/** Stored outbox; anything malformed is dropped. */
export function parseOutbox(raw: string | null): Stored {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (!isObject(v)) return { pending: [], failed: [], acked: {}, recheck: [] };
    const list = (x: unknown) => (Array.isArray(x) ? x : []);
    const acked = isObject(v.acked)
      ? Object.fromEntries(Object.entries(v.acked).filter(([, a]) => isObject(a) && isObject(a.row) && typeof a.at === 'number')) as Record<string, Acked>
      : {};
    return {
      pending: list(v.pending).filter(isEntry).map(upgrade),
      failed: list(v.failed).filter((e): e is FailedEntry => isEntry(e) && typeof (e as FailedEntry).error === 'string').map(upgrade),
      acked,
      recheck: list(v.recheck).filter((k): k is string => typeof k === 'string'),
    };
  } catch {
    return { pending: [], failed: [], acked: {}, recheck: [] };
  }
}

export interface SaveQueueOptions {
  storageKey: string;
  /** null: memory only. */
  storage: StorageLike | null;
  send: (entry: OutboxEntry) => Promise<SendResult>;
  /** Waited rows: may this row still go (claim, server row unchanged)? A failure is classified like a send's. */
  verify?: (entry: OutboxEntry) => Promise<SendResult>;
  /** After a 401: refresh the session. */
  refreshAuth?: () => Promise<AuthRefresh>;
  /** The queue's profile is the one signed in (else pause, rows kept). */
  isCurrent?: () => boolean;
  /** This tab sends (one tab per profile); others only queue. Default true. */
  leader?: boolean;
  now?: () => number;
}

let ids = 0;
const newId = () => `${Date.now().toString(36)}-${(ids++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class SaveQueue {
  private snap: OutboxSnapshot;
  private listeners = new Set<() => void>();
  private flushing = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private leader: boolean;

  constructor(private opts: SaveQueueOptions) {
    this.leader = opts.leader ?? true;
    this.snap = { ...this.read(), needsSignIn: false, storageFailed: false };
  }

  /** Same object until something changes (useSyncExternalStore). */
  snapshot = (): OutboxSnapshot => this.snap;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The unsent row for a key, if any (the judge's work the server doesn't have yet). */
  pendingRow(key: string): Row | undefined {
    return this.snap.pending.find((e) => e.key === key)?.row;
  }

  /** Queue a row (replacing an unsent one for the same key, in its place) and start sending.
   *  `baseRow`: the server row the pad started from (null: none); the newer acked row wins. */
  enqueue({ baseRow: given, ...entry }: Pick<OutboxEntry, 'key' | 'table' | 'row' | 'lock' | 'meta' | 'baseRow'>) {
    this.mutate((s) => {
      const pending = [...s.pending];
      const at = pending.findIndex((e) => e.key === entry.key);
      if (at >= 0) {
        const old = pending[at];
        pending[at] = { ...old, ...entry, id: newId(), lock: old.lock || entry.lock };
      } else {
        const acked = s.acked[entry.key]?.row;
        const baseRow = acked && (!given || time(acked.updated_at) > time(given.updated_at)) ? acked : given ?? null;
        const base = typeof baseRow?.updated_at === 'string' ? baseRow.updated_at : null;
        pending.push({ ...entry, baseRow, base, id: newId(), queuedAt: this.now(), tries: 0,
          ...(s.recheck.includes(entry.key) ? { verify: true } : {}) });
      }
      // A new row for a failed key is a new try.
      return { ...s, pending, failed: s.failed.filter((e) => e.key !== entry.key) };
    });
    void this.flush();
  }

  /** Retry now (back online, app visible again, another tab queued) instead of waiting for the backoff. */
  kick() {
    void this.flush();
  }

  /** Signed in again (or the token was refreshed): send what waited. */
  resume() {
    if (this.snap.needsSignIn) this.set({ ...this.snap, needsSignIn: false });
    this.kick();
  }

  /** This tab is the one that sends. */
  leading() { return this.leader; }

  /** This tab became (or stopped being) the one that sends. */
  setLeader(leader: boolean) {
    this.leader = leader;
    if (leader) this.adopt(); // what the previous leader left in storage
  }

  /** Another tab wrote the outbox (`storage` event): take it over and send what's new. */
  adopt() {
    this.set({ ...this.snap, ...this.read() }, false);
    this.kick();
  }

  /** The judge read the failed notice: forget one failed row, or all of them. */
  dismiss(key?: string) {
    this.mutate((s) => ({ ...s, failed: key ? s.failed.filter((e) => e.key !== key) : [] }));
  }

  /** No more sending (sign-out, another profile, the page went away). Rows stay stored. */
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private now() { return (this.opts.now ?? Date.now)(); }

  /** What storage holds (another tab may have written it); memory when storage can't be trusted. */
  private read(): Stored {
    const { storage, storageKey } = this.opts;
    if (!storage || this.snap?.storageFailed) return this.snap ?? { pending: [], failed: [], acked: {}, recheck: [] };
    try {
      const raw = storage.getItem(storageKey);
      return raw === null && this.snap ? this.snap : parseOutbox(raw);
    } catch {
      return this.snap ?? { pending: [], failed: [], acked: {}, recheck: [] };
    }
  }

  private mutate(fn: (s: OutboxSnapshot) => OutboxSnapshot) {
    const r = this.read();
    this.set(fn({ ...this.snap, pending: r.pending, failed: r.failed, acked: r.acked, recheck: r.recheck }));
  }

  private set(next: OutboxSnapshot, write = true) {
    if (write && this.opts.storage && !next.storageFailed) {
      const { pending, failed, acked, recheck } = next;
      try { this.opts.storage.setItem(this.opts.storageKey, JSON.stringify({ pending, failed, acked, recheck })); }
      catch { next = { ...next, storageFailed: true }; } // full or blocked: memory only
    }
    this.snap = next;
    for (const l of this.listeners) l();
  }

  private async call(fn: (e: OutboxEntry) => Promise<SendResult>, entry: OutboxEntry): Promise<SendResult> {
    try { return await fn(entry); }
    catch (e) { return { ok: false, status: 0, message: String(e) }; }
  }

  private async flush() {
    if (this.flushing || this.stopped || !this.leader || this.snap.needsSignIn) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.flushing = true;
    let refreshed = false;
    try {
      while (!this.stopped && this.leader) {
        const entry = this.snap.pending[0];
        if (!entry) break;
        if (this.opts.isCurrent && !this.opts.isCurrent()) break; // another account: kept for its owner
        const waited = entry.tries > 0 || !!entry.verify || this.now() - entry.queuedAt > WAITED_MS;
        let result: SendResult = waited && this.opts.verify ? await this.call(this.opts.verify, entry) : { ok: true };
        let sent = false; // the row went out (its answer may be lost)
        if (result.ok && !result.done) { sent = true; result = await this.call(this.opts.send, entry); }
        if (isAuthFailure(result)) {
          const auth = refreshed || !this.opts.refreshAuth ? 'signed-out' : await this.opts.refreshAuth();
          refreshed = true;
          if (auth === 'ok') continue;
          if (auth === 'signed-out') { this.set({ ...this.snap, needsSignIn: true }, false); break; }
          result = { ok: false, status: 0, message: 'offline' };
        }
        // A newer row for this key arrived while it was in flight: it replaced `entry` in place
        // and is sent next (whatever happened to the older one).
        const replaced = this.snap.pending.find((e) => e.key === entry.key)?.id !== entry.id;
        if (result.ok) {
          this.failures = 0;
          refreshed = false;
          const ackRow = result.row;
          this.mutate((s) => {
            const acked = ackRow ? keepLatest({ ...s.acked, [entry.key]: { row: ackRow, at: this.now() } }) : s.acked;
            const ua = ackRow?.updated_at;
            const pending = replaced
              ? s.pending.map((e) => (e.key === entry.key && ackRow && typeof ua === 'string'
                ? { ...e, baseRow: ackRow, base: ua, inDoubt: undefined } : e))
              : s.pending.filter((e) => e.id !== entry.id);
            return { ...s, pending, acked, recheck: s.recheck.filter((k) => k !== entry.key) };
          });
        } else if (isTransient(result.status)) {
          this.failures++;
          // No answer, a timeout or a server error after the row went out: it may have landed.
          const lost = sent && result.message !== 'offline' && (result.status === 0 || result.status === 408 || result.status >= 500);
          this.mutate((s) => {
            let pending = s.pending.map((e) => (e.key !== entry.key ? e : {
              ...e, tries: e.tries + 1, inDoubt: lost ? [...(e.inDoubt ?? []), entry.row].slice(-IN_DOUBT_KEEP) : e.inDoubt,
            }));
            const stuck = pending.find((e) => e.key === entry.key);
            // Stuck on this entry: let the others go first; it stays queued.
            if (stuck && stuck.tries % MOVE_BACK_AFTER === 0 && pending.length > 1) pending = [...pending.filter((e) => e !== stuck), stuck];
            return { ...s, pending };
          });
          if (!this.stopped) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, retryDelay(this.failures));
          break;
        } else if (!replaced) {
          const code = result.code === 'held' || result.code === 'changed' ? result.code : undefined;
          const server = code === 'changed' ? result.row : undefined;
          this.mutate((s) => ({
            ...s,
            pending: s.pending.filter((e) => e.id !== entry.id),
            failed: [...s.failed.filter((e) => e.key !== entry.key),
              { ...entry, error: result.message, ...(code ? { code } : {}), ...(server ? { server } : {}) }],
            recheck: code && !s.recheck.includes(entry.key) ? [...s.recheck, entry.key] : s.recheck,
          }));
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}

function keepLatest(acked: Record<string, Acked>): Record<string, Acked> {
  const all = Object.entries(acked);
  return all.length <= ACKED_KEEP ? acked : Object.fromEntries(all.sort((a, b) => b[1].at - a[1].at).slice(0, ACKED_KEEP));
}
