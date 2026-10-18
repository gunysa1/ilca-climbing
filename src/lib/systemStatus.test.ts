import { describe, expect, it } from 'vitest';
import { ago, overallHealth, statusLines, type CronJob, type StatusLine, type SystemStatusData } from './systemStatus';

const NOW = '2026-10-28T10:00:00Z';
const minAgo = (m: number) => new Date(Date.parse(NOW) - m * 60_000).toISOString();
const job = (name: string, o: Partial<CronJob> = {}): CronJob => ({
  name, scheduled: true, active: true, schedule: '* * * * *', last_run: minAgo(1), last_status: 'succeeded', last_message: '1 row',
  last_success: minAgo(1), ...o,
});
const data = (o: Partial<SystemStatusData> = {}): SystemStatusData => ({
  now: NOW,
  cron: [job('rankings-cache'), job('climber-cache'), job('ranking-tables'), job('ifsc-sync', { last_success: minAgo(7 * 60) })],
  cron_error: null,
  rankings: [{ season: '2026-27', built_at: minAgo(3) }],
  rankings_pending: { count: 0, oldest: null },
  climber_cache: { pending: 0, oldest: null, stale_rounds: 0 },
  ranking_tables_due: [],
  ifsc: { last_run: { id: 1, started_at: minAgo(7 * 60), finished_at: minAgo(7 * 60), status: 'ok', error: null }, last_ok: minAgo(7 * 60) },
  ...o,
});
const health = (lines: StatusLine[]) => lines.map((l) => `${l.kind === 'job' ? l.job : l.kind}:${l.health}`);

describe('system status', () => {
  it('all fresh: every line ok', () => {
    const lines = statusLines(data());
    expect(lines.every((l) => l.health === 'ok')).toBe(true);
    expect(overallHealth(lines)).toBe('ok');
  });

  it('a job whose last success is older than 10 minutes is red (the IFSC sync: 26 hours)', () => {
    const d = data({ cron: [job('rankings-cache', { last_success: minAgo(11), last_status: 'failed', last_message: 'ERROR: boom' }),
      job('climber-cache', { last_success: minAgo(9) }), job('ranking-tables'), job('ifsc-sync', { last_success: minAgo(25 * 60) })] });
    const lines = statusLines(d);
    expect(health(lines).slice(0, 4)).toEqual(['rankings-cache:red', 'climber-cache:ok', 'ranking-tables:ok', 'ifsc-sync:ok']);
    expect(lines[0]).toMatchObject({ message: 'ERROR: boom' });
    expect(overallHealth(lines)).toBe('red');
    expect(statusLines(data({ cron: [job('rankings-cache'), job('climber-cache'), job('ranking-tables'),
      job('ifsc-sync', { last_success: minAgo(27 * 60) })] }))[3].health).toBe('red');
  });

  it('a job not scheduled, paused or never successful is red', () => {
    const lines = statusLines(data({ cron: [job('rankings-cache', { scheduled: false, last_success: null }),
      job('climber-cache', { active: false }), job('ranking-tables', { last_success: null }), job('ifsc-sync')] }));
    expect(health(lines).slice(0, 4)).toEqual(['rankings-cache:red', 'climber-cache:red', 'ranking-tables:red', 'ifsc-sync:ok']);
  });

  it('without pg_cron the jobs are unknown, the queues still checked', () => {
    const lines = statusLines(data({ cron: null, cron_error: 'pg_cron is not installed' }));
    expect(health(lines).slice(0, 4)).toEqual(['rankings-cache:unknown', 'climber-cache:unknown', 'ranking-tables:unknown', 'ifsc-sync:unknown']);
    expect(lines[0]).toMatchObject({ message: 'pg_cron is not installed' });
    expect(health(lines).slice(4).every((h) => h.endsWith(':ok'))).toBe(true);
    expect(overallHealth(lines)).toBe('unknown');
  });

  it('work waiting longer than 10 minutes is red', () => {
    const lines = statusLines(data({
      rankings_pending: { count: 2, oldest: minAgo(12) },
      climber_cache: { pending: 40, oldest: minAgo(2), stale_rounds: 3 },
      ranking_tables_due: [{ season: '2026-27', source_built_at: minAgo(15) }, { season: '2025-26', source_built_at: minAgo(1) }],
    }));
    expect(health(lines).slice(4, 7)).toEqual(['rankings_wait:red', 'climber_wait:ok', 'tables_due:red']);
    expect(lines[6]).toMatchObject({ seasons: ['2026-27', '2025-26'], at: minAgo(15) });
  });

  it('tables due: aged by when the stored tables were last built (the payload is rebuilt every minute during an event)', () => {
    const live = (tables: number) => statusLines(data({ ranking_tables_due: [{ season: '2026-27', source_built_at: minAgo(0), tables_built_at: minAgo(tables) }] }))[6];
    expect(live(25)).toMatchObject({ health: 'red', at: minAgo(25) });
    expect(live(1).health).toBe('ok');
  });

  it('IFSC: a failed last run or no good run for 26 hours is red', () => {
    const failed = statusLines(data({ ifsc: { last_run: { id: 2, started_at: minAgo(60), finished_at: minAgo(59), status: 'failed', error: 'IFSC down' }, last_ok: minAgo(25 * 60) } }));
    expect(failed[7]).toMatchObject({ kind: 'ifsc', health: 'red', failed: true, message: 'IFSC down' });
    expect(statusLines(data({ ifsc: { last_run: null, last_ok: null } }))[7].health).toBe('red');
  });

  it('ago: minutes, then hours, then days', () => {
    expect(ago(NOW, minAgo(5))).toEqual({ n: 5, unit: 'min' });
    expect(ago(NOW, minAgo(3 * 60 + 5))).toEqual({ n: 3, unit: 'h' });
    expect(ago(NOW, minAgo(3 * 24 * 60))).toEqual({ n: 3, unit: 'd' });
  });
});
