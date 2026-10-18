import { describe, expect, it } from 'vitest';
import { ALERT_HIDDEN_MAX_MS, planFetch, type PollContext } from './alertPolling';

const base: PollContext = { now: 1_000_000, lastWall: 0, lastHist: 0, anyLive: false, finishedPending: false, needBaseline: false, wantHistory: true, hiddenSince: null };
const at = (o: Partial<PollContext>) => planFetch({ ...base, ...o });

describe('alert polling plan', () => {
  it('asks for the live part first, then the baseline history', () => {
    expect(at({ needBaseline: true })).toBe('wall');
    expect(at({ needBaseline: true, lastWall: base.now - 1000 })).toBe('history');
  });

  it('idle: the live part every 2 minutes, never the history', () => {
    expect(at({ lastWall: base.now - 60000 })).toBeNull();
    expect(at({ lastWall: base.now - 120000 })).toBe('wall');
    expect(at({ lastWall: base.now - 120000, lastHist: 0 })).toBe('wall');
  });

  it('live: the two take turns, one at a time', () => {
    const live = { anyLive: true };
    expect(at({ ...live, lastWall: base.now - 60000, lastHist: base.now - 30000 })).toBe('wall');
    expect(at({ ...live, lastWall: base.now - 30000, lastHist: base.now - 60000 })).toBe('history');
    expect(at({ ...live, lastWall: base.now - 30000, lastHist: base.now - 30000 })).toBeNull();
    // both overdue (after a pause): the older one first
    expect(at({ ...live, lastWall: base.now - 90000, lastHist: base.now - 70000 })).toBe('wall');
    expect(at({ ...live, lastWall: base.now - 70000, lastHist: base.now - 90000 })).toBe('history');
  });

  it('live without history events: the live part every 30 s', () => {
    expect(at({ anyLive: true, wantHistory: false, lastWall: base.now - 30000, lastHist: 0 })).toBe('wall');
  });

  it('after the last round ended: one more history read', () => {
    expect(at({ finishedPending: true, lastWall: base.now - 1000, lastHist: base.now - 60000 })).toBe('history');
    expect(at({ finishedPending: true, lastWall: base.now - 1000, lastHist: base.now - 1000 })).toBeNull();
  });

  it('a page hidden for over 10 minutes stops asking', () => {
    expect(at({ hiddenSince: base.now - ALERT_HIDDEN_MAX_MS + 5000 })).toBe('wall');
    expect(at({ hiddenSince: base.now - ALERT_HIDDEN_MAX_MS - 1 })).toBeNull();
  });

  it('never more than one request per call, so at most one per tick', () => {
    for (const anyLive of [true, false]) expect([null, 'wall', 'history']).toContain(at({ anyLive, needBaseline: true }));
  });
});
