// IFSC result rules for the daily sync (no Deno or network), ported from tools/ifsc/scrape.py and match.py.

export type IntlEventType = 'world_cup' | 'world_championship' | 'european_cup' | 'european_championship'
  | 'european_youth_cup' | 'european_youth_championship' | 'world_youth_championship';

/** Event type from the IFSC event name (IFSC names until 2025, "World Climbing" names after), or null for events ILCA does not count. */
export function eventType(name: string): IntlEventType | null {
  const n = name.toLowerCase();
  const youth = n.includes('youth');
  const europe = n.includes('europe');
  const champs = n.includes('championship');
  const cupLike = n.includes('cup') || n.includes('series');
  if (n.includes('world championships') && !youth) return 'world_championship';
  if (youth) {
    if (champs) return europe ? 'european_youth_championship' : 'world_youth_championship';
    if (europe && cupLike) return 'european_youth_cup';
  } else {
    if (europe && champs) return 'european_championship';
    if (europe && cupLike) return 'european_cup';
    if (n.includes('world cup') || n.startsWith('world climbing series')) return 'world_cup';
  }
  return null;
}

/** ILCA criteria season of an event date: the calendar year counts ('2026-05-01' is '2026-27'). */
export function ilcaSeason(date: string): string {
  const y = Number(date.slice(0, 4));
  return `${y}-${String(y + 1).slice(2)}`;
}

/** Season of today's date; seasons run September to August. */
export function currentSeason(today: string): string {
  const y = Number(today.slice(0, 4));
  const start = Number(today.slice(5, 7)) >= 9 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/** Today's date (YYYY-MM-DD) in Israel: the sync runs at 03:00 UTC, but the window and the 1 January list follow
 *  the local calendar. */
export function localDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/** Furthest round an athlete reached: the last round with a score or rank. */
export function reachedOf(rounds: { round_name: string; score?: string | null; rank?: number | null }[]): 'qualification' | 'semifinal' | 'final' {
  const done = rounds.filter((r) => r.score || r.rank);
  const last = (done.length ? done[done.length - 1].round_name : 'qualification').toLowerCase();
  if (last.includes('semi')) return 'semifinal';
  return last.includes('final') ? 'final' : 'qualification';
}

const HE: Record<string, string> = {
  'א': 'a', 'ב': 'b', 'ג': 'g', 'ד': 'd', 'ה': 'h', 'ו': 'o', 'ז': 'z', 'ח': 'h', 'ט': 't', 'י': 'i', 'כ': 'k', 'ך': 'k',
  'ל': 'l', 'מ': 'm', 'ם': 'm', 'נ': 'n', 'ן': 'n', 'ס': 's', 'ע': 'a', 'פ': 'p', 'ף': 'f', 'צ': 'tz', 'ץ': 'tz', 'ק': 'k',
  'ר': 'r', 'ש': 'sh', 'ת': 't', ' ': ' ', '-': ' ', "'": '',
};

/** Consonant skeleton, so 'Yonatan' and 'יונתן' compare: drop vowels, unify similar sounds. */
export function skeleton(name: string): string {
  let s = [...name.toLowerCase().normalize('NFKD')]
    .filter((c) => !/\p{M}/u.test(c))
    .map((c) => HE[c] ?? c)
    .join('');
  s = s.replaceAll('ph', 'f').replaceAll('ch', 'h').replaceAll('kh', 'h').replaceAll('ts', 'tz').replaceAll('c', 'k')
    .replaceAll('w', 'v').replaceAll('y', 'i').replaceAll('j', 'i').replaceAll('q', 'k');
  s = s.replaceAll('p', 'f').replaceAll('v', 'b');
  return [...s].filter((c) => !'aeiouh '.includes(c)).join('');
}

/** Matched characters of Python's difflib.SequenceMatcher (longest block, then recursively left and right). */
function matched(a: string, b: string, alo: number, ahi: number, blo: number, bhi: number): number {
  let best = 0, bi = alo, bj = blo;
  let prev = new Array<number>(bhi - blo + 1).fill(0);
  for (let i = alo; i < ahi; i++) {
    const cur = new Array<number>(bhi - blo + 1).fill(0);
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const k = prev[j - blo] + 1;
      cur[j - blo + 1] = k;
      if (k > best) { best = k; bi = i - k + 1; bj = j - k + 1; }
    }
    prev = cur;
  }
  if (!best) return 0;
  return best + matched(a, b, alo, bi, blo, bj) + matched(a, b, bi + best, ahi, bj + best, bhi);
}

function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  return total ? (2 * matched(a, b, 0, a.length, 0, b.length)) / total : 1;
}

/** 0..1 (2 decimals): how well the IFSC name fits a profile's Hebrew or Latin name, in either name order. */
export function nameScore(first: string, last: string, he: string | null, full: string | null): number {
  const target = skeleton(he || full || '');
  const lat = skeleton(`${first} ${last}`);
  const lat2 = skeleton(`${last} ${first}`);
  const s1 = Math.max(ratio(lat, target), ratio(lat2, target));
  const s2 = ratio(lat, skeleton(full || ''));
  return Math.round(Math.max(s1, s2) * 100) / 100;
}

export interface Candidate { id: string; full_name: string | null; full_name_he: string | null; gender: string | null; birth_date: string | null }

/**
 * Confident profile for an IFSC athlete: exactly one profile with the same birth date (and gender, when both known),
 * name score at least 0.5 and no runner-up within 0.15. Otherwise pending, suggesting the best birth-date candidate.
 */
export function pickMatch(
  a: { firstname: string; lastname: string; gender: string | null; birthday: string | null },
  profiles: Candidate[],
): { status: 'match'; profileId: string; score: number } | { status: 'pending'; suggestion: string | null; score: number | null } {
  const g = a.gender === 'male' || a.gender === 'female' ? a.gender : null;
  const scored = (a.birthday ? profiles.filter((p) => p.birth_date === a.birthday && (!p.gender || !g || p.gender === g)) : [])
    .map((p) => ({ p, score: nameScore(a.firstname, a.lastname, p.full_name_he, p.full_name) }))
    .sort((x, y) => y.score - x.score);
  const best = scored[0];
  if (!best) return { status: 'pending', suggestion: null, score: null };
  if (best.score >= 0.5 && (scored.length === 1 || scored[1].score < best.score - 0.15)) return { status: 'match', profileId: best.p.id, score: best.score };
  return { status: 'pending', suggestion: best.p.id, score: best.score };
}
