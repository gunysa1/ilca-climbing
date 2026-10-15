import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FavoriteStar } from '../components/FavoriteStar';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { Competition, Profile } from '../lib/types';

/** PostgREST `or` filters break on these characters; they never matter for a name search. */
export const searchTerm = (q: string) => q.replace(/[,()*%\\.:]/g, ' ').replace(/\s+/g, ' ').trim();

/** Search climbers and competitions by name (Hebrew or English). The query lives in ?q=. */
export function Search() {
  const { t, lang } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [climbers, setClimbers] = useState<Profile[] | null>(null);
  const [comps, setComps] = useState<Competition[] | null>(null);

  useEffect(() => {
    const term = searchTerm(q);
    if (term.length < 2) { setClimbers(null); setComps(null); return; }
    const handle = setTimeout(() => {
      supabase.from('profiles').select('id, full_name, full_name_he, club, country')
        .or(`full_name.ilike.*${term}*,full_name_he.ilike.*${term}*`).order('full_name').limit(30)
        .then(({ data }) => setClimbers((data as Profile[]) ?? []));
      // RLS hides draft competitions from the public.
      supabase.from('competitions').select('*').or(`name.ilike.*${term}*,name_he.ilike.*${term}*`)
        .order('starts_on', { ascending: false }).limit(15)
        .then(({ data }) => setComps((data as Competition[]) ?? []));
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  return (
    <section>
      <h1>{t('search')}</h1>
      <input className="search-input" type="search" autoFocus value={q} placeholder={t('searchHint')}
        aria-label={t('search')} onChange={(e) => setParams(e.target.value ? { q: e.target.value } : {}, { replace: true })} />
      {climbers !== null && (
        <>
          <h2>{t('climbers')} ({climbers.length})</h2>
          {climbers.length === 0 && <p className="muted">{t('empty')}</p>}
          <ul className="event-list">
            {climbers.map((p) => (
              <li key={p.id} className="event">
                <FavoriteStar climberId={p.id} name={p.full_name} />
                <span className="event-main">
                  <Link className="event-title" to={`/climber/${p.id}`}>{localized(lang, p.full_name, p.full_name_he)}</Link>
                  {p.club && <span className="muted small">{p.club}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {comps !== null && (
        <>
          <h2>{t('competitions')} ({comps.length})</h2>
          {comps.length === 0 && <p className="muted">{t('empty')}</p>}
          <ul className="event-list">
            {comps.map((c) => (
              <li key={c.id} className="event">
                <span className="event-main">
                  <Link className="event-title" to={`/competition/${c.id}`}>{localized(lang, c.name, c.name_he)}</Link>
                  <span className="muted small">{new Date(c.starts_on).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
