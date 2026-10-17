import { describe, expect, it } from 'vitest';
import {
  classOfBirthYear, classOfCategory, computeRanking, cutPlaces, eventPlaces, leaguePoints, seniorIntlPoints, youthBonusPoints,
  type IntlResult, type RoundPlacing, type Series,
} from './rankings';
import { ILCA_2025, ILCA_2027 } from './criteria';

// Cases from the ILCA criteria document (2025), appendices A and B.

let seq = 0;
/** A one-round event where `places` gives each climber's final place (equal numbers = tie). */
function event(series: Series, places: Record<string, number>, opts: Partial<RoundPlacing> = {}): RoundPlacing[] {
  const id = `c${++seq}`;
  return Object.entries(places).map(([climber_id, rank]) => ({
    competition_id: id, competition: id, starts_on: `2025-01-${String(seq).padStart(2, '0')}`, series, discipline: 'lead',
    category_id: `${id}-cat`, category: 'נשים', gender: 'female', round: 'final', climber_id, rank, ...opts,
  }));
}
/** Fill an event so `who` finishes at `place` (others take the remaining places). */
function placed(series: Series, who: string, place: number, tiedWith = 0, opts: Partial<RoundPlacing> = {}): RoundPlacing[] {
  const p: Record<string, number> = { [who]: place };
  for (let i = 1; i <= place + tiedWith + 2; i++) if (i !== place) p[`${who}-other-${seq}-${i}`] = i;
  for (let t = 0; t < tiedWith; t++) p[`${who}-tie-${seq}-${t}`] = place;
  return event(series, p, opts);
}
const intl = (r: Partial<IntlResult>): IntlResult => ({
  climber_id: 'x', discipline: 'lead', event_type: 'world_cup', event_name: 'WC', starts_on: '2024-06-01',
  place: 1, field_size: 100, reached: 'qualification', ...r,
});

describe('league points (table 4)', () => {
  it('places 1-30, ties share the average of the places they cover', () => {
    expect([1, 2, 3, 10, 20, 30, 31].map((p) => leaguePoints(p))).toEqual([100, 80, 65, 34, 12, 1, 0]);
    expect(leaguePoints(2, 3)).toBe(66.67); // (80 + 65 + 55) / 3 = 66.66... (2 decimals)
    expect(leaguePoints(4, 3)).toBe(51);    // (55 + 51 + 47) / 3
  });
});

describe('event places', () => {
  it('deepest round first, then the rank in it; equal results share the place', () => {
    const rows: RoundPlacing[] = [
      ...event('premier_league', { a: 1, b: 2, c: 3, d: 3, e: 5 }, { round: 'qualification' }),
    ].map((r) => ({ ...r, competition_id: 'k' }));
    rows.push({ ...rows[0], round: 'final', climber_id: 'c', rank: 1 }, { ...rows[0], round: 'final', climber_id: 'e', rank: 2 });
    expect(eventPlaces(rows).map((p) => [p.climber_id, p.place, p.tied])).toEqual([
      ['c', 1, 1], ['e', 2, 1], ['a', 3, 1], ['b', 4, 1], ['d', 5, 1],
    ]);
  });
  it('an event split into stage categories (LogLig 2024 championship): the later category ranks first', () => {
    const row = (category_id: string, round: RoundPlacing['round'], climber_id: string, rank: number): RoundPlacing => ({
      competition_id: 'champ', competition: 'champ', starts_on: '2024-02-22', series: 'israeli_championship', discipline: 'boulder',
      category_id, category: category_id, gender: 'male', round, climber_id, rank });
    const rows = [
      // qualification groups (category "מוקדמות גברים -"): everyone
      row('q', 'qualification', 'a', 1), row('q', 'qualification', 'b', 1), row('q', 'qualification', 'c', 2), row('q', 'qualification', 'd', 3),
      // "גברים": the next stage ("מוקדמות לגמר", imported as a qualification) and the final
      row('m', 'qualification', 'a', 2), row('m', 'qualification', 'b', 1), row('m', 'qualification', 'c', 3),
      row('m', 'final', 'a', 1), row('m', 'final', 'b', 2),
    ];
    expect(eventPlaces(rows).map((p) => [p.climber_id, p.place])).toEqual([['a', 1], ['b', 2], ['c', 3], ['d', 4]]);
  });
  it('age-class cut: relative places among the class', () => {
    const places = eventPlaces(event('premier_league', { a: 1, y1: 2, b: 3, y2: 3, y3: 5 }));
    expect(cutPlaces(places, (id) => id.startsWith('y')).map((p) => [p.climber_id, p.place, p.tied]))
      .toEqual([['y1', 1, 1], ['y2', 2, 1], ['y3', 3, 1]]);
  });
});

describe('classes', () => {
  it('youth class from the category name; open "+ U17" categories are not youth-only', () => {
    expect(['U17 בנים', 'בנות U19', 'U21 Women', 'גברים+ U17', 'נשים (U17 ומעלה)', 'גברים'].map(classOfCategory))
      .toEqual(['U17', 'U19', 'U21', null, null, null]);
  });
  it('season 24/25: U21 born 2005-2006, U19 2007-2008, U17 2009-2010', () => {
    expect([2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011].map((y) => classOfBirthYear(y, 2025)))
      .toEqual([null, 'U21', 'U21', 'U19', 'U19', 'U17', 'U17', null]);
  });
});

describe('international points', () => {
  it('appendix A: world cup lead 25/63 (semi) = 140, 33/82 = 60, 29/59 = 100', () => {
    expect(seniorIntlPoints(intl({ place: 25, field_size: 63, reached: 'semifinal' }))).toBe(140);
    expect(seniorIntlPoints(intl({ place: 33, field_size: 82 }))).toBe(60);
    expect(seniorIntlPoints(intl({ place: 29, field_size: 59 }))).toBe(100);
  });
  it('appendix A, example 2: boulder world cup 35/93 = 60, 5/57 final = 200; European cup 8/67 final = 60, 3/48 podium = 100', () => {
    expect(seniorIntlPoints(intl({ discipline: 'boulder', place: 35, field_size: 93 }))).toBe(60);
    expect(seniorIntlPoints(intl({ discipline: 'boulder', place: 5, field_size: 57, reached: 'final' }))).toBe(200);
    expect(seniorIntlPoints(intl({ discipline: 'boulder', event_type: 'european_cup', place: 8, field_size: 67, reached: 'final' }))).toBe(60);
    expect(seniorIntlPoints(intl({ discipline: 'boulder', event_type: 'european_cup', place: 3, field_size: 48, reached: 'final' }))).toBe(100);
  });
  it('World Championships score 0 until ILCA publishes their table', () => {
    expect(seniorIntlPoints(intl({ event_type: 'world_championship', place: 1, field_size: 60, reached: 'final' }))).toBe(0);
  });
  it('only the top 60% of the field score', () => {
    expect(seniorIntlPoints(intl({ place: 38, field_size: 60 }))).toBe(0);
  });
  it('appendix B: youth bonus needs the top half of a field of 30+', () => {
    expect(youthBonusPoints(intl({ event_type: 'european_youth_cup', place: 9, field_size: 37, reached: 'final' }))).toBe(20);
    expect(youthBonusPoints(intl({ event_type: 'european_youth_cup', place: 15, field_size: 42, reached: 'semifinal' }))).toBe(0);
    expect(youthBonusPoints(intl({ event_type: 'european_youth_championship', place: 17, field_size: 46, reached: 'semifinal' }))).toBe(20);
    expect(youthBonusPoints(intl({ event_type: 'world_youth_championship', place: 13, field_size: 39, reached: 'semifinal' }))).toBe(30);
    expect(youthBonusPoints(intl({ event_type: 'world_youth_championship', place: 3, field_size: 29, reached: 'final' }))).toBe(0);
  });
});

describe('rankings (appendix examples)', () => {
  it('appendix A, example 1: league 4th (3-way tie), 2nd, 3rd; championship 3rd; world cups -> 370', () => {
    const rounds = [
      ...placed('premier_league', 'me', 4, 2), ...placed('premier_league', 'me', 2), ...placed('premier_league', 'me', 3),
      ...placed('israeli_championship', 'me', 3),
    ];
    const wc = [intl({ climber_id: 'me', place: 25, field_size: 63, reached: 'semifinal' }),
      intl({ climber_id: 'me', place: 33, field_size: 82 }), intl({ climber_id: 'me', place: 29, field_size: 59 })];
    const r = computeRanking({ criteria: ILCA_2025, rankClass: 'senior', gender: 'female', discipline: 'lead', rounds, ageClass: new Map(), intl: wc, adjustments: [] });
    const me = r.find((x) => x.climber_id === 'me')!;
    expect(me.total).toBe(370);
    expect(me.championship).toMatchObject({ place: 3, points: 130, competition_id: expect.any(String), label: expect.any(String) });
    expect(me.events.filter((e) => e.counted).map((e) => e.points).sort()).toEqual([100, 140]);
  });

  it('appendix A, example 2: no championship; best two of league and international -> 300', () => {
    const o = { discipline: 'boulder' as const, gender: 'male' as const, category: 'גברים' };
    const rounds = [...placed('premier_league', 'me', 2, 0, o), ...placed('premier_league', 'me', 3, 0, o), ...placed('premier_league', 'me', 2, 0, o)];
    const b = (r: Partial<IntlResult>) => intl({ climber_id: 'me', discipline: 'boulder', ...r });
    const res = [b({ event_type: 'european_cup', place: 8, field_size: 67, reached: 'final' }),
      b({ event_type: 'european_cup', place: 3, field_size: 48, reached: 'final' }),
      b({ place: 35, field_size: 93 }), b({ place: 5, field_size: 57, reached: 'final' })];
    const r = computeRanking({ criteria: ILCA_2025, rankClass: 'senior', gender: 'male', discipline: 'boulder', rounds, ageClass: new Map(), intl: res, adjustments: [] });
    expect(r.find((x) => x.climber_id === 'me')!.total).toBe(300);
  });

  it('appendix B: U21 league 4th, 5th, 7th in the class; youth championship 6th; bonus 20+20+30 -> 270', () => {
    const age = new Map<string, 'U21'>();
    const cls = (rows: RoundPlacing[]) => { rows.forEach((r) => age.set(r.climber_id, 'U21')); return rows; };
    const rounds = [
      ...cls(placed('premier_league', 'me', 4)), ...cls(placed('premier_league', 'me', 5)), ...cls(placed('premier_league', 'me', 7)),
      ...placed('youth_championship', 'me', 6, 0, { category: 'U21 בנות' }),
    ];
    const y = (r: Partial<IntlResult>) => intl({ climber_id: 'me', ...r });
    const res = [y({ event_type: 'european_youth_cup', place: 9, field_size: 37, reached: 'final' }),
      y({ event_type: 'european_youth_cup', place: 15, field_size: 42, reached: 'semifinal' }),
      y({ event_type: 'european_youth_championship', place: 17, field_size: 46, reached: 'semifinal' }),
      y({ event_type: 'world_youth_championship', place: 13, field_size: 39, reached: 'semifinal' })];
    const r = computeRanking({ criteria: ILCA_2025, rankClass: 'U21', gender: 'female', discipline: 'lead', rounds, ageClass: age, intl: res, adjustments: [] });
    const me = r.find((x) => x.climber_id === 'me')!;
    expect([me.total, me.bonus, me.championship?.points]).toEqual([270, 70, 94]);
  });

  it('seniors: climbers below the minimum age are left out and the rest re-ranked among themselves', () => {
    // "נשים+ U17": the U17 climber y wins; a, b move up to 1st and 2nd among the seniors.
    const rounds = [...event('premier_league', { y: 1, a: 2, b: 3 }), ...event('israeli_championship', { y: 1, a: 2 })];
    const r = computeRanking({ criteria: ILCA_2025, rankClass: 'senior', gender: 'female', discipline: 'lead', rounds, ageClass: new Map(),
      tooYoung: new Set(['y']), intl: [intl({ climber_id: 'y', place: 1, field_size: 10 })], adjustments: [] });
    expect(r.map((x) => [x.climber_id, x.total])).toEqual([['a', 300], ['b', 80]]);
  });

  it('ranking ties: the championship place breaks them, otherwise shared; adjustments apply', () => {
    // a: 100 + 130 (3rd) + 10 = 240; b: 80 + 160 (2nd) = 240 -> b first (better championship place)
    const rounds = [...event('premier_league', { a: 1, b: 2 }), ...event('israeli_championship', { c: 1, b: 2, a: 3 }),
      ...event('premier_league', { d: 1, e: 1 })];
    const r = computeRanking({ criteria: ILCA_2025, rankClass: 'senior', gender: 'female', discipline: 'lead', rounds, ageClass: new Map(), intl: [],
      adjustments: [{ climber_id: 'a', discipline: 'lead', rank_class: null, points: 10, note: 'test' },
        { climber_id: 'c', discipline: 'lead', rank_class: null, points: -150, note: 'penalty' }] });
    expect(r.map((x) => [x.climber_id, x.rank, x.total])).toEqual([['b', 1, 240], ['a', 2, 240], ['d', 3, 90], ['e', 3, 90], ['c', 5, 50]]);
  });
});

describe('ILCA 2027', () => {
  const senior = (rounds: RoundPlacing[], worldRank?: Map<string, number>, opts: { intl?: IntlResult[]; tooYoung?: Set<string> } = {}) =>
    computeRanking({ criteria: ILCA_2027, rankClass: 'senior', gender: 'female', discipline: 'lead', rounds, ageClass: new Map(),
      intl: opts.intl ?? [], adjustments: [], worldRank, tooYoung: opts.tooYoung });
  const me = (r: ReturnType<typeof computeRanking>) => r.find((x) => x.climber_id === 'me');

  it('world rank 14 (300) replaces the weaker league event: 130 + 300 + 100 = 530', () => {
    const rounds = [...placed('premier_league', 'me', 1), ...placed('premier_league', 'me', 2), ...placed('israeli_championship', 'me', 3)];
    const m = me(senior(rounds, new Map([['me', 14]])))!;
    expect(m.total).toBe(530);
    expect(m.events.filter((e) => e.counted).map((e) => [e.kind, e.points])).toEqual([['world', 300], ['league', 100]]);
    expect(m.events.find((e) => e.kind === 'world')).toEqual({ kind: 'world', label: 'דירוג עולמי 14', place: 14, points: 300,
      competition_id: 'world-ranking', starts_on: '', counted: true });
  });

  it('one league event and world rank 35 -> 200', () => {
    expect(me(senior(placed('premier_league', 'me', 1), new Map([['me', 35]])))!.total).toBe(200);
  });

  it('world rank 5 alone -> 400, listed without league events', () => {
    const r = computeRanking({ criteria: ILCA_2027, rankClass: 'senior', gender: 'female', discipline: 'lead', rounds: [], ageClass: new Map(),
      intl: [], adjustments: [], worldRank: new Map([['me', 5]]), climberGender: new Map([['me', 'female']]) });
    expect(r.map((x) => [x.climber_id, x.total])).toEqual([['me', 400]]);
  });

  it('world rank 50 scores nothing', () => {
    const m = me(senior(placed('premier_league', 'me', 1), new Map([['me', 50]])))!;
    expect(m.total).toBe(100);
    expect(m.events.some((e) => e.kind === 'world')).toBe(false);
  });

  it('climbers below the senior minimum age are not listed, whatever their world rank', () => {
    const r = senior(placed('premier_league', 'me', 1), new Map([['me', 1]]), { tooYoung: new Set(['me']) });
    expect(me(r)).toBeUndefined();
  });

  it('international events score 0 (shown, never counted over league)', () => {
    const rounds = [...placed('premier_league', 'me', 1), ...placed('premier_league', 'me', 2)];
    const m = me(senior(rounds, undefined, { intl: [intl({ climber_id: 'me', place: 3, field_size: 50, reached: 'final' })] }))!;
    expect(m.total).toBe(180);
    const wc = m.events.find((e) => e.kind === 'intl')!;
    expect([wc.points, wc.counted]).toEqual([0, false]);
  });

  it('no world ranking at all: league + championship', () => {
    const rounds = [...placed('premier_league', 'me', 1), ...placed('premier_league', 'me', 2), ...placed('israeli_championship', 'me', 3)];
    expect(me(senior(rounds))!.total).toBe(310);
  });

  it('youth: World Youth Championships final 2nd = 100, European youth cup win = 0', () => {
    const age = new Map([['me', 'U21' as const]]);
    const y = (r: Partial<IntlResult>) => intl({ climber_id: 'me', ...r });
    const run = (res: IntlResult[]) => computeRanking({ criteria: ILCA_2027, rankClass: 'U21', gender: 'female', discipline: 'lead',
      rounds: placed('premier_league', 'me', 1), ageClass: age, intl: res, adjustments: [] });
    expect(me(run([y({ event_type: 'world_youth_championship', place: 2, field_size: 20, reached: 'final' })]))!.bonus).toBe(100);
    expect(me(run([y({ event_type: 'european_youth_cup', place: 1, field_size: 60, reached: 'final' })]))!.bonus).toBe(0);
  });

  it('U17: open league events ("גברים+ U17") count under 2025, not under 2027', () => {
    const rounds = event('premier_league', { me: 1, a: 2 }, { category: 'גברים+ U17', gender: 'male' });
    const run = (criteria: typeof ILCA_2025) => computeRanking({ criteria, rankClass: 'U17', gender: 'male', discipline: 'lead', rounds,
      ageClass: new Map([['me', 'U17']]), intl: [], adjustments: [] });
    expect(me(run(ILCA_2025))?.total).toBe(100);
    expect(me(run(ILCA_2027))).toBeUndefined();
  });
});
