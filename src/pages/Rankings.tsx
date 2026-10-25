import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DisciplineBar, useDiscipline } from '../components/DisciplineBar';
import { FavoriteStar } from '../components/FavoriteStar';
import { localized, useI18n, type MsgKey } from '../lib/i18n';
import { RANK_CLASSES, type Gender, type RankClass } from '../lib/rankings';
import { criteriaForSeason, FIRST_YOUTH_SEASON } from '../lib/criteria';
import { loadRankingsView } from '../lib/rankingsView';
import { fmtPoints, rankingsLoaders, type RankingTable } from '../lib/seasonRankings';

const CLASS_LABEL: Record<RankClass, MsgKey | null> = { senior: 'seniors', U21: null, U19: null, U17: null };

/** This visit's season list and tables (by season|class|gender|discipline): switching back shows them at once. */
let seasonsCache: string[] | null = null;
const tableCache = new Map<string, RankingTable>();

/** National rankings (מדרג לאומי) per season, discipline, class and gender. One request (ranking_page(): the
 *  season list and the stored table); a table not stored yet is computed here from the season's data
 *  (rankingsView.ts, also when ranking_page() fails). */
/** IFSC world-ranking lists (cuwr) per discipline and gender; the ifsc-sync function reads the same ones. */
const WORLD_DCAT: Partial<Record<string, Record<Gender, number>>> = { boulder: { male: 3, female: 7 }, lead: { male: 1, female: 5 } };

export function Rankings() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const [discipline, setDiscipline] = useDiscipline();
  const [seasons, setSeasons] = useState<string[] | null>(seasonsCache);
  const [table, setTable] = useState<RankingTable | null>(null);
  const [failed, setFailed] = useState(false);
  const asked = params.get('season');
  const season = asked ?? seasons?.[0] ?? null;
  const rankClass = (RANK_CLASSES.includes(params.get('c') as RankClass) ? params.get('c') : 'senior') as RankClass;
  const gender: Gender = params.get('g') === 'female' ? 'female' : 'male';
  const set = (k: string, v: string) => setParams((p) => { p.set(k, v); return p; }, { replace: true });

  useEffect(() => {
    let live = true;
    const key = (s: string | null) => `${s}|${rankClass}|${gender}|${discipline}`;
    // a table seen before shows at once, then refreshes
    setTable(tableCache.get(key(season)) ?? null);
    setFailed(false);
    // without a season in the address the newest one comes back with the list (no second round trip)
    void loadRankingsView(rankingsLoaders, asked, rankClass, gender, discipline).then((v) => {
      if (!live) return;
      if (v.seasons) { seasonsCache = v.seasons; setSeasons(v.seasons); }
      if (v.table && v.season) { tableCache.set(key(v.season), v.table); setTable(v.table); return; }
      // a failed refresh keeps what is shown; a failed first load says so
      if (discipline !== 'speed' && (v.season || !v.seasons) && !tableCache.has(key(v.season))) setFailed(true);
    });
    return () => { live = false; };
    // (`season` follows from `asked` and the list: listing it would ask again when the list arrives)
  }, [asked, rankClass, gender, discipline]);

  const rows = table?.rows ?? [];
  const edition = season ? criteriaForSeason(season) : null;
  const worldMissing = !!table?.meta.world_missing;
  const provisional = !!table?.meta.provisional;
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
          {worldMissing && <> · {t('worldRankNotLoaded')}</>}
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
        : (seasons && seasons.length === 0) ? <p className="muted">{t('noRankings')}</p>
        : !table ? (failed ? <p className="error" role="alert">{t('loadFailed')}</p> : <p className="muted">{t('loading')}</p>)
        : rows.length === 0 ? <p className="muted">{t('noRankings')}</p>
        : (
          <div className="table-wrap">
            <table className="results rankings">
              <thead>
                <tr><th className="rank">{t('rank')}</th><th className="name">{t('athlete')}</th><th className="score">{t('total')}</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.climber_id}>
                    <td className="rank">{r.rank}</td>
                    <td className="name">
                      <FavoriteStar climberId={r.climber_id} name={r.full_name ?? ''} />
                      <Link className="athlete" to={`/climber/${r.climber_id}?d=${discipline}`}>{r.full_name != null ? localized(lang, r.full_name, r.full_name_he) : '?'}</Link>
                      {r.club && <span className="athlete-meta">{r.club}</span>}
                      <span className="ranking-parts">
                        {r.events.map((e) => {
                          // 2027 criteria: an international event earns nothing itself (the world ranking does): its place only
                          const placeOnly = e.kind === 'intl' && e.points === 0 && edition?.criteria.seniorIntl === 'world_ranking';
                          // no points (e.g. a 2027 international event): greyed; points left out of the total: struck through
                          const cls = `ranking-part${e.points === 0 ? ' zero' : e.counted ? '' : ' dropped'}`;
                          const body = <>{e.kind === 'intl' ? '🌍 ' : e.kind === 'world' ? '🌐 ' : ''}{placeOnly ? e.place
                            : e.place ? <>{e.place}<small> · {fmt(e.points)}</small></> : fmt(e.points)}</>;
                          // ILCA league events link to their competition; international ones to the IFSC event page,
                          // the world ranking to IFSC's world ranking of this discipline and gender
                          const href = e.href ?? (e.kind === 'world' && WORLD_DCAT[discipline]
                            ? `https://ifsc.results.info/rankings/cuwr/${WORLD_DCAT[discipline]![gender]}` : undefined);
                          if (href) return <a key={e.competition_id} href={href} target="_blank" rel="noopener" className={cls} title={e.label}>{body}</a>;
                          return e.kind === 'league'
                            ? <Link key={e.competition_id} to={`/competition/${e.competition_id}`} className={cls} title={e.label}>{body}</Link>
                            : <span key={e.competition_id} className={cls} title={e.label}>{body}</span>;
                        })}
                        {r.championship && (
                          <Link to={`/competition/${r.championship.competition_id}`} className="ranking-part champ" title={`${t(youth ? 'youthChampShort' : 'champShort')} · ${r.championship.label}`}>
                            🏆 {r.championship.place}<small> · {fmt(r.championship.points)}</small>
                          </Link>
                        )}
                        {r.bonus > 0 && <span className="ranking-part" title={t('intlBonus')}>🌍 +{fmt(r.bonus)}</span>}
                        {r.adjustment !== 0 && <span className="ranking-part adjust" title={t('adjustment')}>{r.adjustment > 0 ? '+' : ''}{fmt(r.adjustment)}</span>}
                      </span>
                    </td>
                    <td className="score">{fmt(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="muted small">{t(edition?.criteria.id === 'ilca2027' ? 'rankingsRule2027' : 'rankingsRule')}</p>
      <DisciplineBar value={discipline} onChange={setDiscipline} />
    </section>
  );
}

const fmt = fmtPoints;
