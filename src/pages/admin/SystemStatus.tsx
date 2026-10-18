import { useCallback, useEffect, useState } from 'react';
import { useI18n, type MsgKey } from '../../lib/i18n';
import { isMissingInDb } from '../../lib/schemaMissing';
import { supabase } from '../../lib/supabase';
import { ago, overallHealth, statusLines, type JobName, type StatusLine, type SystemStatusData } from '../../lib/systemStatus';
import { ErrorLine } from './AdminHome';

const JOB_KEY: Record<JobName, MsgKey> = {
  'rankings-cache': 'sysJobRankings', 'climber-cache': 'sysJobClimber', 'ranking-tables': 'sysJobTables', 'ifsc-sync': 'sysJobIfsc',
};
const LINE_KEY = { rankings_wait: 'sysRankingsWait', climber_wait: 'sysClimberWait', tables_due: 'sysTablesDue', ifsc: 'sysIfscRun' } as const;
const REFRESH_MS = 60_000;

/** The admin home's "system" box: the background jobs and queues (system_status(), migration 045), red when
 * something is late. Reloads every minute while open. */
export function SystemStatus() {
  const { t } = useI18n();
  const [data, setData] = useState<SystemStatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);  // the database has no system_status() yet (before db push)

  const load = useCallback(async () => {
    const { data: d, error: e } = await supabase.rpc('system_status');
    setMissing(isMissingInDb(e));
    setError(e?.message ?? null);
    if (!e) setData(d as SystemStatusData);
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (missing) return null;
  if (!data) return error ? <div className="panel"><ErrorLine error={error} /></div> : null;
  const lines = statusLines(data);
  const overall = overallHealth(lines);
  /** "3 min" */
  const span = (at: string) => {
    const a = ago(data.now, at);
    return t(a.unit === 'min' ? 'sysAgoMin' : a.unit === 'h' ? 'sysAgoH' : 'sysAgoD').replace('{n}', String(a.n));
  };
  /** "3 min ago", or "never" */
  const since = (at: string | null) => (at ? t('sysAgo').replace('{ago}', span(at)) : t('sysNever'));

  function detail(l: StatusLine): string {
    switch (l.kind) {
      case 'job':
        if (l.health === 'unknown') return '';
        if (!l.scheduled) return t('sysNotScheduled');
        return `${t('sysLastSuccess')}: ${since(l.at)}${l.message ? ` · ${l.message}` : ''}`;
      case 'rankings_wait':
      case 'climber_wait': {
        const stale = l.kind === 'climber_wait' && data!.climber_cache.stale_rounds > 0
          ? ` · ${t('sysStaleRounds').replace('{n}', String(data!.climber_cache.stale_rounds))}` : '';
        return (l.count === 0 ? t('sysNone') : t('sysWaiting').replace('{n}', String(l.count)).replace('{ago}', l.at ? span(l.at) : '?')) + stale;
      }
      case 'tables_due':
        return l.seasons.length === 0 ? t('sysNone') : `${l.seasons.join(', ')} · ${since(l.at)}`;
      case 'ifsc':
        return `${since(l.at)}${l.failed ? ` · ${t('sysFailed')}${l.message ? `: ${l.message}` : ''}` : ''}`;
    }
  }

  return (
    <div className={`panel system-status${overall === 'red' ? ' sys-red' : ''}`}>
      <div className="panel-head">
        <h2>{t('sysTitle')}
          <span className={`badge ${overall === 'red' ? 'badge-live' : overall === 'ok' ? 'badge-closed' : ''}`}>
            {t(overall === 'red' ? 'sysProblem' : overall === 'unknown' ? 'sysPartlyUnknown' : 'sysOk')}
          </span>
        </h2>
        <button className="link" onClick={() => void load()}>{t('sysRefresh')}</button>
      </div>
      <ErrorLine error={error} />
      {data.cron === null && <p className="muted small">{t('sysCronUnknown')}</p>}
      <ul className="sys-lines">
        {lines.map((l) => (
          <li key={l.kind === 'job' ? l.job : l.kind} className={l.health}>
            <span className={`sys-dot ${l.health}`} aria-hidden="true" />
            <span>{t(l.kind === 'job' ? JOB_KEY[l.job] : LINE_KEY[l.kind])}</span>
            <span className={l.health === 'red' ? '' : 'muted small'}>{detail(l)}</span>
          </li>
        ))}
        {data.rankings.length > 0 && (
          <li className="ok">
            <span className="sys-dot" aria-hidden="true" />
            <span>{t('sysRankingsBuilt')}</span>
            <span className="muted small">{data.rankings.map((r) => `${r.season}: ${since(r.built_at)}`).join(' · ')}</span>
          </li>
        )}
      </ul>
    </div>
  );
}
