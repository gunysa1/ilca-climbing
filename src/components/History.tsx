import { useEffect, useState } from 'react';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { HistoryRow } from '../lib/types';

const ROUND_ORDER = { qualification: 0, semifinal: 1, final: 2 } as const;

/** A climber's results across competitions, newest first. */
export function History({ climberId }: { climberId: string }) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);

  useEffect(() => {
    setRows(null);
    supabase.from('climber_history').select('*').eq('climber_id', climberId).neq('round_status', 'planned')
      .order('starts_on', { ascending: false })
      .then(({ data }) => setRows(((data as HistoryRow[]) ?? [])
        .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || ROUND_ORDER[b.round] - ROUND_ORDER[a.round])));
  }, [climberId]);

  if (rows === null) return <p className="muted">{t('loading')}</p>;
  if (rows.length === 0) return <p className="muted">{t('empty')}</p>;

  const competitions = new Set(rows.map((r) => r.competition_id)).size;
  const best = Math.min(...rows.map((r) => r.rank));

  return (
    <>
      <div className="stats">
        <div className="stat"><span className="stat-value">{competitions}</span><span className="muted">{t('competitions')}</span></div>
        <div className="stat"><span className="stat-value">{rows.length}</span><span className="muted">{t('rounds')}</span></div>
        <div className="stat"><span className="stat-value">{best}</span><span className="muted">{t('bestRank')}</span></div>
      </div>
      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr>
              <th>{t('date')}</th>
              <th className="name">{t('competition')}</th>
              <th>{t('category')}</th>
              <th>{t('round')}</th>
              <th>{t('rank')}</th>
              <th>{t('tops')}</th>
              <th>{t('zones')}</th>
              <th>{t('points')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.competition_id}:${r.category}:${r.round}`}>
                <td>{new Date(r.starts_on).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}</td>
                <td className="name">{localized(lang, r.competition, r.competition_he)}</td>
                <td>{localized(lang, r.category, r.category_he)}</td>
                <td>{t(r.round)}</td>
                <td className="rank">{r.rank}<span className="muted small">/{r.starters}</span></td>
                <td>{r.tops}</td>
                <td>{r.zones}</td>
                <td className="score">{Number(r.points).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
