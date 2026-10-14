import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { Competition } from '../lib/types';

export function Live() {
  const { t, lang } = useI18n();
  const [comps, setComps] = useState<Competition[] | null>(null);

  useEffect(() => {
    // RLS hides drafts from the public.
    supabase.from('competitions').select('*').neq('status', 'draft').order('starts_on', { ascending: false })
      .then(({ data }) => setComps((data as Competition[]) ?? []));
  }, []);

  return (
    <section>
      <h1>{t('competitions')}</h1>
      {comps === null && <p className="muted">{t('loading')}</p>}
      {comps?.length === 0 && <p className="muted">{t('empty')}</p>}
      <ul className="cards">
        {comps?.map((c) => (
          <li key={c.id}>
            <Link to={`/competition/${c.id}`} className="card">
              <span className="card-date">{new Date(c.starts_on).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}</span>
              <span className="card-title">{localized(lang, c.name, c.name_he)}</span>
              {c.venue && <span className="muted">{c.venue}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
