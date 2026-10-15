// Lead scoring (IFSC). Mirrors public.lead_scores in the SQL migration; keep both in sync
// (tests in lead.test.ts and supabase/tests/rls_test.sql use the same cases).
//
// Per route a climber's height is the highest hold controlled, "+" when they made a controlled
// move past it, or TOP. One route: rank by height. Several routes: on each route tied climbers share
// the average of their positions (rank points); the round score is the geometric mean of the route
// rank points, lower is better. Then countback to the previous-round place; in a final (single
// route), then the faster climbing time; remaining ties share.

export interface LeadResult {
  climber_id: string;
  route_id: string;
  hold: number;
  plus: boolean;
  top: boolean;
  /** Climbing time; breaks remaining ties in a final (IFSC rule). */
  time_ms?: number | null;
}

/** Comparable height: TOP above any hold, hold+ above hold. */
export function heightValue(r: Pick<LeadResult, 'hold' | 'plus' | 'top'>): number {
  return r.top ? 1_000_000 : r.hold * 2 + (r.plus ? 1 : 0);
}

export function formatHeight(r: Pick<LeadResult, 'hold' | 'plus' | 'top'>): string {
  return r.top ? 'TOP' : `${r.hold}${r.plus ? '+' : ''}`;
}

/** Rank points on one route: position by height, ties share the average of their positions. */
export function routeRankPoints(results: LeadResult[]): Map<string, number> {
  const sorted = [...results].sort((a, b) => heightValue(b) - heightValue(a));
  const out = new Map<string, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && heightValue(sorted[j + 1]) === heightValue(sorted[i])) j++;
    const avg = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) out.set(sorted[k].climber_id, avg);
    i = j + 1;
  }
  return out;
}

export interface LeadStanding {
  climber_id: string;
  /** Single route: height value; several routes: geometric mean of rank points. */
  points: number;
  /** Per route id: the climber's result, if any. */
  results: Map<string, LeadResult>;
  rank: number | null;
}

const EPS = 1e-9;

/**
 * Standings for a lead round. `starters` in start order; `prevPlace` = countback seeds.
 * Climbers without any result get rank null and follow the ranked ones in start order.
 * `isFinal`: on a single route, time breaks ties left after countback (finals only, like LogLig).
 */
export function leadStandings(
  starters: string[], routeIds: string[], results: LeadResult[], prevPlace: Map<string, number>, isFinal = false,
): LeadStanding[] {
  const byClimber = new Map<string, Map<string, LeadResult>>();
  for (const res of results) {
    if (!byClimber.has(res.climber_id)) byClimber.set(res.climber_id, new Map());
    byClimber.get(res.climber_id)!.set(res.route_id, res);
  }
  const climbed = starters.filter((c) => byClimber.has(c));
  const multi = routeIds.length > 1;

  const points = new Map<string, number>();
  if (multi) {
    const logSum = new Map<string, number>(climbed.map((c) => [c, 0]));
    for (const route of routeIds) {
      // Ranked starters without a result on this route count as the lowest height (hold 0).
      const onRoute = climbed.map((c) => byClimber.get(c)!.get(route) ?? { climber_id: c, route_id: route, hold: 0, plus: false, top: false });
      for (const [c, p] of routeRankPoints(onRoute)) logSum.set(c, logSum.get(c)! + Math.log(p));
    }
    for (const c of climbed) points.set(c, Math.exp(logSum.get(c)! / routeIds.length));
  } else {
    for (const c of climbed) {
      const res = byClimber.get(c)!.get(routeIds[0]);
      points.set(c, res ? heightValue(res) : 0);
    }
  }

  // Better first: lower geometric mean (multi) or higher height (single); then countback.
  const cmp = (a: string, b: string) => {
    const pa = points.get(a)!; const pb = points.get(b)!;
    if (Math.abs(pa - pb) > EPS) return multi ? pa - pb : pb - pa;
    const sa = prevPlace.get(a) ?? Infinity; const sb = prevPlace.get(b) ?? Infinity;
    if (sa !== sb) return sa - sb;
    if (multi || !isFinal) return 0;
    const ta = byClimber.get(a)!.get(routeIds[0])?.time_ms ?? Infinity;
    const tb = byClimber.get(b)!.get(routeIds[0])?.time_ms ?? Infinity;
    return ta === tb ? 0 : ta - tb;
  };
  const ranked = [...climbed].sort((a, b) => cmp(a, b) || starters.indexOf(a) - starters.indexOf(b));
  const out: LeadStanding[] = [];
  ranked.forEach((c, i) => {
    const prev = out[i - 1];
    const rank = prev && cmp(ranked[i - 1], c) === 0 ? prev.rank : i + 1;
    out.push({ climber_id: c, points: points.get(c)!, results: byClimber.get(c)!, rank });
  });
  for (const c of starters.filter((s) => !byClimber.has(s))) out.push({ climber_id: c, points: 0, results: new Map(), rank: null });
  return out;
}
