import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DisciplineBar, useDiscipline } from '../components/DisciplineBar';
import { disciplinesOf } from '../lib/discipline';
import { lastViewedHref, readLastViewed, saveLastViewed, type LastViewed } from '../lib/lastViewed';
import { localized, useI18n } from '../lib/i18n';
import { supabase } from '../lib/supabase';
import type { Competition, RoundFormat } from '../lib/types';

type CompetitionRow = Competition & { categories: { rounds: { scoring: RoundFormat }[] }[] };

export function Live() {
  const { t, lang } = useI18n();
  const [comps, setComps] = useState<CompetitionRow[] | null>(null);
  const [discipline, setDiscipline] = useDiscipline();
  const [last, setLast] = useState<LastViewed | null>(readLastViewed);

  useEffect(() => {
    // RLS hides drafts from the public.
    supabase.from('competitions').select('*, categories(rounds(scoring))').neq('status', 'draft')
      .order('starts_on', { ascending: false })
      .then(({ data }) => setComps((data as CompetitionRow[]) ?? []));
  }, []);

  // A competition is listed under every discipline its rounds use.
  const shown = useMemo(() => (comps ?? []).filter((c) =>
    disciplinesOf(c.categories.flatMap((cat) => cat.rounds.map((r) => r.scoring))).has(discipline)), [comps, discipline]);

  return (
    <section className="with-bottom-bar">
      {last && (
        <div className="continue-bar">
          <Link to={lastViewedHref(last)} className="continue-link">
            <span className="muted small">{t('continueWatching')}</span>
            <span className="continue-title">
              {localized(lang, last.competition, last.competition_he)}
              {last.round_kind && <> · {last.category && `${localized(lang, last.category, last.category_he)} · `}{t(last.round_kind)}</>}
            </span>
          </Link>
          <button type="button" className="link" aria-label={t('dismiss')} onClick={() => { saveLastViewed(null); setLast(null); }}>✕</button>
        </div>
      )}
      <h1>{t('competitions')} · {t(discipline === 'boulder' ? 'discBoulder' : discipline === 'lead' ? 'discLead' : 'discSpeed')}</h1>
      {comps === null && <p className="muted">{t('loading')}</p>}
      {comps !== null && shown.length === 0 && (
        <p className="muted">{discipline === 'speed' ? t('speedSoon') : t('empty')}</p>
      )}
      <ul className="cards">
        {shown.map((c) => (
          <li key={c.id}>
            <Link to={`/competition/${c.id}`} className="card">
              <span className="card-date">{new Date(c.starts_on).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB')}</span>
              <span className="card-title">{localized(lang, c.name, c.name_he)}</span>
              {c.venue && <span className="muted">{c.venue}</span>}
            </Link>
          </li>
        ))}
      </ul>
      <DisciplineBar value={discipline} onChange={setDiscipline} />
    </section>
  );
}
