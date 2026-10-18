import { describe, expect, it } from 'vitest';
import { formatClimbTime, isTimedRound, leadPadRow, parseClimbTime } from './climbTime';

describe('climbing time', () => {
  it('reads seconds, with or without decimals (comma too)', () => {
    expect(parseClimbTime('95')).toBe(95_000);
    expect(parseClimbTime(' 95.4 ')).toBe(95_400);
    expect(parseClimbTime('95,25')).toBe(95_250);
    expect(parseClimbTime('188')).toBe(188_000);
  });

  it('reads minutes:seconds', () => {
    expect(parseClimbTime('3:08')).toBe(188_000);
    expect(parseClimbTime('2:10.5')).toBe(130_500);
    expect(parseClimbTime('0:52.25')).toBe(52_250);
    expect(parseClimbTime('1:05')).toBe(65_000);
  });

  it('empty is no time; anything else is invalid', () => {
    expect(parseClimbTime('')).toBeNull();
    expect(parseClimbTime('   ')).toBeNull();
    for (const bad of ['0', '0:00', 'abc', '1:60', '1:5', '1:5.5', '1:2:3', '-5', '2.5.1', '61:00', '99999']) expect(parseClimbTime(bad), bad).toBeUndefined();
  });

  it('shows m:ss with the decimals that matter', () => {
    expect(formatClimbTime(188_000)).toBe('3:08');
    expect(formatClimbTime(130_500)).toBe('2:10.5');
    expect(formatClimbTime(52_250)).toBe('0:52.25');
    expect(formatClimbTime(null)).toBe('');
    expect(formatClimbTime(undefined)).toBe('');
  });

  it('format and parse round-trip', () => {
    for (const ms of [1_000, 52_250, 95_400, 130_500, 188_000, 359_999]) expect(parseClimbTime(formatClimbTime(ms))).toBe(ms);
  });

  it('only one-route lead finals with the time tie-break record times', () => {
    expect(isTimedRound({ scoring: 'lead', kind: 'final' }, 1)).toBe(true);
    expect(isTimedRound({ scoring: 'lead', kind: 'final', time_tiebreak: true }, 1)).toBe(true);
    expect(isTimedRound({ scoring: 'lead', kind: 'final', time_tiebreak: false }, 1)).toBe(false);
    expect(isTimedRound({ scoring: 'lead', kind: 'final' }, 2)).toBe(false); // time ranks on one route only
    expect(isTimedRound({ scoring: 'lead', kind: 'semifinal' }, 1)).toBe(false);
    expect(isTimedRound({ scoring: 'ifsc2025', kind: 'final' }, 1)).toBe(false);
    expect(isTimedRound(null, 1)).toBe(false);
  });

  it('the pad row carries time_ms in timed rounds only; TOP drops the +', () => {
    const base = { routeId: 'r1', climberId: 'c1', roundId: 'f1', hold: 35, plus: true, top: false };
    expect(leadPadRow({ ...base, timed: true, timeMs: 130_000 }))
      .toEqual({ boulder_id: 'r1', climber_id: 'c1', round_id: 'f1', hold: 35, plus: true, top: false, time_ms: 130_000 });
    expect(leadPadRow({ ...base, timed: true, timeMs: null })).toHaveProperty('time_ms', null);
    expect(leadPadRow({ ...base, timed: false, timeMs: 130_000 })).not.toHaveProperty('time_ms');
    expect(leadPadRow({ ...base, top: true, timed: false, timeMs: null })).toMatchObject({ plus: false, top: true });
  });
});
