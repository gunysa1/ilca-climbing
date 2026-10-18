import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FavoriteStar } from '../components/FavoriteStar';
import { NotifySettings } from '../components/NotifySettings';
import { climberEvents, type ClimberEvent } from '../lib/climberStats';
import { useFavorites } from '../lib/favorites';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { HistoryRow, Profile } from '../lib/types';

const DISC_KEY = { boulder: 'discBoulder', lead: 'discLead', speed: 'discSpeed' } as const;

/** Climbers the viewer follows, with their latest result. */
export function Favorites() {
  const { t, lang } = useI18n();
  const { ids } = useFavorites();
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    if (ids.length === 0) { setProfiles([]); return; }
    supabase.from('profiles').select('id, full_name, full_name_he, club, country').in('id', ids)
      .then(({ data }) => setProfiles((data as Profile[]) ?? []));
    supabase.rpc('climber_history_for', { p_climbers: ids })
      .then(({ data }) => setHistory(((data as HistoryRow[]) ?? []).filter((r) => r.round_status !== 'planned')));
  }, [ids.join(',')]);

  const latest = useMemo(() => {
    const m = new Map<string, ClimberEvent>();
    for (const id of ids) {
      const e = climberEvents(history.filter((h) => h.climber_id === id))[0];
      if (e) m.set(id, e);
    }
    return m;
  }, [history, ids.join(',')]);

  const ordered = (profiles ?? []).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return (
    <section>
      <h1>★ {t('favorites')}</h1>
      <NotifySettings />
      {profiles === null && <p className="muted">{t('loading')}</p>}
      {profiles?.length === 0 && <p className="muted">{t('noFavorites')}</p>}
      <ul className="event-list">
        {ordered.map((p) => {
          const e = latest.get(p.id);
          return (
            <li key={p.id} className="event">
              <FavoriteStar climberId={p.id} name={p.full_name} />
              <span className="event-main">
                <Link className="event-title" to={`/climber/${p.id}${e ? `?d=${e.discipline}` : ''}`}>{localized(lang, p.full_name, p.full_name_he)}</Link>
                {p.club && <span className="muted small">{p.club}</span>}
                {e && (
                  <span className="small">
                    {t(DISC_KEY[e.discipline])} · {localized(lang, e.competition, e.competition_he)} · {e.placing ?? '–'}{e.field ? `/${e.field}` : ''}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
