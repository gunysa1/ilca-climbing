import { describe, expect, it, vi } from 'vitest';
import { DEDUPE_MS, ErrorReporter, OFFLINE_KEEP, RETRY_BASE_MS, RETRY_MAX_MS, type SendReport } from './errorReport';

function make(opts: { online?: boolean; ok?: boolean } = {}) {
  const state = { online: opts.online ?? true, ok: opts.ok ?? true, now: 1000, sent: [] as string[] };
  const send: SendReport = async (r) => { if (!state.ok) return false; state.sent.push(r.message); return true; };
  const r = new ErrorReporter({ send, online: () => state.online, now: () => state.now, build: () => 'b1' });
  return { r, state };
}
const tick = () => new Promise((res) => setTimeout(res, 0));

describe('ErrorReporter', () => {
  it('reports nothing while signed out', async () => {
    const { r, state } = make();
    r.report({ message: 'boom' });
    r.setSignedIn(true);
    await tick();
    expect(state.sent).toEqual([]);
    expect(r.queued).toBe(0);
  });
  it('sends the same message once a minute', async () => {
    const { r, state } = make();
    r.setSignedIn(true);
    r.report({ message: 'boom' });
    r.report({ message: 'boom' });
    await tick();
    state.now += DEDUPE_MS - 1;
    r.report({ message: 'boom' });
    await tick();
    expect(state.sent).toEqual(['boom']);
    state.now += 2;
    r.report({ message: 'boom' });
    r.report({ message: 'other' });
    await tick();
    expect(state.sent).toEqual(['boom', 'boom', 'other']);
  });
  it('keeps up to 20 while offline and sends them when back online', async () => {
    const { r, state } = make({ online: false });
    r.setSignedIn(true);
    for (let i = 0; i < OFFLINE_KEEP + 5; i++) r.report({ message: `e${i}` });
    await tick();
    expect(state.sent).toEqual([]);
    expect(r.queued).toBe(OFFLINE_KEEP);
    state.online = true;
    await r.flush();
    expect(state.sent).toHaveLength(OFFLINE_KEEP);
    expect(state.sent[0]).toBe('e5');
    expect(r.queued).toBe(0);
  });
  it('keeps a report whose send failed and drops them on sign-out', async () => {
    const { r, state } = make({ ok: false });
    r.setSignedIn(true);
    r.report({ message: 'x' });
    await tick();
    expect(r.queued).toBe(1);
    r.setSignedIn(false);
    expect(r.queued).toBe(0);
    state.ok = true;
    r.setSignedIn(true);
    await tick();
    expect(state.sent).toEqual([]);
  });
  it('ignores browser noise', async () => {
    const { r, state } = make();
    r.setSignedIn(true);
    r.report({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    await tick();
    expect(state.sent).toEqual([]);
  });
  it('dedupes on message and context: other boulders are separate reports', async () => {
    const { r, state } = make();
    r.setSignedIn(true);
    r.report({ message: 'Result not saved', context: { boulderId: 'a' } });
    r.report({ message: 'Result not saved', context: { boulderId: 'b' } });
    r.report({ message: 'Result not saved', context: { boulderId: 'a' } });
    await tick();
    expect(state.sent).toEqual(['Result not saved', 'Result not saved']);
  });
  it('does not lose an unsent report when the buffer overflows during a send', async () => {
    const sent: string[] = [];
    let release: () => void = () => {};
    let first = true;
    const send: SendReport = (rep) => {
      if (!first) { sent.push(rep.message); return Promise.resolve(true); }
      first = false; // the first send (e0) is held until released
      return new Promise<boolean>((res) => { release = () => { sent.push(rep.message); res(true); }; });
    };
    const r = new ErrorReporter({ send, online: () => true });
    r.setSignedIn(true);
    for (let i = 0; i < OFFLINE_KEEP; i++) r.report({ message: `e${i}` });
    r.report({ message: 'late' }); // pushes e0 (in flight) out of the buffer
    release();
    await tick();
    expect(sent).toHaveLength(OFFLINE_KEEP + 1); // e0 (in flight) and the 20 kept, each once
    expect(new Set(sent).size).toBe(OFFLINE_KEEP + 1);
    expect(sent).toContain('late');
    expect(sent).toContain('e1');
    r.setSignedIn(false);
  });
  it('retries a failed send with growing delays and on kick()', async () => {
    vi.useFakeTimers();
    try {
      const { r, state } = make({ ok: false });
      r.setSignedIn(true);
      r.report({ message: 'x' });
      await vi.advanceTimersByTimeAsync(0);
      expect(r.queued).toBe(1);
      state.ok = true;
      await vi.advanceTimersByTimeAsync(RETRY_BASE_MS - 1);
      expect(state.sent).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(state.sent).toEqual(['x']);
      // delays double and are capped
      state.ok = false;
      r.report({ message: 'y' });
      await vi.advanceTimersByTimeAsync(0);
      state.ok = true;
      r.kick();
      await vi.advanceTimersByTimeAsync(0);
      expect(state.sent).toEqual(['x', 'y']);
      expect(RETRY_MAX_MS).toBe(300_000);
      r.setSignedIn(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
