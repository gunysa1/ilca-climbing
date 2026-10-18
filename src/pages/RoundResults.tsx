import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FavoriteStar } from '../components/FavoriteStar';
import { RoundStatus } from '../components/RoundStatus';
import { useFavorites } from '../lib/favorites';
import { onWallByClimber, onWallList, useOnWall } from '../lib/onWall';
import { switchTarget } from '../lib/categorySwitch';
import { saveLastViewed } from '../lib/lastViewed';
import { localized, useI18n, type Lang } from '../lib/i18n';
import { isTimedRound } from '../lib/climbTime';
import { formatHeight } from '../lib/lead';
import { prefetchRound, resultKey, useRoundData, type LeadRow, type ResultRow, type Starter } from '../lib/roundData';
import { roundRows, type Row } from '../lib/roundRows';
import { boulderPoints } from '../lib/scoring';
import type { Boulder } from '../lib/types';

/** IFSC-style tile: top half filled on a top, bottom half on a zone, slash when attempted without zone. */
export function Cell({ r, number, appeal, climbing }: { r: ResultRow | undefined; number: number; appeal?: boolean; climbing?: boolean }) {
  const attempted = !!r && r.attempts > 0;
  const cls = !attempted ? 'asc-empty' : r.zone_attempt == null ? 'asc-none' : '';
  return (
    <span className={`asc${appeal ? ' appealed' : ''}${climbing ? ' climbing' : ''}`} title={attempted ? `${boulderPoints(r)}` : undefined}>
      <span className={`asc-cell ${cls}`}>
        <span className={`asc-top${r?.top_attempt != null ? ' on' : ''}`}>{r?.top_attempt ?? ''}</span>
        <span className={`asc-zone${r?.zone_attempt != null ? ' on' : ''}`}>{r?.zone_attempt ?? ''}</span>
      </span>
      <span className="asc-label">{number}</span>
    </span>
  );
}

/** Lead route result chip: "30+", "TOP", or dashed when not climbed yet. */
export function RouteChip({ r, number, climbing }: { r: LeadRow | undefined; number: number; climbing?: boolean }) {
  return (
    <span className={`asc${climbing ? ' climbing' : ''}`}>
      <span className={`route-chip${r?.top ? ' top' : ''}${r ? '' : ' empty'}`} dir="ltr">{r ? formatHeight(r) : ''}</span>
      <span className="asc-label">{number}</span>
    </span>
  );
}

export function RoundResults() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const { round, category, categories, boulders, starters, results, leadResults, totals: storedTotals, appeals, loading } = useRoundData(id);
  const [ageClass, setAgeClass] = useState<string | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [tab, setTab] = useState<'result' | 'startlist'>('result');
  // Breadcrumbs, the Q / S / F chips (like IFSC) and the men / women switch all come with the
  // round (round_page), so they show with the results instead of after more requests.
  const context = category ? { category: category.name, category_he: category.name_he, competition: category.competition } : null;
  const siblings = useMemo(() => [...(categories.find((c) => c.id === round?.category_id)?.rounds ?? [])]
    .sort((a, b) => ['qualification', 'semifinal', 'final'].indexOf(a.kind) - ['qualification', 'semifinal', 'final'].indexOf(b.kind)),
  [categories, round?.category_id]);
  // Age classes differ per category: a new category starts unfiltered (the tab stays, like IFSC).
  useEffect(() => { setAgeClass(null); }, [round?.category_id]);
  // Load the other categories' matching rounds and this category's other rounds in the background,
  // so the men / women switch and the Q / S / F chips open instantly.
  useEffect(() => {
    if (!round) return;
    for (const c of categories) {
      const to = c.id === round.category_id ? null : switchTarget(c.rounds, round.kind);
      if (to) prefetchRound(to);
    }
    for (const r of siblings) if (r.id !== round.id && r.status !== 'planned') prefetchRound(r.id);
  }, [round?.id, categories, siblings]);
  useEffect(() => {
    if (!round || !category) return;
    saveLastViewed({ competition_id: category.competition.id, competition: category.competition.name, competition_he: category.competition.name_he,
      round_id: round.id, round_kind: round.kind, category: category.name, category_he: category.name_he });
  }, [round?.id, category?.id]);
  const favorites = useFavorites();
  // Who is climbing now (live rounds): highlighted like the IFSC app's "climbing now".
  const wallRows = useOnWall(round?.id, round?.status === 'live');
  const wall = useMemo(() => onWallList(wallRows, boulders), [wallRows, boulders]);
  const wallByClimber = useMemo(() => onWallByClimber(wall), [wall]);
  const ageClasses = useMemo(() => [...new Set(starters.map((s) => s.age_class).filter((a): a is string => !!a))].sort(), [starters]);
  // Qualification groups are ranked separately: always show one group at a time.
  const groups = useMemo(() => [...new Set(starters.map((s) => s.group_label).filter((g): g is string => !!g))].sort(), [starters]);
  const [groupPick, setGroup] = useState<string | null>(null);
  const group = groups.length ? (groupPick && groups.includes(groupPick) ? groupPick : groups[0]) : null;

  // Within an age-class filter the ranking is recomputed among those climbers (like the
  // temporary app's per-category results inside a combined group).
  const shown = useMemo(() => starters.filter((s) => (!group || s.group_label === group) && (!ageClass || s.age_class === ageClass)),
    [starters, group, ageClass]);
  const rows = useMemo(() => (round ? roundRows(round, shown, boulders, results, leadResults, storedTotals) : []),
    [round, shown, boulders, results, leadResults, storedTotals]);

  const byId = new Map(starters.map((s) => [s.climber_id, s]));
  // Open appeals per climber (boulder ids; null = the whole round), like the temporary app's "ערעור פתוח".
  const openAppeals = useMemo(() => {
    const m = new Map<string, (string | null)[]>();
    for (const a of appeals) if (a.status === 'open') m.set(a.climber_id, [...(m.get(a.climber_id) ?? []), a.boulder_id]);
    return m;
  }, [appeals]);
  const lastUpdate = useMemo(() => {
    let max = '';
    for (const r of [...results.values(), ...leadResults.values()]) if (r.updated_at && r.updated_at > max) max = r.updated_at;
    return max ? new Date(max) : null;
  }, [results, leadResults]);
  // The favorites filter only hides rows: ranks stay those of the whole round (group / age class).
  const visible = onlyFavorites ? rows.filter((r) => favorites.has(r.climber_id)) : rows;

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!round) return <p className="muted">{t('empty')}</p>;
  const lead = round.scoring === 'lead';
  const scoreHeader = lead ? (boulders.length > 1 ? t('rankPoints') : isTimedRound(round, boulders.length) ? t('climbTime') : '')
    : round.scoring === 'ifsc2025' ? t('points') : `${t('tops')}/${t('zones')}`;

  return (
    <section>
      {context && (
        <p className="crumbs">
          <Link to={`/competition/${context.competition.id}`}>{localized(lang, context.competition.name, context.competition.name_he)}</Link>
          {' › '}{localized(lang, context.category, context.category_he)}
        </p>
      )}
      {categories.length > 1 && (
        <nav className="round-nav category-switch" aria-label={t('category')}>
          {categories.map((c) => {
            const label = localized(lang, c.name, c.name_he);
            if (c.id === round.category_id) return <span key={c.id} className="round-chip current" aria-current="page">{label}</span>;
            const to = switchTarget(c.rounds, round.kind);
            return to ? <Link key={c.id} to={`/round/${to}`} className="round-chip">{label}</Link>
              : <span key={c.id} className="round-chip planned">{label}</span>;
          })}
        </nav>
      )}
      <h1>{t(round.kind)} <RoundStatus status={round.status} /></h1>
      <div className="round-meta">
        {lastUpdate && <span className="muted small">{t('updatedAt')} {lastUpdate.toLocaleTimeString(lang === 'he' ? 'he-IL' : 'en-GB')}</span>}
        {openAppeals.size > 0 && <span className="appeal-badge">{t('appealOpen')}</span>}
        <button className="chip no-print" onClick={() => window.print()} title={t('printPdf')}>PDF ⤓</button>
      </div>
      {wall.length > 0 && (
        <div className="on-wall no-print" aria-live="polite">
          <span className="on-wall-title"><span className="live-dot" aria-hidden />{t('onWallNow')}</span>
          {wall.map((w) => {
            const s = byId.get(w.climber_id);
            return s && (
              <Link key={w.boulder_id} className="on-wall-item" to={`/climber/${w.climber_id}`}>
                <span className="on-wall-num">{w.number}</span>{localized(lang, s.profile.full_name, s.profile.full_name_he)}
              </Link>
            );
          })}
        </div>
      )}
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
      {tab === 'startlist' ? <StartList starters={groups.length ? starters.filter((s) => s.group_label === group) : starters} groups={groups} group={group} onGroup={setGroup} climbing={wallByClimber} /> : <>
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
                boulders={boulders} lead={lead} results={results} leadResults={leadResults} appeal={openAppeals.get(row.climber_id)}
                climbing={wallByClimber.get(row.climber_id)} />
            ))}
          </tbody>
        </table>
      </div>
      </>}
    </section>
  );
}

/** Start list: order, bib, name, club, group and the seed (previous-round place). */
function StartList({ starters, groups, group, onGroup, climbing }: {
  starters: Starter[]; groups: string[]; group: string | null; onGroup: (g: string) => void; climbing: Map<string, string[]>;
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
              <tr key={s.climber_id} className={climbing.has(s.climber_id) ? 'on-wall-row' : undefined}>
                <td className="rank">{s.start_order ?? i + 1}</td>
                <td className="name">
                  <Link className="athlete" to={`/climber/${s.climber_id}`}>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</Link>
                  {climbing.has(s.climber_id) && <span className="climbing-badge">{t('climbingNow')}</span>}
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

function ResultRowView({ row, starter: s, lang, boulders, lead, results, leadResults, favorite, appeal, climbing }: {
  row: Row; starter: Starter; lang: Lang; boulders: Boulder[]; lead: boolean; favorite: boolean;
  results: Map<string, ResultRow>; leadResults: Map<string, LeadRow>; appeal?: (string | null)[];
  /** Boulders this climber is on right now. */
  climbing?: string[];
}) {
  const { t } = useI18n();
  return (
    <tr className={[favorite && 'favorite', climbing && 'on-wall-row'].filter(Boolean).join(' ') || undefined}>
      <td className="rank">{row.rank ?? '–'}</td>
      <td className="name">
        <FavoriteStar climberId={s.climber_id} name={s.profile.full_name} />
        <Link className="athlete" to={`/climber/${s.climber_id}?d=${lead ? 'lead' : 'boulder'}`}>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</Link>
        {appeal && <span className="appeal-badge" title={t('appealOpen')}>{t('appeal')}</span>}
        {climbing && <span className="climbing-badge">{t('climbingNow')}</span>}
        <span className="athlete-meta">{[s.bib, s.age_class, s.profile.club].filter(Boolean).join(' • ')}</span>
        <span className="ascents">
          {boulders.map((b) => lead
            ? <RouteChip key={b.id} number={b.number} r={leadResults.get(resultKey(b.id, row.climber_id))} climbing={!!climbing?.includes(b.id)} />
            : <Cell key={b.id} number={b.number} r={results.get(resultKey(b.id, row.climber_id))} appeal={!!appeal?.includes(b.id)}
                climbing={!!climbing?.includes(b.id)} />)}
        </span>
      </td>
      <td className="score">{row.score}</td>
    </tr>
  );
}
