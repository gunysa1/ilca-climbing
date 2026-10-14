import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { RoundStatus } from '../components/RoundStatus';
import { localized, useI18n } from '../lib/i18n';
import { resultKey, useRoundData, type ResultRow } from '../lib/roundData';
import { boulderPoints, EMPTY_RESULT, rank, totals } from '../lib/scoring';

/** IFSC-style tile: top half filled on a top, bottom half on a zone, slash when attempted without zone. */
function Cell({ r, number }: { r: ResultRow | undefined; number: number }) {
  const attempted = !!r && r.attempts > 0;
  const cls = !attempted ? 'asc-empty' : r.zone_attempt == null ? 'asc-none' : '';
  return (
    <span className="asc" title={attempted ? `${boulderPoints(r)}` : undefined}>
      <span className={`asc-cell ${cls}`}>
        <span className={`asc-top${r?.top_attempt != null ? ' on' : ''}`}>{r?.top_attempt ?? ''}</span>
        <span className={`asc-zone${r?.zone_attempt != null ? ' on' : ''}`}>{r?.zone_attempt ?? ''}</span>
      </span>
      <span className="asc-label">{number}</span>
    </span>
  );
}

export function RoundResults() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, prevRanks, loading } = useRoundData(id);

  const ranked = useMemo(() => {
    if (!round) return [];
    const rows = starters.map((s) => ({
      ...totals(s.climber_id, boulders.map((b) => results.get(resultKey(b.id, s.climber_id)) ?? EMPTY_RESULT)),
      prev_rank: prevRanks.get(s.climber_id) ?? null,
    }));
    return rank(rows, round.scoring);
  }, [round, starters, boulders, results, prevRanks]);

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
              <th className="rank">{t('rank')}</th>
              <th className="name">{t('athlete')}</th>
              <th className="score">{round.scoring === 'ifsc2025' ? t('points') : `${t('tops')}/${t('zones')}`}</th>
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
                    <span className="athlete-meta">{[s.bib, s.profile.club].filter(Boolean).join(' • ')}</span>
                    <span className="ascents">
                      {boulders.map((b) => <Cell key={b.id} number={b.number} r={results.get(resultKey(b.id, row.climber_id))} />)}
                    </span>
                  </td>
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
