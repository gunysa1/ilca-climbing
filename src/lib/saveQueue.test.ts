import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ackedSince, conflict, isAuthFailure, isTransient, keyState, latestRow, outboxKey, parseOutbox, retryDelay, SaveQueue,
  type OutboxEntry, type SaveQueueOptions, type SendResult,
} from './saveQueue';

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
const K3 = outboxKey('boulder_results', 'b1', 'c3');
const row = (climber: string, attempts: number) => ({ boulder_id: 'b1', climber_id: climber, round_id: 'r1', attempts, zone_attempt: null, top_attempt: null });
const put = (q: SaveQueue, climber: string, attempts: number, lock = false, base: string | null = null) =>
  q.enqueue({ key: outboxKey('boulder_results', 'b1', climber), table: 'boulder_results', row: row(climber, attempts), lock, base });
const OK: SendResult = { ok: true };
const ack = (climber: string, attempts: number, updated_at: string, locked = false): SendResult =>
  ({ ok: true, row: { ...row(climber, attempts), locked, updated_at } });
const OFFLINE: SendResult = { ok: false, status: 0, message: 'TypeError: Failed to fetch' };
const EXPIRED: SendResult = { ok: false, status: 401, message: 'JWT expired', code: 'PGRST301' };
const queue = (o: Partial<SaveQueueOptions> & Pick<SaveQueueOptions, 'send'>) => new SaveQueue({ storageKey: 'o', storage: memoryStorage(), ...o });
const sendMock = () => vi.fn<(e: OutboxEntry) => Promise<SendResult>>();

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('saveQueue', () => {
  it('keys a result by table, boulder and climber', () => {
    expect(outboxKey('lead_results', 'r9', 'c3')).toBe('lead_results|r9|c3');
  });

  it('coalesces: only the latest row per climber and boulder is sent', () => {
    const q = queue({ send: () => new Promise(() => {}) });
    put(q, 'c2', 1); // in flight
    put(q, 'c1', 1); put(q, 'c1', 2); put(q, 'c1', 3);
    expect(q.snapshot().pending.map((e) => [e.key, e.row.attempts])).toEqual([[K2, 1], [K1, 3]]);
  });

  it('keeps lock sticky when a later row for the same key is not a lock', () => {
    const q = queue({ send: () => new Promise(() => {}) });
    put(q, 'c2', 1); // in flight: c2 stays at the head
    put(q, 'c1', 2, true);
    put(q, 'c1', 2);
    expect(q.snapshot().pending.find((e) => e.key === K1)?.lock).toBe(true);
  });

  it('sends one at a time, oldest key first; a newer row for the key in flight goes after it', async () => {
    const s = controlledSender();
    const q = queue({ send: s.send });
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

  it('classifies failures: network, timeout, 5xx, 408 and 429 retry; 401 is a sign-in problem; other 4xx are permanent', () => {
    for (const s of [0, 408, 429, 500, 502, 503, 504, 520]) expect(isTransient(s), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 422]) expect(isTransient(s), String(s)).toBe(false);
    expect(isAuthFailure({ ok: false, status: 401, message: '' })).toBe(true);
    expect(isAuthFailure({ ok: false, status: 400, message: '', code: 'PGRST301' })).toBe(true);
    expect(isAuthFailure({ ok: false, status: 403, message: '', code: '42501' })).toBe(false);
  });

  it('backs off 1, 2, 4, 8, 15, then 30 s at most', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000]);
  });

  it('retries network failures with backoff, and at once when kicked (online, visible)', async () => {
    const send = sendMock().mockResolvedValue(OFFLINE);
    const q = queue({ send });
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
    const send = sendMock().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(OK);
    const q = queue({ send });
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(keyState(q.snapshot(), K1)).toBe('pending');
    await vi.advanceTimersByTimeAsync(1000);
    expect(keyState(q.snapshot(), K1)).toBe('saved');
  });

  it('moves permanent failures (locked by an admin, not a starter) to failed, never retried; the rest go on', async () => {
    const send = sendMock().mockImplementation(async (e) =>
      e.key === K1 ? { ok: false, status: 403, message: 'new row violates row-level security policy' } : OK);
    const q = queue({ send });
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
    const q = queue({ send: s.send });
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(0);
    put(q, 'c1', 2);
    s.calls[0].resolve({ ok: false, status: 400, message: 'check violation' });
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().failed).toEqual([]);
    expect(s.calls[1].entry.row.attempts).toBe(2);
  });

  describe('sign-in (401)', () => {
    it('refreshes the session once and sends again', async () => {
      const send = sendMock().mockResolvedValueOnce(EXPIRED).mockResolvedValue(OK);
      const refreshAuth = vi.fn(async () => 'ok' as const);
      const q = queue({ send, refreshAuth });
      put(q, 'c1', 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(refreshAuth).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledTimes(2);
      expect(q.snapshot()).toMatchObject({ pending: [], failed: [], needsSignIn: false });
    });

    it('signed out (or still 401 after a refresh): keeps the rows, pauses, asks to sign in; resumes on sign-in', async () => {
      const send = sendMock().mockResolvedValue(EXPIRED);
      const refreshAuth = vi.fn(async () => 'ok' as const);
      const q = queue({ send, refreshAuth });
      put(q, 'c1', 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);         // refreshed once, still 401
      expect(q.snapshot()).toMatchObject({ needsSignIn: true, failed: [] });
      expect(q.snapshot().pending).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(120_000);
      put(q, 'c2', 1);                               // paused: nothing is sent, rows wait
      q.kick();
      await vi.advanceTimersByTimeAsync(0);
      expect(send).toHaveBeenCalledTimes(2);
      send.mockResolvedValue(OK);
      q.resume();                                    // SIGNED_IN / TOKEN_REFRESHED
      await vi.advanceTimersByTimeAsync(0);
      expect(q.snapshot()).toMatchObject({ pending: [], needsSignIn: false });
    });

    it('a refresh that fails for want of signal is a network failure (retried, no sign-in notice)', async () => {
      const send = sendMock().mockResolvedValueOnce(EXPIRED).mockResolvedValue(OK);
      const q = queue({ send, refreshAuth: async () => 'offline' });
      put(q, 'c1', 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(q.snapshot().needsSignIn).toBe(false);
      expect(keyState(q.snapshot(), K1)).toBe('pending');
      await vi.advanceTimersByTimeAsync(1000);
      expect(keyState(q.snapshot(), K1)).toBe('saved');
    });
  });

  it('sends only for its own profile: another account signed in pauses it, rows kept', async () => {
    let current = false;
    const send = sendMock().mockResolvedValue(OK);
    const q = queue({ send, isCurrent: () => current });
    put(q, 'c1', 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).not.toHaveBeenCalled();
    expect(keyState(q.snapshot(), K1)).toBe('pending');
    current = true;
    q.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
  });

  describe('acked rows (the base after a reload)', () => {
    it('keeps the server row returned by each save, with when it came', async () => {
      const q = queue({ send: async (e) => ack('c1', e.row.attempts as number, '2026-10-28T09:00:01.5+00:00', true), now: () => 1234 });
      put(q, 'c1', 3, true);
      await vi.advanceTimersByTimeAsync(0);
      expect(q.snapshot().acked[K1]).toEqual({ row: { ...row('c1', 3), locked: true, updated_at: '2026-10-28T09:00:01.5+00:00' }, at: 1234 });
      expect(ackedSince(q.snapshot(), K1, 1234)).toBe(true);
      expect(ackedSince(q.snapshot(), K1, 1235)).toBe(false);
      expect(ackedSince(q.snapshot(), K2, 0)).toBe(false);
    });

    it('the newer of acked and server rows (by updated_at) is the base; equal: the server row', () => {
      const a = { updated_at: '2026-10-28T09:00:02+00:00', v: 'acked' };
      const s = { updated_at: '2026-10-28T09:00:01+00:00', v: 'server' };
      expect(latestRow(a, s)?.v).toBe('acked');
      expect(latestRow({ ...a, updated_at: '2026-10-28T08:00:00+00:00' }, s)?.v).toBe('server');
      expect(latestRow({ ...s, v: 'acked' }, s)?.v).toBe('server');
      expect(latestRow(undefined, s)?.v).toBe('server');
      expect(latestRow(a, undefined)?.v).toBe('acked');
      expect(latestRow(undefined, undefined)).toBeUndefined();
    });

    it('a new row builds on the newer of the acked row and the base the pad gives', async () => {
      const q = queue({ send: async () => ack('c1', 1, '2026-10-28T09:00:05+00:00') });
      put(q, 'c1', 1, false, null);
      await vi.advanceTimersByTimeAsync(0);
      q.stop();
      put(q, 'c1', 2, false, null);                  // pad opened before the first save: acked is newer
      expect(q.snapshot().pending[0].base).toBe('2026-10-28T09:00:05+00:00');
      const r = queue({ send: async () => OK });
      r.enqueue({ key: K1, table: 'boulder_results', row: row('c1', 1), lock: false, base: '2026-10-28T10:00:00+00:00' });
      expect(r.snapshot().pending[0].base).toBe('2026-10-28T10:00:00+00:00');
    });

    it('a row waiting behind its own in-flight save takes that save as its base', async () => {
      const s = controlledSender();
      const q = queue({ send: s.send });
      put(q, 'c1', 1, false, null);
      await vi.advanceTimersByTimeAsync(0);
      put(q, 'c1', 2, false, null);
      s.calls[0].resolve(ack('c1', 1, '2026-10-28T09:00:07+00:00'));
      await vi.advanceTimersByTimeAsync(0);
      expect(s.calls[1].entry.base).toBe('2026-10-28T09:00:07+00:00');
    });
  });

  describe('rows that waited are checked before they are sent', () => {
    it('fresh rows go straight out; rows after a failure or queued over 30 s ago are verified first', async () => {
      let t = 0;
      const verify = sendMock().mockResolvedValue(OK);
      const send = sendMock().mockResolvedValueOnce(OK).mockResolvedValueOnce(OFFLINE).mockResolvedValue(OK);
      const q = queue({ send, verify, now: () => t });
      put(q, 'c1', 1);
      await vi.advanceTimersByTimeAsync(0);
      expect(verify).not.toHaveBeenCalled();
      put(q, 'c2', 1);                               // fails once (offline), then waited
      await vi.advanceTimersByTimeAsync(0);
      expect(verify).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0][0].key).toBe(K2);
      expect(keyState(q.snapshot(), K2)).toBe('saved');
      const slow = queue({ send: async () => OK, verify, now: () => t, isCurrent: () => t > 0 });
      put(slow, 'c3', 1);
      t = 30_001;
      slow.kick();
      await vi.advanceTimersByTimeAsync(0);
      expect(verify).toHaveBeenCalledTimes(2);
    });

    it('held by another judge or changed on the server: failed with its reason, not sent', async () => {
      const send = sendMock().mockResolvedValueOnce(OFFLINE).mockResolvedValue(OK);
      const verify = sendMock().mockResolvedValue({ ok: false, status: 409, code: 'held', message: 'Judge Dana' });
      const q = queue({ send, verify });
      put(q, 'c1', 1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(q.snapshot().failed[0]).toMatchObject({ key: K1, code: 'held', error: 'Judge Dana' });
    });

    it('conflict: the server row changed since the base, unless it is one of our own writes', () => {
      const entry = (base: string | null | undefined, inDoubt?: Record<string, unknown>[]): OutboxEntry =>
        ({ key: K1, id: 'x', table: 'boulder_results', row: row('c1', 3), lock: false, queuedAt: 0, tries: 1, base, inDoubt });
      const server = (attempts: number, updated_at: string) => ({ ...row('c1', attempts), locked: false, updated_at });
      expect(conflict(entry(null), null)).toBe(false);                                      // still no row
      expect(conflict(entry('2026-10-28T09:00:00+00:00'), server(1, '2026-10-28T09:00:00.000+00:00'))).toBe(false); // unchanged
      expect(conflict(entry('2026-10-28T09:00:00+00:00'), server(5, '2026-10-28T09:10:00+00:00'))).toBe(true);  // admin edited
      expect(conflict(entry(null), server(5, '2026-10-28T09:10:00+00:00'))).toBe(true);    // admin added it
      expect(conflict(entry('2026-10-28T09:00:00+00:00'), null)).toBe(true);               // deleted
      expect(conflict(entry(null), server(3, '2026-10-28T09:10:00+00:00'))).toBe(false);   // our row landed, the answer was lost
      expect(conflict(entry(null, [row('c1', 2)]), server(2, '2026-10-28T09:10:00+00:00'))).toBe(false); // an earlier try of ours
      expect(conflict(entry(undefined), server(5, '2026-10-28T09:10:00+00:00'))).toBe(false); // older outbox: base unknown
    });

    it('remembers rows whose answer was lost (network) as possibly on the server', async () => {
      const send = sendMock().mockResolvedValue(OFFLINE);
      const q = queue({ send });
      put(q, 'c1', 1);
      await vi.advanceTimersByTimeAsync(0);
      put(q, 'c1', 2);
      await vi.advanceTimersByTimeAsync(0);
      expect(q.snapshot().pending[0].inDoubt?.map((r) => r.attempts)).toEqual([1, 2]);
    });
  });

  it('after 6 network failures in a row an entry goes behind the others (still queued)', async () => {
    const send = sendMock().mockImplementation(async (e) => (e.key === K1 ? OFFLINE : OK));
    const q = queue({ send });
    put(q, 'c1', 1);
    put(q, 'c2', 1);
    put(q, 'c3', 1);
    await vi.advanceTimersByTimeAsync(0);              // 1st failure (sent when queued)
    for (let i = 0; i < 4; i++) { q.kick(); await vi.advanceTimersByTimeAsync(0); }
    expect(q.snapshot().pending.map((e) => e.key)).toEqual([K1, K2, K3]);
    q.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().pending.map((e) => e.key)).toEqual([K2, K3, K1]);
    q.kick();
    await vi.advanceTimersByTimeAsync(0);
    expect(q.snapshot().pending.map((e) => e.key)).toEqual([K1]);
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

  it('two tabs: only the leader sends; a row queued in another tab is picked up from storage', async () => {
    const storage = memoryStorage();
    const sent: OutboxEntry[] = [];
    const leader = new SaveQueue({ storageKey: 'k', storage, send: async (e) => { sent.push(e); return OK; } });
    const other = new SaveQueue({ storageKey: 'k', storage, leader: false, send: async () => { throw new Error('a follower never sends'); } });
    put(other, 'c1', 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([]);
    leader.adopt();                                  // the `storage` event
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((e) => e.row.attempts)).toEqual([2]);
    other.adopt();
    expect(other.snapshot().pending).toEqual([]);
    put(other, 'c2', 1);                             // a write builds on what storage holds now
    expect(JSON.parse(storage.data.get('k')!).pending.map((e: OutboxEntry) => e.key)).toEqual([K2]);
    other.setLeader(true);                           // the other tab closed: this one takes over
    await vi.advanceTimersByTimeAsync(0);
  });

  it('ignores corrupt storage, reads the first outbox format, and flags storage that cannot be written', async () => {
    const empty = { pending: [], failed: [], acked: {} };
    expect(parseOutbox('not json')).toEqual(empty);
    expect(parseOutbox(null)).toEqual(empty);
    expect(parseOutbox('{"pending":[{"key":3},{"key":"a|b|c","table":"x","row":{},"lock":false,"queuedAt":1}],"failed":"no","acked":[]}'))
      .toEqual(empty);
    // First format (before ids, tries, bases and acked rows).
    const v1 = { key: K1, table: 'boulder_results', row: row('c1', 1), lock: false, queuedAt: 5 };
    const parsed = parseOutbox(JSON.stringify({ pending: [v1, null], failed: [{ ...v1, error: 'x' }, { ...v1 }] }));
    expect(parsed.pending).toEqual([{ ...v1, id: `${K1}@5`, tries: 0 }]);
    expect(parsed.failed).toEqual([{ ...v1, id: `${K1}@5`, tries: 0, error: 'x' }]);
    expect(parsed.acked).toEqual({});
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } };
    const q = new SaveQueue({ storageKey: 'o', storage: broken, send: async () => OK });
    expect(q.snapshot().storageFailed).toBe(false);
    put(q, 'c1', 1);
    expect(q.snapshot().storageFailed).toBe(true);   // the pad warns: don't reload
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
