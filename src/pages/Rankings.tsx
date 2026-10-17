import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DisciplineBar, useDiscipline } from '../components/DisciplineBar';
import { FavoriteStar } from '../components/FavoriteStar';
import { localized, useI18n, type MsgKey } from '../lib/i18n';
import {
  computeRanking, RANK_CLASSES, type Adjustment, type Gender, type IntlResult, type RankClass, type RoundPlacing,
} from '../lib/rankings';
import { criteriaForSeason } from '../lib/criteria';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/types';

/** Seasons ranked with these rules: seniors from 2023-24 (ILCA's published 23/24 senior rankings use the
 * same rules), youth from 2024-25 (earlier youth leagues were organised differently). */
const FIRST_SEASON = '2023-24';
const FIRST_YOUTH_SEASON = '2024-25';

interface SeasonData {
  rounds: RoundPlacing[];
  ageClass: Map<string, RankClass>;
  tooYoung: Set<string>;
  intl: IntlResult[];
  adjustments: (Adjustment & { season: string })[];
  profiles: Map<string, Profile & { gender: Gender | null }>;
  world: { climber_id: string; discipline: string; position: number; as_of: string }[];
}

/** Seasons already loaded in this visit: switching back shows them at once. */
const seasonCache = new Map<string, SeasonData>();

/** season_rankings(): everything one season's ranking needs, in one request. */
async function loadSeason(season: string): Promise<SeasonData | null> {
  const { data: page, error } = await supabase.rpc('season_rankings', { p_season: season });
  if (error || !page) return null;
  const d = (page ?? {}) as {
    rounds?: RoundPlacing[]; age_classes?: { climber_id: string; age_class: RankClass }[]; too_young?: string[];
    intl?: IntlResult[]; adjustments?: (Adjustment & { season: string })[]; world?: SeasonData['world'];
    profiles?: (Profile & { gender: Gender | null })[];
  };
  const data: SeasonData = {
    rounds: d.rounds ?? [],
    ageClass: new Map((d.age_classes ?? []).map((a) => [a.climber_id, a.age_class])),
    tooYoung: new Set(d.too_young ?? []),
    intl: (d.intl ?? []).map((r) => ({ ...r, points: r.points == null ? null : Number(r.points) })),
    adjustments: (d.adjustments ?? []).map((a) => ({ ...a, points: Number(a.points) })),
    profiles: new Map((d.profiles ?? []).map((p) => [p.id, p])),
    world: d.world ?? [],
  };
  seasonCache.set(season, data);
  return data;
}

const CLASS_LABEL: Record<RankClass, MsgKey | null> = { senior: 'seniors', U21: null, U19: null, U17: null };

/** National rankings (מדרג לאומי) per season, discipline, class and gender. */
export function Rankings() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [discipline, setDiscipline] = useDiscipline();
  const [seasons, setSeasons] = useState<string[] | null>(null);
  const [data, setData] = useState<SeasonData | null>(null);
  const [failed, setFailed] = useState(false);
  const season = params.get('season') ?? seasons?.[0] ?? null;
  const rankClass = (RANK_CLASSES.includes(params.get('c') as RankClass) ? params.get('c') : 'senior') as RankClass;
  const gender: Gender = params.get('g') === 'female' ? 'female' : 'male';
  const set = (k: string, v: string) => setParams((p) => { p.set(k, v); return p; }, { replace: true });

  useEffect(() => {
    supabase.from('competitions').select('season').neq('series', 'other').gte('season', FIRST_SEASON)
      .then(({ data: rows }) => setSeasons([...new Set((rows ?? []).map((r) => r.season as string))].sort().reverse()));
  }, []);

  useEffect(() => {
    if (!season) return;
    let live = true;
    // a season seen before shows at once, then refreshes
    setData(seasonCache.get(season) ?? null);
    setFailed(false);
    // a failed refresh keeps what is shown; a failed first load says so
    void loadSeason(season).then((d) => { if (!live) return; if (d) setData(d); else setFailed(true); });
    return () => { live = false; };
  }, [season]);

  const rows = useMemo(() => {
    if (!data || !season || discipline === 'speed') return [];
    const worldRank = new Map(data.world.filter((w) => w.discipline === discipline).map((w) => [w.climber_id, Number(w.position)]));
    return computeRanking({ criteria: criteriaForSeason(season).criteria, worldRank, rankClass, gender, discipline, rounds: data.rounds, ageClass: data.ageClass, tooYoung: data.tooYoung, intl: data.intl,
      adjustments: data.adjustments, climberGender: new Map([...data.profiles].map(([id, p]) => [id, p.gender])) });
  }, [data, season, rankClass, gender, discipline]);

  const edition = season ? criteriaForSeason(season) : null;
  // the world ranking is fixed on 1 January of the season's second year; earlier (or no) rows are provisional
  const provisional = !!(edition && season && data && edition.criteria.seniorIntl === 'world_ranking'
    && (data.world.length === 0 || data.world.some((w) => w.as_of < `${Number(season.slice(0, 4)) + 1}-01-01`)));
  const youth = rankClass !== 'senior';
  const genderLabel = (g: Gender) => t(youth ? (g === 'male' ? 'boys' : 'girls') : (g === 'male' ? 'men' : 'women'));

  return (
    <section className="with-bottom-bar">
      <h1>{t('rankings')}</h1>
      {seasons && seasons.length > 1 && (
        <div className="chips" role="tablist" aria-label={t('season')}>
          {seasons.map((s) => (
            <button key={s} role="tab" aria-selected={s === season} className={`chip ${s === season ? 'selected' : ''}`} onClick={() => set('season', s)}>{s}</button>
          ))}
        </div>
      )}
      {edition && (
        <p className="muted small edition-line">
          {t('criteriaLine')}{' '}
          {edition.criteria.url ? <a href={edition.criteria.url} target="_blank" rel="noreferrer"><bdi>{edition.criteria.title}</bdi></a> : <bdi>{edition.criteria.title}</bdi>}
          {edition.assumed && <> · {t('criteriaAssumed')}</>}
          {provisional && <> · {t('worldRankProvisional')}</>}
        </p>
      )}
      <div className="chips" role="tablist">
        {RANK_CLASSES.map((c) => (
          <button key={c} role="tab" aria-selected={c === rankClass} className={`chip ${c === rankClass ? 'selected' : ''}`}
            onClick={() => set('c', c)}>{CLASS_LABEL[c] ? t(CLASS_LABEL[c]!) : c}</button>
        ))}
      </div>
      <div className="chips" role="tablist">
        {(['male', 'female'] as Gender[]).map((g) => (
          <button key={g} role="tab" aria-selected={g === gender} className={`chip ${g === gender ? 'selected' : ''}`}
            onClick={() => set('g', g)}>{genderLabel(g)}</button>
        ))}
      </div>
      {discipline === 'speed' ? <p className="muted">{t('speedSoon')}</p>
        : youth && season && season < FIRST_YOUTH_SEASON ? <p className="muted">{t('youthRankingsFrom')}</p>
        : !season || (seasons && seasons.length === 0) ? <p className="muted">{t('noRankings')}</p>
        : !data ? (failed ? <p className="error" role="alert">{t('loadFailed')}</p> : <p className="muted">{t('loading')}</p>)
        : rows.length === 0 ? <p className="muted">{t('noRankings')}</p>
        : (
          <div className="table-wrap">
            <table className="results rankings">
              <thead>
                <tr><th className="rank">{t('rank')}</th><th className="name">{t('athlete')}</th><th className="score">{t('total')}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = data.profiles.get(r.climber_id);
                  return (
                    <tr key={r.climber_id}>
                      <td className="rank">{r.rank}</td>
                      <td className="name">
                        <FavoriteStar climberId={r.climber_id} name={p?.full_name ?? ''} />
                        <Link className="athlete" to={`/climber/${r.climber_id}?d=${discipline}`}>{p ? localized(lang, p.full_name, p.full_name_he) : '?'}</Link>
                        {p?.club && <span className="athlete-meta">{p.club}</span>}
                        <span className="ranking-parts">
                          {r.events.map((e) => (
                            <span key={e.competition_id} className={`ranking-part${e.counted ? '' : ' dropped'}`} title={e.label}>
                              {e.kind === 'intl' ? '🌍 ' : e.kind === 'world' ? '🌐 ' : ''}{e.place ? <>{e.place}<small> · {fmt(e.points)}</small></> : fmt(e.points)}
                            </span>
                          ))}
                          {r.championship && (
                            <span className="ranking-part champ" title={t(youth ? 'youthChampShort' : 'champShort')}>
                              🏆 {r.championship.place}<small> · {fmt(r.championship.points)}</small>
                            </span>
                          )}
                          {r.bonus > 0 && <span className="ranking-part" title={t('intlBonus')}>🌍 +{fmt(r.bonus)}</span>}
                          {r.adjustment !== 0 && <span className="ranking-part adjust" title={t('adjustment')}>{r.adjustment > 0 ? '+' : ''}{fmt(r.adjustment)}</span>}
                        </span>
                      </td>
                      <td className="score">{fmt(r.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <p className="muted small">{t(edition?.criteria.id === 'ilca2027' ? 'rankingsRule2027' : 'rankingsRule')}</p>
      <DisciplineBar value={discipline} onChange={setDiscipline} />
    </section>
  );
}

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, ''));
