import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ContinueBar } from '../components/ContinueBar';
import { FavoriteStar } from '../components/FavoriteStar';
import { useFavorites } from '../lib/favorites';
import {
  favoritesLatest, homePollDue, liveCompetitionEnded, parseHome, parseLive, topOfRanking, winnersByCategory, withLive, type HomeData,
} from '../lib/home';
import { localized, useI18n, type MsgKey } from '../lib/i18n';
import type { Discipline, Gender } from '../lib/rankings';
import { seasonOf } from '../lib/season';
import { fmtPoints, loadSeason, seasonCache, seasonRanking, type SeasonData } from '../lib/seasonRankings';
import { supabase } from '../lib/supabase';
import type { HistoryRow, Profile } from '../lib/types';

/** Last home_page() of this visit: coming back shows it at once, then refreshes. */
let homeCache: HomeData | null = null;

const DISC_KEY = { boulder: 'discBoulder', lead: 'discLead', speed: 'discSpeed' } as const;

/** The public home page: live rounds, upcoming and latest competitions, the national ranking, favorites. */
export function Home() {
  const { t, lang } = useI18n();
  const [home, setHome] = useState<HomeData | null>(homeCache);
  const [failed, setFailed] = useState(false);
  const anyLive = (home?.live.length ?? 0) > 0;
  const date = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB');

  // Everything but the ranking and favorites: one request. Then only the live part (home_page(true)):
  // every 5 s while a round is live (who is on the wall, like the round page), every 60 s otherwise;
  // paused while the tab is hidden, one request at a time.
  useEffect(() => {
    let stop = false;
    let busy = false;
    let last = Date.now();
    let failures = 0; // requests failed in a row: retry sooner than the idle poll, backing off
    let reload = false; // a live competition ended: fetch the whole page (results / upcoming lists)
    const run = (liveOnly: boolean) => {
      busy = true;
      last = Date.now();
      return supabase.rpc('home_page', liveOnly ? { p_live_only: true } : {}).then(({ data, error }) => {
        busy = false;
        if (stop) return;
        if (error || !data) { failures++; if (!homeCache) setFailed(true); return; }
        failures = 0;
        if (liveOnly && homeCache) {
          const live = parseLive(data);
          reload = liveCompetitionEnded(homeCache.live, live);
          homeCache = withLive(homeCache, live);
        } else {
          reload = false;
          homeCache = parseHome(data);
        }
        setHome(homeCache);
        setFailed(false);
      }, () => { busy = false; failures++; if (!stop && !homeCache) setFailed(true); });
    };
    void run(false);
    const timer = setInterval(() => {
      if (busy || document.visibilityState !== 'visible') return;
      if (reload && failures === 0) { void run(false); return; } // a live competition ended: the whole page, at once
      if (!homePollDue(Date.now(), last, (homeCache?.live.length ?? 0) > 0, failures)) return;
      void run(homeCache !== null && !reload); // the first load failed: try the whole page again
    }, 1000);
    return () => { stop = true; clearInterval(timer); };
  }, []);

  return (
    <section className="home">
      <h1 className="sr-only">{t('appName')}</h1>
      <ContinueBar />
      {home === null && (failed ? <p className="error" role="alert">{t('loadFailed')}</p> : <p className="muted">{t('loading')}</p>)}
      {home && (
        <>
          {anyLive && (
            <section className="home-section home-live" aria-live="polite">
              <h2><span className="live-dot" aria-hidden />{t('homeLive')}</h2>
              <ul className="home-list">
                {home.live.map((r) => (
                  <li key={r.round_id} className="home-card live">
                    <Link to={`/round/${r.round_id}`} className="home-card-link">
                      <span className="home-card-title">{localized(lang, r.competition.name, r.competition.name_he)}</span>
                      <span className="home-card-sub">{localized(lang, r.category.name, r.category.name_he)} · {t(r.kind)}</span>
                    </Link>
                    {r.on_wall.length > 0 && (
                      <div className="on-wall home-on-wall">
                        <span className="on-wall-title">{t('onWallNow')}</span>
                        {r.on_wall.map((w) => (
                          <Link key={w.boulder_id} className="on-wall-item" to={`/climber/${w.climber_id}`}>
                            <span className="on-wall-num">{w.number}</span>{localized(lang, w.full_name, w.full_name_he)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="home-section">
            <h2>{t('homeUpcoming')}</h2>
            {home.upcoming.length === 0 ? <p className="muted">{t('homeNoUpcoming')}</p> : (
              <ul className="cards">
                {home.upcoming.map((c) => (
                  <li key={c.id}>
                    <Link to={`/competition/${c.id}`} className="card">
                      <span className="card-date">{date(c.starts_on)}{c.ends_on !== c.starts_on && <> – {date(c.ends_on)}</>}</span>
                      <span className="card-title">{localized(lang, c.name, c.name_he)}</span>
                      {c.venue && <span className="muted">{c.venue}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {home.latest.length > 0 && (
            <section className="home-section">
              <h2>{t('homeLatest')}</h2>
              <ul className="home-list">
                {home.latest.map((c) => (
                  <li key={c.id} className="home-card">
                    <Link to={`/competition/${c.id}`} className="home-card-link">
                      <span className="card-date">{date(c.starts_on)}</span>
                      <span className="home-card-title">{localized(lang, c.name, c.name_he)}</span>
                    </Link>
                    {c.winners.length > 0 && (
                      <ul className="winners">
                        {winnersByCategory(c.winners).map((g) => (
                          <li key={g.category_id}>
                            <Link to={`/round/${g.round_id}`} className="winner-cat">
                              {localized(lang, g.category, g.category_he)}{g.climbers[0].round_kind !== 'final' && <> · {t(g.climbers[0].round_kind)}</>}
                            </Link>
                            <span className="winner-names">
                              <span className="medal-1" aria-hidden>1</span>
                              {g.climbers.map((w, i) => (
                                <span key={w.climber_id}>{i > 0 && ', '}<Link to={`/climber/${w.climber_id}`}>{localized(lang, w.full_name, w.full_name_he)}</Link></span>
                              ))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="home-more"><Link to="/competitions">{t('allCompetitions')} ›</Link></p>
        </>
      )}
      {/* after the top of the page has its data (or failed to get it) */}
      {(home || failed) && (
        <>
          <HomeRanking />
          <HomeFavorites />
        </>
      )}
    </section>
  );
}

const previousSeason = (season: string) => {
  const start = Number(season.slice(0, 4)) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/** A season from this visit's cache, else from the database. */
const seasonData = (season: string) => (seasonCache.has(season) ? Promise.resolve(seasonCache.get(season)!) : loadSeason(season));

const rankingTables = (data: SeasonData, season: string) =>
  TABLES.map((x) => ({ ...x, rows: topOfRanking(seasonRanking(data, season, 'senior', x.gender, x.discipline)) }));

const TABLES: { discipline: Discipline; gender: Gender; label: [MsgKey, MsgKey] }[] = [
  { discipline: 'boulder', gender: 'male', label: ['discBoulder', 'men'] },
  { discipline: 'boulder', gender: 'female', label: ['discBoulder', 'women'] },
  { discipline: 'lead', gender: 'male', label: ['discLead', 'men'] },
  { discipline: 'lead', gender: 'female', label: ['discLead', 'women'] },
];

/** Top 3 senior men and women in bouldering and lead: the rankings page's calculation. Early in a
 * season, before anyone has points, it shows the previous season (labelled with its season).
 * Rendered after the rest of the page has its data, so it never holds up the top. */
function HomeRanking() {
  const { t, lang } = useI18n();
  const current = seasonOf(new Date());
  const [shown, setShown] = useState<{ season: string; data: SeasonData } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      const d = await seasonData(current);
      if (!live) return;
      if (!d) { setFailed(true); return; }
      if (!rankingTables(d, current).every((x) => x.rows.length === 0)) { setShown({ season: current, data: d }); return; }
      const previous = previousSeason(current);
      const p = await seasonData(previous);
      if (!live) return;
      setShown(p && !rankingTables(p, previous).every((x) => x.rows.length === 0) ? { season: previous, data: p } : { season: current, data: d });
    })();
    return () => { live = false; };
  }, [current]);
  const season = shown?.season ?? current;
  const data = shown?.data ?? null;
  const tables = useMemo(() => (shown ? rankingTables(shown.data, shown.season) : null), [shown]);
  const empty = tables?.every((x) => x.rows.length === 0);

  return (
    <section className="home-section">
      <h2>{t('homeRanking')} <span className="muted small">{t('seasonOf')} {season}</span></h2>
      {!tables ? (failed ? <p className="error" role="alert">{t('loadFailed')}</p> : <p className="muted">{t('loading')}</p>)
        : empty ? <p className="muted">{t('noRankings')}</p>
        : (
          <div className="home-rankings">
            {/* tables without anyone yet (early in a season) are left out */}
            {tables.filter((x) => x.rows.length > 0).map((x) => (
              <div key={`${x.discipline}-${x.gender}`} className="home-ranking">
                <h3><Link to={`/rankings?season=${season}&c=senior&g=${x.gender}&d=${x.discipline}`}>{t(x.label[0])} · {t(x.label[1])}</Link></h3>
                <ol className="home-ranking-rows">
                  {x.rows.map((r) => {
                    const p = data!.profiles.get(r.climber_id);
                    return (
                      <li key={r.climber_id}>
                        <span className="home-rank">{r.rank}</span>
                        <Link className="home-rank-name" to={`/climber/${r.climber_id}?d=${x.discipline}`}>{p ? localized(lang, p.full_name, p.full_name_he) : '?'}</Link>
                        <span className="home-rank-total">{fmtPoints(r.total)}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ))}
          </div>
        )}
      <p className="home-more"><Link to={`/rankings?season=${season}`}>{t('fullRanking')} ›</Link></p>
    </section>
  );
}

/** Starred climbers with their latest result; one request (favorites_page), only when there are favorites. */
function HomeFavorites() {
  const { t, lang } = useI18n();
  const { ids } = useFavorites();
  const key = ids.join(',');
  const [data, setData] = useState<{ profiles: Profile[]; history: HistoryRow[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (ids.length === 0) { setData(null); return; }
    let live = true;
    void supabase.rpc('favorites_page', { p_climbers: ids }).then(({ data: d, error }) => {
      if (!live) return;
      if (error || !d) { setFailed(true); return; }
      const page = d as { profiles?: Profile[]; history?: HistoryRow[] };
      setData({ profiles: page.profiles ?? [], history: page.history ?? [] });
    }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [key]);
  const list = useMemo(() => (data ? favoritesLatest(ids, data.profiles, data.history) : []), [data, key]);
  if (ids.length === 0) return null;

  return (
    <section className="home-section">
      <h2>★ {t('homeFavorites')}</h2>
      {!data ? (failed ? <p className="error" role="alert">{t('loadFailed')}</p> : <p className="muted">{t('loading')}</p>) : (
        <ul className="event-list">
          {list.map(({ profile: p, latest: e }) => (
            <li key={p.id} className="event">
              <FavoriteStar climberId={p.id} name={p.full_name} />
              <span className="event-main">
                <Link className="event-title" to={`/climber/${p.id}${e ? `?d=${e.discipline}` : ''}`}>{localized(lang, p.full_name, p.full_name_he)}</Link>
                <span className="small">
                  {e ? <>{t(DISC_KEY[e.discipline])} · <Link to={`/competition/${e.competition_id}`}>{localized(lang, e.competition, e.competition_he)}</Link> · {e.placing ?? '–'}{e.field ? `/${e.field}` : ''}</>
                    : <span className="muted">{t('homeNoResultYet')}</span>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

