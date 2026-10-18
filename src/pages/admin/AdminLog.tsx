import { useEffect, useState } from 'react';
import { localized, useI18n, type MsgKey } from '../../lib/i18n';
import { ADMIN_LOG_COLUMNS, logFields, logProfileIds, type AdminLogEntry, type AdminLogTable, type LogField } from '../../lib/adminLog';
import { supabase } from '../../lib/supabase';
import { ErrorLine } from './AdminHome';

const TABLE_KEY: Record<AdminLogTable, MsgKey> = {
  competitions: 'logTableCompetitions', rounds: 'logTableRounds', judge_assignments: 'logTableJudges',
  user_roles: 'logTableRoles', appeals: 'logTableAppeals',
};
const ACTION_KEY = { insert: 'logInsert', update: 'logUpdate', delete: 'logDelete' } as const;
const FIELD_KEY: Record<string, MsgKey> = {
  status: 'status', kind: 'round', scoring: 'scoring', advance_quota: 'advanceQuota', judge_id: 'judge', climber_id: 'athlete',
  boulder_id: 'boulder', role: 'roles', name: 'nameEn', name_he: 'nameHe', venue: 'venue', starts_on: 'startsOn',
  ends_on: 'endsOn', season: 'season', series: 'series',
};
const VALUE_KEY: Record<string, MsgKey> = {
  planned: 'planned', live: 'liveNow', closed: 'closed', draft: 'draft', published: 'published', finished: 'finished',
  qualification: 'qualification', semifinal: 'semifinal', final: 'final', open: 'appealOpen', upheld: 'appealUpheld',
  rejected: 'appealRejected', female: 'female', male: 'male', mixed: 'mixed', judge: 'judge', coach: 'coach', admin: 'admin',
};
const LIMIT = 100;

/** The admin_log entries of a round or a competition (migration 045), newest first. stamp: reload when it
 * changes (the page's own reload after a change). roundLabel / boulderNo name rounds and boulders by id. */
export function AdminLog({ by, id, stamp, roundLabel, boulderNo }: {
  by: 'round_id' | 'competition_id'; id: string; stamp?: unknown;
  roundLabel?: Map<string, string>; boulderNo?: Map<string, number>;
}) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<AdminLogEntry[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error: e } = await supabase.from('admin_log').select(ADMIN_LOG_COLUMNS).eq(by, id)
        .order('at', { ascending: false }).order('id', { ascending: false }).limit(LIMIT);
      const entries = (data as AdminLogEntry[] | null) ?? [];
      const ids = logProfileIds(entries);
      const { data: who } = ids.length ? await supabase.from('profiles').select('id, full_name, full_name_he').in('id', ids) : { data: [] };
      if (!live) return;
      setRows(entries);
      setNames(new Map(((who ?? []) as { id: string; full_name: string; full_name_he: string | null }[])
        .map((p) => [p.id, localized(lang, p.full_name, p.full_name_he)])));
      setError(e?.message ?? null);
    })();
    return () => { live = false; };
  }, [by, id, stamp, lang]);

  const value = (field: string, v: unknown): string => {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? '✓' : '✗';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (field === 'judge_id' || field === 'climber_id') return names.get(s) ?? s.slice(0, 8);
    if (field === 'boulder_id') return boulderNo?.has(s) ? `#${boulderNo.get(s)}` : s.slice(0, 8);
    return VALUE_KEY[s] ? t(VALUE_KEY[s]) : s;
  };
  const fieldText = (f: LogField) => `${FIELD_KEY[f.field] ? t(FIELD_KEY[f.field]) : f.field}: `
    + (f.before !== undefined ? `${value(f.field, f.before)} → ` : '') + value(f.field, f.after);

  return (
    <div className="panel">
      <h2>{t('adminLogTitle')}</h2>
      <p className="muted small">{t('adminLogHint')}</p>
      <ErrorLine error={error} />
      {rows.length === 0 && <p className="muted">{t('empty')}</p>}
      <table className="admin-table admin-log">
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="muted small">{new Date(e.at).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB')}</td>
              <td>{e.actor_id ? names.get(e.actor_id) ?? '?' : t('logSystem')}</td>
              <td>
                {t(TABLE_KEY[e.table_name])}
                {e.round_id && roundLabel?.get(e.round_id) ? ` (${roundLabel.get(e.round_id)})` : ''}
                {' '}{t(ACTION_KEY[e.action])}
              </td>
              <td className="small">{logFields(e).map(fieldText).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
