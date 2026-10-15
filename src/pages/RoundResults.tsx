import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FavoriteStar } from '../components/FavoriteStar';
import { RoundStatus } from '../components/RoundStatus';
import { useFavorites } from '../lib/favorites';
import { saveLastViewed } from '../lib/lastViewed';
import { supabase } from '../lib/supabase';
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
      <span className={`route-chip${r?.top ? ' top' : ''}${r ? '' : ' empty'}`} dir="ltr">{r ? formatHeight(r) : ''}</span>
      <span className="asc-label">{number}</span>
    </span>
  );
}

interface Row { climber_id: string; rank: number | null; score: string }

export function RoundResults() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, leadResults, totals: storedTotals, loading } = useRoundData(id);
  const [ageClass, setAgeClass] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [context, setContext] = useState<{ category: string; category_he: string | null;
    competition: { id: string; name: string; name_he: string | null } } | null>(null);
  // Other rounds of the category (Q / S / F chips, like IFSC) and the Result / Start list tab.
  const [siblings, setSiblings] = useState<{ id: string; kind: 'qualification' | 'semifinal' | 'final'; status: string }[]>([]);
  const [tab, setTab] = useState<'result' | 'startlist'>('result');
  useEffect(() => {
    if (!round) return;
    setTab('result');
    supabase.from('rounds').select('id, kind, status').eq('category_id', round.category_id)
      .then(({ data }) => setSiblings(((data ?? []) as typeof siblings)
        .sort((a, b) => ['qualification', 'semifinal', 'final'].indexOf(a.kind) - ['qualification', 'semifinal', 'final'].indexOf(b.kind))));
  }, [round?.id]);
  useEffect(() => {
    if (!round) return;
    supabase.from('categories').select('name, name_he, competition:competitions(id, name, name_he)').eq('id', round.category_id).single()
      .then(({ data }) => {
        const d = data as unknown as { name: string; name_he: string | null; competition: { id: string; name: string; name_he: string | null } } | null;
        const c = d ? { category: d.name, category_he: d.name_he, competition: d.competition } : null;
        setContext(c);
        if (c) saveLastViewed({ competition_id: c.competition.id, competition: c.competition.name, competition_he: c.competition.name_he,
          round_id: round.id, round_kind: round.kind, category: c.category, category_he: c.category_he });
      });
  }, [round?.id]);
  const favorites = useFavorites();
  const ageClasses = useMemo(() => [...new Set(starters.map((s) => s.age_class).filter((a): a is string => !!a))].sort(), [starters]);
  // Qualification groups are ranked separately: always show one group at a time.
  const groups = useMemo(() => [...new Set(starters.map((s) => s.group_label).filter((g): g is string => !!g))].sort(), [starters]);
  const [groupPick, setGroup] = useState<string | null>(null);
  const group = groups.length ? (groupPick && groups.includes(groupPick) ? groupPick : groups[0]) : null;

  // Within an age-class filter the ranking is recomputed among those climbers (like the
  // temporary app's per-category results inside a combined group).
  const shown = useMemo(() => starters.filter((s) => (!group || s.group_label === group) && (!ageClass || s.age_class === ageClass)),
    [starters, group, ageClass]);
  const rows = useMemo<Row[]>(() => {
    if (!round) return [];
    if (round.scoring === 'lead') {
      const multi = boulders.length > 1;
      const seeds = new Map(shown.filter((s) => s.prev_place != null).map((s) => [s.climber_id, s.prev_place!]));
      return leadStandings(shown.map((s) => s.climber_id), boulders.map((b) => b.id), [...leadResults.values()].map(toLeadResult), seeds,
        round.kind === 'final' && round.time_tiebreak !== false)
        // single route: the height is on the route chip; several routes: the geometric mean of rank points
        .map((s) => ({ climber_id: s.climber_id, rank: s.rank, score: s.rank === null ? '–' : multi ? s.points.toFixed(2) : '' }));
    }
    const format = round.scoring as ScoringFormat;
    // Totals-only rounds (older LogLig history) carry stored totals instead of per-boulder results.
    const totalsRows = shown.map((s) => {
      const stored = storedTotals.get(s.climber_id);
      return stored ? { ...stored, points: 0, prev_rank: s.prev_place } : {
        ...totals(s.climber_id, boulders.map((b) => results.get(resultKey(b.id, s.climber_id)) ?? EMPTY_RESULT)),
        prev_rank: s.prev_place,
      };
    });
    const climbed = new Set(shown.filter((s) => storedTotals.has(s.climber_id)
      || boulders.some((b) => (results.get(resultKey(b.id, s.climber_id))?.attempts ?? 0) > 0)).map((s) => s.climber_id));
    return standings(totalsRows, format, climbed, round.kind === 'final').map((r) => ({
      climber_id: r.climber_id, rank: r.rank,
      score: r.rank === null ? '–' : format === 'ifsc2025'
        ? r.points.toFixed(1) : `${r.tops}T${r.zones}z ${r.top_attempts} ${r.zone_attempts}`,
    }));
  }, [round, shown, boulders, results, leadResults, storedTotals]);

  const byId = new Map(starters.map((s) => [s.climber_id, s]));
  // The favorites filter only hides rows: ranks stay those of the whole round (group / age class).
  const visible = onlyFavorites ? rows.filter((r) => favorites.has(r.climber_id)) : rows;

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!round) return <p className="muted">{t('empty')}</p>;
  const lead = round.scoring === 'lead';
  const scoreHeader = lead ? (boulders.length > 1 ? t('rankPoints') : '')
    : round.scoring === 'ifsc2025' ? t('points') : `${t('tops')}/${t('zones')}`;

  return (
    <section>
      {context && (
        <p className="crumbs">
          <Link to={`/competition/${context.competition.id}`}>{localized(lang, context.competition.name, context.competition.name_he)}</Link>
          {' › '}{localized(lang, context.category, context.category_he)}
        </p>
      )}
      <h1>{t(round.kind)} <RoundStatus status={round.status} /></h1>
      {siblings.length > 1 && (
        <nav className="round-nav" aria-label={t('rounds')}>
          {siblings.map((r) => r.status === 'planned'
            ? <span key={r.id} className="round-chip planned">{t(r.kind)}</span>
            : <Link key={r.id} to={`/round/${r.id}`} className={`round-chip${r.id === round.id ? ' current' : ''}`}
                aria-current={r.id === round.id ? 'page' : undefined}>{t(r.kind)}</Link>)}
        </nav>
      )}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'result'} className={tab === 'result' ? 'active' : ''} onClick={() => setTab('result')}>{t('resultTab')}</button>
        <button role="tab" aria-selected={tab === 'startlist'} className={tab === 'startlist' ? 'active' : ''} onClick={() => setTab('startlist')}>{t('startList')}</button>
      </div>
      {tab === 'startlist' ? <StartList starters={groups.length ? starters.filter((s) => s.group_label === group) : starters} groups={groups} group={group} onGroup={setGroup} /> : <>
      {groups.length > 0 && (
        <div className="chips" role="tablist">
          {groups.map((g) => (
            <button key={g} role="tab" aria-selected={g === group} className={`chip ${g === group ? 'selected' : ''}`}
              onClick={() => setGroup(g)}>{t('group')} {g}</button>
          ))}
        </div>
      )}
      <div className="chips">
        <button className={`chip ${onlyFavorites ? 'selected' : ''}`} aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites((v) => !v)}>★ {t('favorites')}</button>
      </div>
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
            {onlyFavorites && visible.length === 0 && (
              <tr><td colSpan={3} className="muted">{t('noFavoritesHere')}</td></tr>
            )}
            {visible.map((row) => (
              <ResultRowView key={row.climber_id} row={row} starter={byId.get(row.climber_id)!} lang={lang} favorite={favorites.has(row.climber_id)}
                boulders={boulders} lead={lead} results={results} leadResults={leadResults} />
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </section>
  );
}

/** Start list: order, bib, name, club, group and the seed (previous-round place). */
function StartList({ starters, groups, group, onGroup }: {
  starters: Starter[]; groups: string[]; group: string | null; onGroup: (g: string) => void;
}) {
  const { t, lang } = useI18n();
  return (
    <>
      {groups.length > 0 && (
        <div className="chips" role="tablist">
          {groups.map((g) => (
            <button key={g} role="tab" aria-selected={g === group} className={`chip ${g === group ? 'selected' : ''}`}
              onClick={() => onGroup(g)}>{t('group')} {g}</button>
          ))}
        </div>
      )}
      <div className="table-wrap">
        <table className="results startlist">
          <thead>
            <tr><th className="rank">#</th><th className="name">{t('athlete')}</th><th className="score">{t('seed')}</th></tr>
          </thead>
          <tbody>
            {starters.map((s, i) => (
              <tr key={s.climber_id}>
                <td className="rank">{s.start_order ?? i + 1}</td>
                <td className="name">
                  <Link className="athlete" to={`/climber/${s.climber_id}`}>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</Link>
                  <span className="athlete-meta">{[s.bib, s.age_class, s.profile.club].filter(Boolean).join(' • ')}</span>
                </td>
                <td className="score">{s.prev_place ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ResultRowView({ row, starter: s, lang, boulders, lead, results, leadResults, favorite }: {
  row: Row; starter: Starter; lang: Lang; boulders: Boulder[]; lead: boolean; favorite: boolean;
  results: Map<string, ResultRow>; leadResults: Map<string, LeadRow>;
}) {
  return (
    <tr className={favorite ? 'favorite' : undefined}>
      <td className="rank">{row.rank ?? '–'}</td>
      <td className="name">
        <FavoriteStar climberId={s.climber_id} name={s.profile.full_name} />
        <Link className="athlete" to={`/climber/${s.climber_id}?d=${lead ? 'lead' : 'boulder'}`}>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</Link>
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
