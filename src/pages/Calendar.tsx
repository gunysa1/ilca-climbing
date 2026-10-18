import { formatDate } from '../lib/dates';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  calendarSeasons, calendarStatus, disciplinesOfCompetition, groupByMonth, israelToday, seasonOfCompetition, todayMarkerBefore,
  type CalendarCompetition,
} from '../lib/calendar';
import { localized, useI18n, type MsgKey } from '../lib/i18n';
import { buildIcs, downloadIcs, type IcsEvent } from '../lib/ics';
import { seasonOf } from '../lib/season';
import { supabase } from '../lib/supabase';

const SERIES_KEY: Record<string, MsgKey> = {
  premier_league: 'seriesPremier', premier_league_u17: 'seriesPremierU17', israeli_championship: 'seriesChamp', youth_championship: 'seriesYouthChamp',
};
const DISC_KEY = { boulder: 'discBoulder', lead: 'discLead', speed: 'discSpeed' } as const;
const STATUS_KEY = { upcoming: 'calUpcoming', live: 'liveNow', finished: 'finished' } as const;
/** Where a competition's page lives for someone who opens the file later (the public app). */
const APP_URL = ((import.meta.env.VITE_VIEWER_URL as string | undefined) ?? location.origin).replace(/\/$/, '');

/** Season calendar: competitions by month, with an .ics file per competition and for the season. */
export function Calendar() {
  const { t, lang } = useI18n();
  const today = israelToday();
  const [comps, setComps] = useState<CalendarCompetition[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pick, setPick] = useState<string | null>(null);

  useEffect(() => {
    // One request. RLS hides drafts from the public; the rounds give the disciplines and "live".
    void supabase.from('competitions').select('*, categories(rounds(scoring, status))').neq('status', 'draft').order('starts_on')
      .then(({ data, error }) => { if (error) setFailed(true); else setComps((data as CalendarCompetition[]) ?? []); }, () => setFailed(true));
  }, []);

  const seasons = useMemo(() => calendarSeasons(comps ?? [], today), [comps, today]);
  const season = pick && seasons.includes(pick) ? pick : seasonOf(today);
  const inSeason = useMemo(() => (comps ?? []).filter((c) => seasonOfCompetition(c) === season), [comps, season]);
  const months = useMemo(() => groupByMonth(inSeason), [inSeason]);
  const marker = useMemo(() => todayMarkerBefore(inSeason, today), [inSeason, today]);
  const showMarker = season === seasonOf(today);

  const day = (d: string) => formatDate(d, lang, { day: 'numeric', month: 'numeric' });
  const monthName = (m: string) => formatDate(`${m}-15`, lang, { month: 'long', year: 'numeric' });
  const toEvent = (c: CalendarCompetition): IcsEvent => ({
    id: c.id, title: localized(lang, c.name, c.name_he), starts_on: c.starts_on, ends_on: c.ends_on, venue: c.venue,
    url: `${APP_URL}/competition/${c.id}`,
  });

  const todayLine = <li key="today" className="cal-today" aria-label={t('calToday')}><span>{t('calToday')}</span></li>;
  return (
    <section className="calendar">
      <h1>{t('calTitle')}</h1>
      <div className="cal-bar">
        <label className="cal-season">{t('calSeasonPick')}
          <select value={season} onChange={(e) => setPick(e.target.value)}>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {inSeason.length > 0 && (
          <button className="secondary" onClick={() => downloadIcs(buildIcs(inSeason.map(toEvent), `${t('appName')} ${season}`), `ILCA ${season}`)}>
            {t('calAddSeason')}
          </button>
        )}
      </div>
      {comps === null && (failed ? <p className="error" role="alert">{t('loadFailed')}</p> : <p className="muted">{t('loading')}</p>)}
      {comps !== null && inSeason.length === 0 && <p className="muted">{t('calEmpty')}</p>}
      {months.map((m) => (
        <div key={m.month} className="cal-month">
          <h2>{monthName(m.month)}</h2>
          <ul className="cal-list">
            {m.items.map((c) => {
              const status = calendarStatus(c, today);
              const series = SERIES_KEY[c.series];
              return [
                showMarker && marker === c.id ? todayLine : null,
                <li key={c.id} className={`cal-item ${status}`}>
                  <span className="cal-date">{day(c.starts_on)}{c.ends_on.slice(0, 10) !== c.starts_on.slice(0, 10) && <> – {day(c.ends_on)}</>}</span>
                  <span className="cal-main">
                    <Link className="cal-name" to={`/competition/${c.id}`}>{localized(lang, c.name, c.name_he)}</Link>
                    {c.venue && <span className="muted small">{c.venue}</span>}
                    <span className="cal-tags">
                      {disciplinesOfCompetition(c).map((d) => <span key={d} className="rank-tag">{t(DISC_KEY[d])}</span>)}
                      {series && <span className="rank-tag counts">{t(series)}</span>}
                      <span className={`badge badge-${status === 'live' ? 'live' : status === 'finished' ? 'closed' : 'planned'}`}>{t(STATUS_KEY[status])}</span>
                    </span>
                  </span>
                  <button className="chip" onClick={() => downloadIcs(buildIcs([toEvent(c)], localized(lang, c.name, c.name_he)), c.name)}>{t('calAddOne')}</button>
                </li>,
              ];
            })}
          </ul>
        </div>
      ))}
      {showMarker && marker === null && months.length > 0 && <ul className="cal-list">{todayLine}</ul>}
    </section>
  );
}
