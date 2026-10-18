import { describe, expect, it } from 'vitest';
import { ALERT_DAYS_MS, ALERT_HIDDEN_MAX_MS, planFetch, type PollContext } from './alertPolling';

const NOW = 1_000_000_000;
const base: PollContext = {
  now: NOW, lastWall: 0, lastHist: 0, lastDays: NOW - 1000, anyLive: false, competitionDay: false, finishedPending: false,
  needBaseline: false, wantHistory: true, histActive: true, hiddenSince: null,
};
const at = (o: Partial<PollContext>) => planFetch({ ...base, ...o });

describe('alert polling plan', () => {
  it('looks up the competition days first, then once an hour', () => {
    expect(at({ lastDays: 0 })).toBe('days');
    expect(at({ lastDays: NOW - ALERT_DAYS_MS })).toBe('days');
    expect(at({ lastDays: NOW - ALERT_DAYS_MS + 5000 })).toBeNull();
  });

  it('outside competition days nothing is asked (paused)', () => {
    expect(at({})).toBeNull();
    expect(at({ needBaseline: true })).toBeNull();
  });

  it('a competition day, nothing live: the live part every 2 minutes', () => {
    const day = { competitionDay: true, histActive: false };
    expect(at({ ...day, lastWall: NOW - 60000 })).toBeNull();
    expect(at({ ...day, lastWall: NOW - 120000 })).toBe('wall');
  });

  it('a baseline read of the starred climbers goes at once on a competition day', () => {
    expect(at({ competitionDay: true, needBaseline: true, lastWall: NOW - 1000 })).toBe('history');
    expect(at({ competitionDay: true, needBaseline: true, lastWall: NOW - 1000, lastHist: NOW - 1000 })).toBeNull();
  });

  it('live: the live part every 30 s, favorites_live every 2 minutes, never two at once', () => {
    const live = { anyLive: true };
    expect(at({ ...live, lastWall: NOW - 30000, lastHist: NOW - 30000 })).toBe('wall');
    expect(at({ ...live, lastWall: NOW - 10000, lastHist: NOW - 30000 })).toBeNull();
    expect(at({ ...live, lastWall: NOW - 30000, lastHist: NOW - 120000 })).toBe('history');
    expect(at({ ...live, lastWall: NOW - 90000, lastHist: NOW - 200000 })).toBe('history');
  });

  it('no starred climber in a live competition (empty read): the history stops', () => {
    expect(at({ anyLive: true, histActive: false, lastWall: NOW - 10000, lastHist: NOW - 500000 })).toBeNull();
  });

  it('without history events only the live part is read', () => {
    expect(at({ anyLive: true, wantHistory: false, lastWall: NOW - 30000, lastHist: 0 })).toBe('wall');
  });

  it('after the last round ended: one more read, even when nothing is live any more', () => {
    expect(at({ finishedPending: true, lastWall: NOW - 1000, lastHist: NOW - 60000 })).toBe('history');
    expect(at({ finishedPending: true, lastWall: NOW - 1000, lastHist: NOW - 1000 })).toBeNull();
  });

  it('a page hidden for over 10 minutes stops asking', () => {
    const live = { anyLive: true, lastWall: 0, lastHist: NOW - 1000 };
    expect(at({ ...live, hiddenSince: NOW - ALERT_HIDDEN_MAX_MS + 5000 })).toBe('wall');
    expect(at({ ...live, hiddenSince: NOW - ALERT_HIDDEN_MAX_MS - 1 })).toBeNull();
  });
});
