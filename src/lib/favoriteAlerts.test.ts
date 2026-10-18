import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, diffAlerts, EMPTY_STATE, parseSettings, parseState, trimState, type AlertInput, type AlertSettings } from './favoriteAlerts';
import type { HomeLiveRound } from './home';
import type { HistoryRow } from './types';

const names = new Map([['a', { full_name: 'Avi', full_name_he: 'אבי' }], ['b', { full_name: 'Bar', full_name_he: null }]]);
const live = (onWall: { climber: string; boulder?: string; number?: number }[], scoring: HomeLiveRound['scoring'] = 'ifsc2025'): HomeLiveRound[] => [{
  round_id: 'r1', kind: 'final', scoring, category: { id: 'c', name: 'Men', name_he: null, gender: 'male' },
  competition: { id: 'k', name: 'Cup', name_he: 'גביע' },
  on_wall: onWall.map((w) => ({ climber_id: w.climber, boulder_id: w.boulder ?? 'b1', number: w.number ?? 1, full_name: w.climber === 'a' ? 'Avi' : 'Other', full_name_he: null })),
}];
const hist = (o: Partial<HistoryRow>): HistoryRow => ({
  climber_id: 'a', competition_id: 'k', competition: 'Cup', competition_he: null, starts_on: '2026-10-28', category: 'Men', category_he: null,
  round: 'qualification', round_status: 'live', tops: 1, zones: 1, top_attempts: 2, zone_attempts: 1, points: 24.8, rank: 3, starters: 20,
  discipline: 'ifsc2025', round_id: 'r1', ...o,
});
const input = (o: Partial<AlertInput>): AlertInput => ({ favorites: ['a'], names, live: null, history: null, ...o });
const run = (state = EMPTY_STATE, i: AlertInput, s: AlertSettings = DEFAULT_SETTINGS) => diffAlerts(state, i, s);

describe('favorite alerts', () => {
  it('the first look is a baseline: nothing is told', () => {
    const r = run(EMPTY_STATE, input({ live: live([{ climber: 'a' }]), history: [hist({}), hist({ round: 'final', round_id: 'r2', round_status: 'closed', rank: 1 })] }));
    expect(r.alerts).toEqual([]);
    expect(r.state.wallKnown).toBe(true);
    expect(r.state.known).toEqual(['a']);
  });

  it('tells when a favorite gets on the wall, only favorites, and only once', () => {
    const s0 = run(EMPTY_STATE, input({ live: live([]) })).state;
    const r1 = run(s0, input({ live: live([{ climber: 'a', number: 3 }, { climber: 'x' }]) }));
    expect(r1.alerts.map((a) => [a.kind, a.climber_id, a.boulder, a.name])).toEqual([['wall', 'a', 3, 'Avi']]);
    expect(run(r1.state, input({ live: live([{ climber: 'a', number: 3 }]) })).alerts).toEqual([]);
    // off the wall and on a next boulder / again: new
    const off = run(r1.state, input({ live: live([]) })).state;
    expect(run(off, input({ live: live([{ climber: 'a', boulder: 'b2', number: 4 }]) })).alerts).toHaveLength(1);
  });

  it('lead alerts carry no boulder number', () => {
    const s0 = run(EMPTY_STATE, input({ live: live([]) })).state;
    expect(run(s0, input({ live: live([{ climber: 'a' }], 'lead') })).alerts[0].boulder).toBeUndefined();
  });

  it('a skipped fetch keeps the wall as it was', () => {
    const s1 = run(run(EMPTY_STATE, input({ live: live([]) })).state, input({ live: live([{ climber: 'a' }]) })).state;
    const s2 = run(s1, input({ history: [] })).state;
    expect(run(s2, input({ live: live([{ climber: 'a' }]) })).alerts).toEqual([]);
  });

  it('tells a new result in a live round when the climber\'s totals change', () => {
    const s0 = run(EMPTY_STATE, input({ history: [hist({})] })).state;
    expect(run(s0, input({ history: [hist({})] })).alerts).toEqual([]);
    // somebody else climbed: the place moves, the climber's own result does not
    expect(run(s0, input({ history: [hist({ rank: 4 })] })).alerts).toEqual([]);
    const r = run(s0, input({ history: [hist({ tops: 2, top_attempts: 3, points: 49.6, rank: 1 })] }));
    expect(r.alerts.map((a) => [a.kind, a.rank, a.of])).toEqual([['result', 1, 20]]);
    expect(run(r.state, input({ history: [hist({ tops: 2, top_attempts: 3, points: 49.6, rank: 1 })] })).alerts).toEqual([]);
  });

  const lead = (o: Partial<HistoryRow>) => hist({ discipline: 'lead', tops: null, zones: null, top_attempts: null, zone_attempts: null, points: null, own: '12', rank: 5, ...o });

  it("lead: alerts on the climber's own heights, not when others move their place", () => {
    const s0 = run(EMPTY_STATE, input({ history: [lead({})] })).state;
    expect(run(s0, input({ history: [lead({ rank: 2 })] })).alerts).toEqual([]);
    const r = run(s0, input({ history: [lead({ own: '30+', rank: 1 })] }));
    expect(r.alerts.map((a) => [a.kind, a.rank])).toEqual([['result', 1]]);
  });

  it('lead: the final place once when the round is finished, not twice with a podium', () => {
    const s0 = run(EMPTY_STATE, input({ history: [lead({})] })).state;
    const r = run(s0, input({ history: [lead({ round_status: 'closed', rank: 7 })] }));
    expect(r.alerts.map((a) => a.key)).toEqual(['resultfinal:r1:a']);
    expect(run(r.state, input({ history: [lead({ round_status: 'closed', rank: 7 })] })).alerts).toEqual([]);
    const f = run(s0, input({ history: [lead({ round: 'final', round_status: 'closed', rank: 2, first_round: true })] }));
    expect(f.alerts.map((a) => a.kind)).toEqual(['podium']);
  });

  it('a closed boulder round never gives a result alert', () => {
    const s0 = run(EMPTY_STATE, input({ history: [hist({})] })).state;
    expect(run(s0, input({ history: [hist({ round_status: 'closed', tops: 3, own: '3|3|4|3' })] })).alerts).toEqual([]);
  });

  it('the first round of a category is not an advance, whatever its kind', () => {
    const s0 = run(EMPTY_STATE, input({ history: [] })).state;
    expect(run(s0, input({ history: [hist({ round: 'final', round_status: 'planned', rank: null, first_round: true })] })).alerts).toEqual([]);
    expect(run(s0, input({ history: [hist({ round: 'final', round_status: 'planned', rank: null, first_round: false })] })).alerts).toHaveLength(1);
  });

  it('after a gap of more than a day the next read is a silent baseline', () => {
    const t0 = 1_800_000_000_000;
    const s0 = diffAlerts(EMPTY_STATE, input({ history: [], now: t0 }), DEFAULT_SETTINGS).state;
    const rows = [hist({ round: 'final', round_id: 'old', round_status: 'closed', rank: 1, first_round: false })];
    expect(diffAlerts(s0, input({ history: rows, now: t0 + 3600_000 }), DEFAULT_SETTINGS).alerts).toHaveLength(2); // advance + podium, within the day
    const late = diffAlerts(s0, input({ history: rows, now: t0 + 25 * 3600_000 }), DEFAULT_SETTINGS);
    expect(late.alerts).toEqual([]);
    expect(late.state.lastRead).toBe(t0 + 25 * 3600_000);
    const more = [...rows, hist({ round: 'final', round_id: 'new', round_status: 'closed', rank: 2, first_round: false })];
    expect(diffAlerts(late.state, input({ history: more, now: t0 + 25 * 3600_000 + 60_000 }), DEFAULT_SETTINGS).alerts).toHaveLength(2);
  });

  it('a climber who has not climbed yet (no rank) does not alert', () => {
    const s0 = run(EMPTY_STATE, input({ history: [] })).state;
    expect(run(s0, input({ history: [hist({ rank: null, tops: 0, zones: 0 })] })).alerts).toEqual([]);
  });

  it('tells advancing to a later round, once', () => {
    const s0 = run(EMPTY_STATE, input({ history: [hist({ round_status: 'closed' })] })).state;
    const rows = [hist({ round_status: 'closed' }), hist({ round: 'final', round_id: 'r2', round_status: 'planned', rank: null, tops: 0, zones: 0 })];
    const r = run(s0, input({ history: rows }));
    expect(r.alerts.map((a) => [a.kind, a.round_kind])).toEqual([['advance', 'final']]);
    expect(run(r.state, input({ history: rows })).alerts).toEqual([]);
  });

  it('tells a podium finish of a finished final: places 1 to 3 only', () => {
    const s0 = run(EMPTY_STATE, input({ favorites: ['a', 'b'], history: [] })).state;
    const rows = [
      hist({ round: 'final', round_id: 'r2', round_status: 'closed', rank: 3 }),
      hist({ climber_id: 'b', round: 'final', round_id: 'r2', round_status: 'closed', rank: 4 }),
      hist({ round: 'semifinal', round_id: 'r3', round_status: 'closed', rank: 1 }),
    ];
    const r = run(s0, input({ favorites: ['a', 'b'], history: rows }));
    expect(r.alerts.filter((a) => a.kind === 'podium').map((a) => [a.climber_id, a.rank])).toEqual([['a', 3]]);
  });

  it('a newly starred climber is a baseline too: their old podiums stay quiet', () => {
    const s0 = run(EMPTY_STATE, input({ history: [] })).state;
    const old = hist({ climber_id: 'b', round: 'final', round_id: 'old', round_status: 'closed', rank: 1 });
    const r = run(s0, input({ favorites: ['a', 'b'], history: [old] }));
    expect(r.alerts).toEqual([]);
    expect(r.state.known.sort()).toEqual(['a', 'b']);
  });

  it('a climber unstarred and starred again is a baseline again', () => {
    const row = hist({ round: 'final', round_id: 'f2', round_status: 'planned', rank: null, first_round: false });
    const s0 = run(EMPTY_STATE, input({ history: [] })).state;
    const s1 = run(s0, input({ favorites: [], history: [] })).state; // unstarred
    const s2 = run(s1, input({ favorites: [], history: [row] })).state; // it advanced meanwhile
    expect(run(s2, input({ favorites: ['a'], history: [row] })).alerts).toEqual([]);
  });

  it('settings filter what is told but the state still advances', () => {
    const s0 = run(EMPTY_STATE, input({ live: live([]) })).state;
    const off: AlertSettings = { enabled: true, kinds: { wall: false, result: true, advance: true, podium: true } };
    const r = run(s0, input({ live: live([{ climber: 'a' }]) }), off);
    expect(r.alerts).toEqual([]);
    expect(run(r.state, input({ live: live([{ climber: 'a' }]) })).alerts).toEqual([]); // not told late, either
  });

  it('parses stored settings and state defensively', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{"enabled":true,"kinds":{"wall":false}}')).toEqual({ enabled: true, kinds: { wall: false, result: true, advance: true, podium: true } });
    expect(parseState('[1]').seen).toEqual({});
    expect(parseState('{"wallKnown":true,"wall":["x",1],"known":["a"]}')).toEqual({ wallKnown: true, wall: ['x'], seen: {}, known: ['a'], lastRead: 0 });
  });

  it('trims the remembered keys, keeping the newest', () => {
    const seen = Object.fromEntries(Array.from({ length: 1600 }, (_, i) => [`k${i}`, '1']));
    const t = trimState({ ...EMPTY_STATE, seen });
    expect(Object.keys(t.seen)).toHaveLength(1500);
    expect(t.seen.k1599).toBe('1');
    expect(t.seen.k0).toBeUndefined();
  });
});
