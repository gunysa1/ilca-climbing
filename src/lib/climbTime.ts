// Lead climbing time (lead_results.time_ms): what the judge types and what the results show. In a
// lead final the faster time breaks a tie left after countback (src/lib/lead.ts, SQL lead_scores).

/** Longest time accepted (a lead attempt is 6 minutes; room for a slow stopwatch); shortest: 1 s. */
const MAX_MS = 60 * 60_000;
const MIN_MS = 1000;

/**
 * The typed time in ms: seconds with optional decimals ("95", "95.4"; what the judge pad asks for, its
 * phone keypad has no ":") or minutes:seconds with two-digit seconds ("1:35", "1:35.4"; the admin form);
 * a comma works as the decimal point. Empty: null (no time). Anything else, zero or over an
 * hour, or under a second: undefined (invalid).
 */
export function parseClimbTime(text: string): number | null | undefined {
  const s = text.trim().replace(',', '.');
  if (s === '') return null;
  let seconds: number;
  const ms = /^(\d{1,2}):([0-5]\d(?:\.\d{1,3})?)$/.exec(s);
  if (ms) seconds = Number(ms[1]) * 60 + Number(ms[2]);
  else if (/^\d{1,4}(?:\.\d{1,3})?$/.test(s)) seconds = Number(s);
  else return undefined;
  const out = Math.round(seconds * 1000);
  return out >= MIN_MS && out <= MAX_MS ? out : undefined;
}

/** m:ss with the decimals that were typed ("3:08", "2:10.5", "0:52.25"); empty for no time. */
export function formatClimbTime(ms: number | null | undefined): string {
  if (ms == null || !(ms > 0)) return '';
  const minutes = Math.floor(ms / 60_000);
  const rest = ms - minutes * 60_000;
  const whole = Math.floor(rest / 1000);
  const frac = rest % 1000 ? `.${String(rest % 1000).padStart(3, '0').replace(/0+$/, '')}` : '';
  return `${minutes}:${String(whole).padStart(2, '0')}${frac}`;
}

/** The time as the judge pad's field shows it: seconds, like the judge types it ("83.4", "118"). */
export const formatSeconds = (ms: number | null | undefined) => (ms == null || !(ms > 0) ? '' : String(ms / 1000));

/** The round records climbing times where they rank (lead.ts, SQL lead_scores): a lead final on one route
 *  whose ties break on time (not switched off). */
export const isTimedRound = (round: { scoring: string; kind: string; time_tiebreak?: boolean } | null | undefined, routes: number) =>
  !!round && round.scoring === 'lead' && round.kind === 'final' && round.time_tiebreak !== false && routes === 1;

/** The lead row the judge pad queues (src/lib/saveQueue.ts): the whole result. `time_ms` only in timed
 *  rounds, so a pad elsewhere never clears a time an admin entered. TOP has no "+". */
export function leadPadRow(p: { routeId: string; climberId: string; roundId: string; hold: number; plus: boolean; top: boolean;
  timed: boolean; timeMs: number | null }): Record<string, unknown> {
  return { boulder_id: p.routeId, climber_id: p.climberId, round_id: p.roundId, hold: p.hold, plus: p.top ? false : p.plus, top: p.top,
    ...(p.timed ? { time_ms: p.timeMs } : {}) };
}
