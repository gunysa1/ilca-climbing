// ILCA national rankings ("מדרג לאומי" / "מדרגי הנוער"), per the ILCA criteria document
// "אמות מידה לקבלה לנבחרות ישראל בטיפוס לשנת 2025" (season 24/25 rules):
//
// Seniors (per discipline and gender): Israeli championship points (table 4 x2) + the best 2 of the
//   premier-league events (table 4 by place) and the international senior events (tables 5-7).
// Youth U21 / U19: premier-league results re-cut per age class (relative place among the class,
//   table 4) - best 2 - plus the youth championship (table 4 x2, place in the class) plus every
//   international youth bonus (table 8). U17: the same with the U17 league.
// Ties in an event share the average of the points of the places they cover (2 decimals). Ties in
// the ranking: the (youth) championship place breaks them, otherwise the rank is shared.
// Only climbers with points > 0 are listed. Admin adjustments (disciplinary deductions) apply last.

export type Discipline = 'boulder' | 'lead';
export type Series = 'premier_league' | 'premier_league_u17' | 'israeli_championship' | 'youth_championship' | 'other';
export type RankClass = 'senior' | 'U21' | 'U19' | 'U17';
export type Gender = 'male' | 'female';
export const RANK_CLASSES: RankClass[] = ['senior', 'U21', 'U19', 'U17'];

/** Table 4 (premier league): points for places 1-30. */
export const LEAGUE_POINTS = [100, 80, 65, 55, 51, 47, 43, 40, 37, 34, 31, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Table 4 points for a place shared by `tied` climbers: the average over the places they cover. */
export function leaguePoints(place: number, tied = 1): number {
  let sum = 0;
  for (let p = place; p < place + tied; p++) sum += LEAGUE_POINTS[p - 1] ?? 0;
  return round2(sum / tied);
}

/** One climber's ranked result in one round (from the `ranking_rounds` view). */
export interface RoundPlacing {
  competition_id: string;
  competition: string;
  starts_on: string;
  series: Series;
  discipline: Discipline;
  category_id: string;
  category: string;
  gender: Gender | 'mixed';
  round: 'qualification' | 'semifinal' | 'final';
  climber_id: string;
  rank: number | null;
}

export interface EventPlace { climber_id: string; place: number; tied: number }

const DEPTH = { qualification: 0, semifinal: 1, final: 2 } as const;

/**
 * Final places in one event pool: the deepest stage a climber reached first, then their rank in it
 * (IFSC overall result). Equal (stage, rank) share the place.
 * LogLig sometimes split one event into categories per stage ("מוקדמות גברים - קבוצה 1/2" then
 * "גברים"; "גברים" 76 then "בוגרים" 6): a category whose climbers all appear in another category of
 * the pool is a later stage of it.
 */
export function eventPlaces(rows: RoundPlacing[]): EventPlace[] {
  const members = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.rank == null) continue;
    if (!members.has(r.category_id)) members.set(r.category_id, new Set());
    members.get(r.category_id)!.add(r.climber_id);
  }
  const stage = new Map<string, number>();
  for (const [cat, set] of members) {
    let n = 0;
    for (const [other, o] of members) if (other !== cat && o.size > set.size && [...set].every((c) => o.has(c))) n++;
    stage.set(cat, n);
  }
  const best = new Map<string, { depth: number; rank: number }>();
  for (const r of rows) {
    if (r.rank == null) continue;
    const d = stage.get(r.category_id)! * 3 + DEPTH[r.round];
    const cur = best.get(r.climber_id);
    if (!cur || d > cur.depth || (d === cur.depth && r.rank < cur.rank)) best.set(r.climber_id, { depth: d, rank: r.rank });
  }
  return relativePlaces([...best.entries()].map(([climber_id, v]) => ({ climber_id, key: [-v.depth, v.rank] })));
}

/** Competition places from sort keys (lower is better); equal keys share the place. */
function relativePlaces(items: { climber_id: string; key: number[] }[]): EventPlace[] {
  const cmp = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const sorted = [...items].sort((a, b) => cmp(a.key, b.key));
  const out: EventPlace[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && cmp(sorted[j + 1].key, sorted[i].key) === 0) j++;
    for (let k = i; k <= j; k++) out.push({ climber_id: sorted[k].climber_id, place: i + 1, tied: j - i + 1 });
    i = j + 1;
  }
  return out;
}

/** Re-cut an event's places to the climbers of one age class (relative place among them). */
export function cutPlaces(places: EventPlace[], keep: (climberId: string) => boolean): EventPlace[] {
  return relativePlaces(places.filter((p) => keep(p.climber_id)).map((p) => ({ climber_id: p.climber_id, key: [p.place] })));
}

/** Youth category name -> age class ("U17 בנים", "בנות U19", "U21 Women"). */
export function classOfCategory(name: string): RankClass | null {
  const m = name.match(/U\s?(17|19|21)/i);
  // "גברים+ U17" / "(U17 ומעלה)" are open categories that include U17 climbers.
  if (!m || /\+\s*U|ומעלה/.test(name)) return null;
  return `U${m[1]}` as RankClass;
}

/** Age class in a season from the birth year: U21 = E-20..E-19, U19 = E-18..E-17, U17 = E-16..E-15 (E = season end year). */
export function classOfBirthYear(birthYear: number, seasonEndYear: number): RankClass | null {
  const age = seasonEndYear - birthYear;
  if (age === 19 || age === 20) return 'U21';
  if (age === 17 || age === 18) return 'U19';
  if (age === 15 || age === 16) return 'U17';
  return null;
}

// ---------------------------------------------------------------------------------- international

export type IntlEventType = 'world_cup' | 'european_cup' | 'european_championship'
  | 'european_youth_cup' | 'european_youth_championship' | 'world_youth_championship' | 'manual';
export const SENIOR_INTL: IntlEventType[] = ['world_cup', 'european_cup', 'european_championship'];
export const YOUTH_INTL: IntlEventType[] = ['european_youth_cup', 'european_youth_championship', 'world_youth_championship'];

export interface IntlResult {
  id?: string;
  climber_id: string;
  discipline: Discipline;
  event_type: IntlEventType;
  event_name: string;
  starts_on: string;
  place: number | null;
  field_size: number | null;
  reached: 'qualification' | 'semifinal' | 'final';
  /** 'manual': points as published by ILCA (e.g. a bonus total), counted as a youth bonus or senior event by `for_class`. */
  points?: number | null;
  for_class?: 'senior' | 'youth' | null;
}

/** Senior international points (tables 5-7, conditions 3.8): 0 when not in the top 60% of the field. */
export function seniorIntlPoints(r: IntlResult): number {
  if (r.event_type === 'manual') return r.for_class === 'senior' ? r.points ?? 0 : 0;
  const { place, field_size: n } = r;
  if (place == null || !n || place / n > 0.6) return 0;
  const boulder = r.discipline === 'boulder';
  const final = r.reached === 'final';
  const semi = r.reached !== 'qualification';
  switch (r.event_type) {
    case 'world_cup':
      if (final && place <= 3) return 300;
      if (final && place <= (boulder ? 6 : 8)) return 200;
      if (semi && place <= (boulder ? 20 : 26)) return 140;
      if (place <= 30) return 100;
      if (place <= 40) return 60;
      return 0;
    case 'european_cup':
      if (final && place <= 3) return 100;
      if (final && place <= 8) return 60;
      return 0;
    case 'european_championship':
      if (final && place <= 3) return 200;
      if (final && place <= 8) return 140;
      if (semi && place <= 24) return 100;
      if (place <= 30) return 60;
      return 0;
    default:
      return 0;
  }
}

/** Youth international bonus (table 8, condition 2.2.5.1): top half of a field of at least 30. */
export function youthBonusPoints(r: IntlResult): number {
  if (r.event_type === 'manual') return r.for_class === 'youth' ? r.points ?? 0 : 0;
  const { place, field_size: n } = r;
  if (place == null || !n || n < 30 || place / n > 0.5) return 0;
  const podium = r.reached === 'final' && place <= 3;
  const table: Partial<Record<IntlEventType, [number, number, number]>> = {
    // [semifinal, final, podium]
    european_youth_cup: [0, 20, 30],
    european_youth_championship: [20, 30, 40],
    world_youth_championship: [30, 40, 50],
  };
  const t = table[r.event_type];
  if (!t) return 0;
  if (podium) return t[2];
  if (r.reached === 'final') return t[1];
  if (r.reached === 'semifinal') return t[0];
  return 0;
}

// ---------------------------------------------------------------------------------- ranking

export interface Adjustment { climber_id: string; discipline: Discipline; rank_class: RankClass | null; points: number; note: string }

export interface EventScore { competition_id: string; label: string; starts_on: string; place: number; points: number; counted: boolean; kind: 'league' | 'intl' }

export interface RankingRow {
  climber_id: string;
  rank: number;
  total: number;
  /** League (and for seniors international) events, with the best 2 marked counted. */
  events: EventScore[];
  championship: { place: number; points: number } | null;
  bonus: number;
  adjustment: number;
}

export interface RankingInput {
  rankClass: RankClass;
  gender: Gender;
  discipline: Discipline;
  rounds: RoundPlacing[];
  /** Age class of each climber in this season (youth rankings). */
  ageClass: Map<string, RankClass>;
  intl: IntlResult[];
  adjustments: Adjustment[];
  /** Profile gender, when known (places international-only climbers in the right table). */
  climberGender?: Map<string, Gender | null>;
}

const youthOnly = (category: string) => classOfCategory(category) !== null;

/** Event pools: rows per competition (and per category for youth championships). */
function pools(rows: RoundPlacing[], pick: (r: RoundPlacing) => boolean): Map<string, RoundPlacing[]> {
  const out = new Map<string, RoundPlacing[]>();
  for (const r of rows) {
    if (!pick(r)) continue;
    const k = r.competition_id;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(r);
  }
  return out;
}

export function computeRanking(input: RankingInput): RankingRow[] {
  const { rankClass, gender, discipline } = input;
  const rows = input.rounds.filter((r) => r.discipline === discipline && (r.gender === gender));
  const youth = rankClass !== 'senior';
  const inClass = (id: string) => !youth || input.ageClass.get(id) === rankClass;

  const acc = new Map<string, { events: EventScore[]; champ: { place: number; points: number } | null; bonus: number }>();
  const get = (id: string) => {
    if (!acc.has(id)) acc.set(id, { events: [], champ: null, bonus: 0 });
    return acc.get(id)!;
  };

  // League events.
  const leagueSeries: Series[] = rankClass === 'U17' ? ['premier_league_u17', 'premier_league'] : ['premier_league'];
  const leaguePools = pools(rows, (r) => leagueSeries.includes(r.series) && (
    rankClass === 'U17'
      // U17: the U17 league, and open league events that include U17 ("גברים+ U17")
      ? r.series === 'premier_league_u17' || /U\s?17/i.test(r.category)
      : !youthOnly(r.category)));
  for (const [, pool] of leaguePools) {
    let places = eventPlaces(pool);
    if (youth) places = cutPlaces(places, inClass);
    for (const p of places) {
      if (!inClass(p.climber_id)) continue;
      get(p.climber_id).events.push({ competition_id: pool[0].competition_id, label: pool[0].competition, starts_on: pool[0].starts_on,
        place: p.place, points: leaguePoints(p.place, p.tied), counted: false, kind: 'league' });
    }
  }

  // Championship: seniors = Israeli championship (open categories); youth = the class category of the youth championship.
  const champPools = youth
    ? pools(rows, (r) => r.series === 'youth_championship' && classOfCategory(r.category) === rankClass)
    : pools(rows, (r) => r.series === 'israeli_championship' && !youthOnly(r.category));
  for (const [, pool] of champPools) {
    for (const p of eventPlaces(pool)) {
      const e = get(p.climber_id);
      const points = round2(2 * leaguePoints(p.place, p.tied));
      if (!e.champ || points > e.champ.points) e.champ = { place: p.place, points };
    }
  }

  // International results.
  for (const r of input.intl) {
    if (r.discipline !== discipline || !inClass(r.climber_id)) continue;
    if (youth) {
      const b = youthBonusPoints(r);
      if (b > 0 || (r.event_type !== 'manual' && YOUTH_INTL.includes(r.event_type))) get(r.climber_id).bonus += b;
    } else if (SENIOR_INTL.includes(r.event_type) || (r.event_type === 'manual' && r.for_class === 'senior')) {
      get(r.climber_id).events.push({ competition_id: r.id ?? r.event_name, label: r.event_name, starts_on: r.starts_on,
        place: r.place ?? 0, points: seniorIntlPoints(r), counted: false, kind: 'intl' });
    }
  }

  const adj = new Map<string, number>();
  for (const a of input.adjustments) {
    if (a.discipline !== discipline || (a.rank_class && a.rank_class !== rankClass)) continue;
    adj.set(a.climber_id, (adj.get(a.climber_id) ?? 0) + a.points);
  }

  const out: Omit<RankingRow, 'rank'>[] = [];
  for (const [climber_id, e] of acc) {
    // the climber must belong to this ranking's gender (pools are per gender; international rows are not)
    const g = input.climberGender?.get(climber_id);
    if (g ? g !== gender : !rows.some((r) => r.climber_id === climber_id)) continue;
    const best = [...e.events].sort((a, b) => b.points - a.points).slice(0, 2);
    for (const ev of best) ev.counted = true;
    e.events.sort((a, b) => a.starts_on.localeCompare(b.starts_on));
    const adjustment = adj.get(climber_id) ?? 0;
    const total = round2(best.reduce((s, x) => s + x.points, 0) + (e.champ?.points ?? 0) + e.bonus + adjustment);
    if (total <= 0) continue;
    out.push({ climber_id, total, events: e.events, championship: e.champ, bonus: e.bonus, adjustment });
  }

  // Total, then the championship place; otherwise shared.
  const champPlace = (r: Omit<RankingRow, 'rank'>) => r.championship?.place ?? Infinity;
  const cmp = (a: Omit<RankingRow, 'rank'>, b: Omit<RankingRow, 'rank'>) =>
    (Math.abs(b.total - a.total) > 1e-9 ? b.total - a.total : 0) || (champPlace(a) === champPlace(b) ? 0 : champPlace(a) - champPlace(b));
  out.sort(cmp);
  const ranked: RankingRow[] = [];
  out.forEach((r, i) => ranked.push({ ...r, rank: i > 0 && cmp(out[i - 1], r) === 0 ? ranked[i - 1].rank : i + 1 }));
  return ranked;
}
