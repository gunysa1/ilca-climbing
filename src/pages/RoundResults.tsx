import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RoundStatus } from '../components/RoundStatus';
import { localized, useI18n, type Lang } from '../lib/i18n';
import { formatHeight, leadStandings } from '../lib/lead';
import { resultKey, toLeadResult, useRoundData, type LeadRow, type ResultRow, type Starter } from '../lib/roundData';
import { boulderPoints, EMPTY_RESULT, standings, totals, type ScoringFormat } from '../lib/scoring';
import type { Boulder } from '../lib/types';

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

/** Lead route result chip: "30+", "TOP", or dashed when not climbed yet. */
function RouteChip({ r, number }: { r: LeadRow | undefined; number: number }) {
  return (
    <span className="asc">
      <span className={`route-chip${r?.top ? ' top' : ''}${r ? '' : ' empty'}`}>{r ? formatHeight(r) : ''}</span>
      <span className="asc-label">{number}</span>
    </span>
  );
}

interface Row { climber_id: string; rank: number | null; score: string }

export function RoundResults() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, leadResults, loading } = useRoundData(id);
  const [ageClass, setAgeClass] = useState<string | null>(null);
  const ageClasses = useMemo(() => [...new Set(starters.map((s) => s.age_class).filter((a): a is string => !!a))].sort(), [starters]);

  // Within an age-class filter the ranking is recomputed among those climbers (like the
  // temporary app's per-category results inside a combined group).
  const shown = useMemo(() => starters.filter((s) => !ageClass || s.age_class === ageClass), [starters, ageClass]);
  const rows = useMemo<Row[]>(() => {
    if (!round) return [];
    if (round.scoring === 'lead') {
      const multi = boulders.length > 1;
      const seeds = new Map(shown.filter((s) => s.prev_place != null).map((s) => [s.climber_id, s.prev_place!]));
      return leadStandings(shown.map((s) => s.climber_id), boulders.map((b) => b.id), [...leadResults.values()].map(toLeadResult), seeds)
        // single route: the height is on the route chip; several routes: the geometric mean of rank points
        .map((s) => ({ climber_id: s.climber_id, rank: s.rank, score: s.rank === null ? '–' : multi ? s.points.toFixed(2) : '' }));
    }
    const format = round.scoring as ScoringFormat;
    const totalsRows = shown.map((s) => ({
      ...totals(s.climber_id, boulders.map((b) => results.get(resultKey(b.id, s.climber_id)) ?? EMPTY_RESULT)),
      prev_rank: s.prev_place,
    }));
    const climbed = new Set(shown.filter((s) => boulders.some((b) => (results.get(resultKey(b.id, s.climber_id))?.attempts ?? 0) > 0))
      .map((s) => s.climber_id));
    return standings(totalsRows, format, climbed).map((r) => ({
      climber_id: r.climber_id, rank: r.rank,
      score: r.rank === null ? '–' : format === 'ifsc2025'
        ? r.points.toFixed(1) : `${r.tops}T${r.zones}z ${r.top_attempts} ${r.zone_attempts}`,
    }));
  }, [round, shown, boulders, results, leadResults]);

  const byId = new Map(starters.map((s) => [s.climber_id, s]));

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!round) return <p className="muted">{t('empty')}</p>;
  const lead = round.scoring === 'lead';
  const scoreHeader = lead ? (boulders.length > 1 ? t('rankPoints') : '')
    : round.scoring === 'ifsc2025' ? t('points') : `${t('tops')}/${t('zones')}`;

  return (
    <section>
      <h1>{t(round.kind)} <RoundStatus status={round.status} /></h1>
      {ageClasses.length > 0 && (
        <div className="chips">
          <button className={`chip ${ageClass === null ? 'selected' : ''}`} onClick={() => setAgeClass(null)}>{t('all')}</button>
          {ageClasses.map((a) => (
            <button key={a} className={`chip ${ageClass === a ? 'selected' : ''}`} onClick={() => setAgeClass(a)}>{a}</button>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="results">
          <thead>
            <tr>
              <th className="rank">{t('rank')}</th>
              <th className="name">{t('athlete')}</th>
              <th className="score">{scoreHeader}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ResultRowView key={row.climber_id} row={row} starter={byId.get(row.climber_id)!} lang={lang}
                boulders={boulders} lead={lead} results={results} leadResults={leadResults} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultRowView({ row, starter: s, lang, boulders, lead, results, leadResults }: {
  row: Row; starter: Starter; lang: Lang; boulders: Boulder[]; lead: boolean;
  results: Map<string, ResultRow>; leadResults: Map<string, LeadRow>;
}) {
  return (
    <tr>
      <td className="rank">{row.rank ?? '–'}</td>
      <td className="name">
        <Link className="athlete" to={`/climber/${s.climber_id}`}>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</Link>
        <span className="athlete-meta">{[s.bib, s.age_class, s.profile.club].filter(Boolean).join(' • ')}</span>
        <span className="ascents">
          {boulders.map((b) => lead
            ? <RouteChip key={b.id} number={b.number} r={leadResults.get(resultKey(b.id, row.climber_id))} />
            : <Cell key={b.id} number={b.number} r={results.get(resultKey(b.id, row.climber_id))} />)}
        </span>
      </td>
      <td className="score">{row.score}</td>
    </tr>
  );
}
