import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTransient, keyState, outboxKey, parseOutbox, retryDelay, SaveQueue, type OutboxEntry, type SendResult } from './saveQueue';

/** localStorage stand-in. */
function memoryStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

/** A sender whose calls the test answers one by one. */
function controlledSender() {
  const calls: { entry: OutboxEntry; resolve: (r: SendResult) => void }[] = [];
  const send = (entry: OutboxEntry) => new Promise<SendResult>((resolve) => { calls.push({ entry, resolve }); });
  return { calls, send };
}

const K1 = outboxKey('boulder_results', 'b1', 'c1');
const K2 = outboxKey('boulder_results', 'b1', 'c2');
const row = (climber: string, attempts: number) => ({ boulder_id: 'b1', climber_id: climber, round_id: 'r1', attempts, zone_attempt: null, top_attempt: null });
const put = (q: SaveQueue, climber: string, attempts: number, lock = false) =>
  q.enqueue({ key: outboxKey('boulder_results', 'b1', climber), table: 'boulder_results', row: row(climber, attempts), lock });
const OK: SendResult = { ok: true };
const OFFLINE: SendResult = { ok: false, status: 0, message: 'TypeError: Failed to fetch' };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('saveQueue', () => {
  it('keys a result by table, boulder and climber', () => {
    expect(outboxKey('lead_results', 'r9', 'c3')).toBe('lead_results|r9|c3');
  });

  it('coalesces: only the latest row per climber and boulder is sent', async () => {
    const s = controlledSender();
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send: OFFLINE_FIRST(s) });
    put(q, 'c1', 1); put(q, 'c1', 2); put(q, 'c1', 3);
    expect(q.snapshot().pending).toHaveLength(1);
    expect(q.snapshot().pending[0].row.attempts).toBe(3);
  });

  it('keeps lock sticky when a later row for the same key is not a lock', () => {
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send: () => new Promise(() => {}) });
    put(q, 'c2', 1); // in flight: c2 stays at the head
    put(q, 'c1', 2, true);
    put(q, 'c1', 2);
    expect(q.snapshot().pending.find((e) => e.key === K1)?.lock).toBe(true);
  });

  it('sends one at a time, oldest key first; a newer row for the key in flight goes after it', async () => {
    const s = controlledSender();
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send: s.send });
    put(q, 'c1', 1);
    put(q, 'c2', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.calls).toHaveLength(1);                 // one at a time
    expect(s.calls[0].entry.row.attempts).toBe(1);
    put(q, 'c1', 2);                                  // c1 is in flight: waits
    expect(keyState(q.snapshot(), K1)).toBe('pending');
    s.calls[0].resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].entry.key).toBe(K1);            // the newer c1 row, still ahead of c2
    expect(s.calls[1].entry.row.attempts).toBe(2);
    s.calls[1].resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.calls[2].entry.key).toBe(K2);
    s.calls[2].resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().pending).toEqual([]);
    expect(keyState(q.snapshot(), K1)).toBe('saved');
  });

  it('classifies failures: network, timeout, 5xx, 408 and 429 retry; other 4xx are permanent', () => {
    for (const s of [0, 408, 429, 500, 502, 503, 504, 520]) expect(isTransient(s), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 422]) expect(isTransient(s), String(s)).toBe(false);
  });

  it('backs off 1, 2, 4, 8, 15, then 30 s at most', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
  });

  it('retries network failures with backoff, and at once when kicked (online, visible)', async () => {
    const send = vi.fn<(e: OutboxEntry) => Promise<SendResult>>().mockResolvedValue(OFFLINE);
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send });
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);           // after 1 s
    await vi.advanceTimersByTimeAsync(2000);
    expect(send).toHaveBeenCalledTimes(3);           // after 2 more
    q.kick();                                        // back online: no waiting for the 4 s
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(4);
    send.mockResolvedValue(OK);
    q.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().pending).toEqual([]);
    expect(q.snapshot().failed).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(5);           // nothing left to retry
  });

  it('a sender that throws counts as a network failure', async () => {
    const send = vi.fn<(e: OutboxEntry) => Promise<SendResult>>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(OK);
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send });
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(keyState(q.snapshot(), K1)).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    expect(keyState(q.snapshot(), K1)).toBe('saved');
  });

  it('moves permanent failures (locked by an admin, not a starter) to failed, never retried; the rest go on', async () => {
    const send = vi.fn<(e: OutboxEntry) => Promise<SendResult>>(async (e) =>
      e.key === K1 ? { ok: false, status: 403, message: 'new row violates row-level security policy' } : OK);
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send });
    put(q, 'c1', 1);
    put(q, 'c2', 1);
    await vi.advanceTimersByTimeAsync(0);
    const snap = q.snapshot();
    expect(snap.pending).toEqual([]);
    expect(snap.failed).toHaveLength(1);
    expect(snap.failed[0]).toMatchObject({ key: K1, error: 'new row violates row-level security policy' });
    expect(keyState(snap, K1)).toBe('failed');
    expect(keyState(snap, K2)).toBe('saved');
    await vi.advanceTimersByTimeAsync(120_000);
    q.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2);
    q.dismiss(K1);                                   // the judge read the notice
    expect(q.snapshot().failed).toEqual([]);
  });

  it('a failure of a row already replaced by a newer one is dropped: the newer row is sent', async () => {
    const s = controlledSender();
    const q = new SaveQueue({ storageKey: 'o', storage: memoryStorage(), send: s.send });
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(0);
    put(q, 'c1', 2);
    s.calls[0].resolve({ ok: false, status: 400, message: 'check violation' });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().failed).toEqual([]);
    expect(s.calls[1].entry.row.attempts).toBe(2);
  });

  it('survives a reload: a new queue on the same storage holds and sends the unsent rows', async () => {
    const storage = memoryStorage();
    const first = new SaveQueue({ storageKey: 'ilca.outbox.p1', storage, send: async () => OFFLINE });
    put(first, 'c1', 4, true);
    put(first, 'c2', 1);
    await vi.advanceTimersByTimeAsync(0);
    first.stop();                                    // the page goes away
    const sent: OutboxEntry[] = [];
    const second = new SaveQueue({ storageKey: 'ilca.outbox.p1', storage, send: async (e) => { sent.push(e); return OK; } });
    expect(second.snapshot().pending.map((e) => [e.key, e.row.attempts, e.lock])).toEqual([[K1, 4, true], [K2, 1, false]]);
    expect(second.pendingRow(K1)?.attempts).toBe(4);
    second.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((e) => e.key)).toEqual([K1, K2]);
    expect(JSON.parse(storage.data.get('ilca.outbox.p1')!)).toMatchObject({ pending: [], failed: [] });
  });

  it('ignores corrupt storage and keeps working in memory when storage throws', async () => {
    expect(parseOutbox('not json')).toEqual({ pending: [], failed: [] });
    expect(parseOutbox(null)).toEqual({ pending: [], failed: [] });
    expect(parseOutbox('{"pending":[{"key":3},{"key":"a|b|c","table":"x","row":{},"lock":false,"queuedAt":1}],"failed":"no"}'))
      .toEqual({ pending: [], failed: [] });
    const good = { key: K1, table: 'boulder_results', row: row('c1', 1), lock: false, queuedAt: 5 };
    expect(parseOutbox(JSON.stringify({ pending: [good, null], failed: [{ ...good, error: 'x' }, { ...good }] })))
      .toEqual({ pending: [good], failed: [{ ...good, error: 'x' }] });
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    const q = new SaveQueue({ storageKey: 'o', storage: broken, send: async () => OK });
    put(q, 'c1', 1);
    expect(keyState(q.snapshot(), K1)).toBe('pending');
    await vi.advanceTimersByTimeAsync(0);
    expect(keyState(q.snapshot(), K1)).toBe('saved');
  });

  it('notifies subscribers with a new snapshot on every change', async () => {
    const q = new SaveQueue({ storageKey: 'o', storage: null, send: async () => OK });
    const seen: number[] = [];
    const off = q.subscribe(() => seen.push(q.snapshot().pending.length));
    const before = q.snapshot();
    expect(q.snapshot()).toBe(before);               // stable until something changes
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(0);
    off();
    put(q, 'c2', 1);
    expect(seen).toEqual([1, 0]);
  });
});

/** The first call fails (offline) and later ones hang: rows stay queued for inspection. */
function OFFLINE_FIRST(s: ReturnType<typeof controlledSender>) {
  let first = true;
  return (e: OutboxEntry) => { if (first) { first = false; return Promise.resolve(OFFLINE); } return s.send(e); };
}
