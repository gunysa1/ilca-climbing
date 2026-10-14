import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { RoundStatus } from '../components/RoundStatus';
import { localized, useI18n } from '../lib/i18n';
import { resultKey, useRoundData, type ResultRow } from '../lib/roundData';
import { boulderPoints, rank, totals } from '../lib/scoring';

function Cell({ r }: { r: ResultRow | undefined }) {
  if (!r || r.attempts === 0) return <span className="bcell bcell-empty" />;
  const cls = r.top_attempt != null ? 'bcell-top' : r.zone_attempt != null ? 'bcell-zone' : 'bcell-none';
  return (
    <span className={`bcell ${cls}`} title={`${boulderPoints(r)}`}>
      <span className="bcell-t">{r.top_attempt ?? ''}</span>
      <span className="bcell-z">{r.zone_attempt ?? ''}</span>
    </span>
  );
}

export function RoundResults() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, loading } = useRoundData(id);

  const ranked = useMemo(() => {
    if (!round) return [];
    const rows = starters.map((s) =>
      totals(s.climber_id, boulders.map((b) => results.get(resultKey(b.id, s.climber_id)) ?? { attempts: 0, zone_attempt: null, top_attempt: null })));
    return rank(rows, round.scoring);
  }, [round, starters, boulders, results]);

  const byId = new Map(starters.map((s) => [s.climber_id, s]));

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!round) return <p className="muted">{t('empty')}</p>;

  return (
    <section>
      <h1>{t(round.kind)} <RoundStatus status={round.status} /></h1>
      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr>
              <th>{t('rank')}</th>
              <th className="name">{t('athlete')}</th>
              {boulders.map((b) => <th key={b.id}>{b.number}</th>)}
              <th>{round.scoring === 'ifsc2025' ? t('points') : `${t('tops')}/${t('zones')}`}</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => {
              const s = byId.get(row.climber_id)!;
              return (
                <tr key={row.climber_id}>
                  <td className="rank">{row.rank}</td>
                  <td className="name">
                    <span className="athlete">{localized(lang, s.profile.full_name, s.profile.full_name_he)}</span>
                    {s.profile.club && <span className="muted small">{s.profile.club}</span>}
                  </td>
                  {boulders.map((b) => <td key={b.id}><Cell r={results.get(resultKey(b.id, row.climber_id))} /></td>)}
                  <td className="score">
                    {round.scoring === 'ifsc2025'
                      ? row.points.toFixed(1)
                      : `${row.tops}T${row.zones}z ${row.top_attempts} ${row.zone_attempts}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
