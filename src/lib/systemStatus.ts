// The admin home's "system" box: system_status() (migration 045) -> one line per background job and per
// queue, each ok / red / unknown. Red: a job's last success is older than 10 minutes (the daily IFSC sync: 26
// hours), it is not scheduled, or work has waited longer than 10 minutes (the jobs run every minute). Unknown:
// pg_cron is not readable (the local test database). Pure.

export interface CronJob {
  name: string; scheduled: boolean; active: boolean; schedule: string | null;
  last_run: string | null; last_status: string | null; last_message: string | null; last_success: string | null;
}
export interface IfscRun { id: number; started_at: string; finished_at: string | null; status: 'running' | 'ok' | 'failed'; error: string | null }
export interface SystemStatusData {
  now: string;
  cron: CronJob[] | null;
  cron_error: string | null;
  rankings: { season: string; built_at: string }[];
  rankings_pending: { count: number; oldest: string | null };
  climber_cache: { pending: number; oldest: string | null; stale_rounds: number };
  /** tables_built_at: when the season's stored tables were last built (null: never). */
  ranking_tables_due: { season: string; source_built_at: string; tables_built_at?: string | null }[];
  ifsc: { last_run: IfscRun | null; last_ok: string | null };
}

export type Health = 'ok' | 'red' | 'unknown';
export const JOBS = ['rankings-cache', 'climber-cache', 'ranking-tables', 'ifsc-sync'] as const;
export type JobName = typeof JOBS[number];
const MIN = 60_000;
/** How old a job's last success may be. */
export const JOB_LIMIT_MS: Record<JobName, number> = {
  'rankings-cache': 10 * MIN, 'climber-cache': 10 * MIN, 'ranking-tables': 10 * MIN, 'ifsc-sync': 26 * 60 * MIN,
};
/** How long work may wait in a queue (changes not yet rebuilt, ranking tables due). */
export const QUEUE_LIMIT_MS = 10 * MIN;

export type StatusLine =
  | { kind: 'job'; job: JobName; health: Health; at: string | null; message: string | null; scheduled: boolean }
  | { kind: 'rankings_wait' | 'climber_wait'; health: Health; count: number; at: string | null }
  | { kind: 'tables_due'; health: Health; seasons: string[]; at: string | null }
  | { kind: 'ifsc'; health: Health; at: string | null; failed: boolean; message: string | null };

const age = (now: number, at: string | null) => (at ? now - Date.parse(at) : Infinity);

export function statusLines(d: SystemStatusData): StatusLine[] {
  const now = Date.parse(d.now);
  const lines: StatusLine[] = JOBS.map((job) => {
    const j = d.cron?.find((x) => x.name === job);
    if (!d.cron) return { kind: 'job', job, health: 'unknown', at: null, message: d.cron_error, scheduled: false };
    if (!j || !j.scheduled || !j.active) return { kind: 'job', job, health: 'red', at: j?.last_success ?? null, message: null, scheduled: false };
    return {
      kind: 'job', job, health: age(now, j.last_success) > JOB_LIMIT_MS[job] ? 'red' : 'ok', at: j.last_success,
      message: j.last_status && j.last_status !== 'succeeded' ? j.last_message ?? j.last_status : null, scheduled: true,
    };
  });
  const wait = (kind: 'rankings_wait' | 'climber_wait', count: number, oldest: string | null): StatusLine =>
    ({ kind, health: count > 0 && age(now, oldest) > QUEUE_LIMIT_MS ? 'red' : 'ok', count, at: oldest });
  lines.push(wait('rankings_wait', d.rankings_pending.count, d.rankings_pending.oldest));
  lines.push(wait('climber_wait', d.climber_cache.pending, d.climber_cache.oldest));
  // How long the build has not kept up: since the stored tables were last built (the cached payload's own age stays
  // small during an event, it is rebuilt every minute). Right after a quiet spell a new result can show red until the
  // next build (a minute or two). No stored tables yet: since the payload was built.
  const due = d.ranking_tables_due;
  const dueSince = (x: SystemStatusData['ranking_tables_due'][number]) => x.tables_built_at ?? x.source_built_at;
  const oldestDue = due.reduce<string | null>((m, x) => (m == null || dueSince(x) < m ? dueSince(x) : m), null);
  lines.push({ kind: 'tables_due', health: due.length > 0 && age(now, oldestDue) > QUEUE_LIMIT_MS ? 'red' : 'ok', seasons: due.map((x) => x.season), at: oldestDue });
  const run = d.ifsc.last_run;
  const failed = run?.status === 'failed';
  lines.push({ kind: 'ifsc', health: failed || age(now, d.ifsc.last_ok) > JOB_LIMIT_MS['ifsc-sync'] ? 'red' : 'ok', at: d.ifsc.last_ok, failed, message: failed ? run?.error ?? null : null });
  return lines;
}

/** The box's colour: red if any line is red, unknown if any line is unknown (never "all good" with jobs unseen). */
export const overallHealth = (lines: StatusLine[]): Health =>
  lines.some((l) => l.health === 'red') ? 'red' : lines.some((l) => l.health === 'unknown') ? 'unknown' : 'ok';

/** How long ago, in whole minutes / hours / days (for "5 min ago"). */
export function ago(now: string, at: string): { n: number; unit: 'min' | 'h' | 'd' } {
  const m = Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / MIN));
  if (m < 120) return { n: m, unit: 'min' };
  if (m < 48 * 60) return { n: Math.floor(m / 60), unit: 'h' };
  return { n: Math.floor(m / (24 * 60)), unit: 'd' };
}
