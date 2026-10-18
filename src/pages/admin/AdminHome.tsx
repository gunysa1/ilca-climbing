import { formatDate } from '../../lib/dates';
import { DISC_LABEL, DISCIPLINES } from '../../lib/discipline';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { localized, useI18n } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import type { Competition } from '../../lib/types';
import { SystemStatus } from './SystemStatus';

export function AdminNav() {
  const { t } = useI18n();
  return (
    <nav className="chips">
      <NavLink to="/admin" end className="chip">{t('competitions')}</NavLink>
      <NavLink to="/admin/people" className="chip">{t('people')}</NavLink>
      <NavLink to="/admin/rankings" className="chip">{t('rankings')}</NavLink>
      <NavLink to="/admin/errors" className="chip">{t('clientErrors')}</NavLink>
    </nav>
  );
}

/** Shows a Supabase error (or nothing). */
export function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

export function AdminHome() {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  const [comps, setComps] = useState<Competition[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', name_he: '', venue: '', starts_on: '', ends_on: '', discipline: '' });

  useEffect(() => {
    // Admins see drafts too (RLS).
    supabase.from('competitions').select('*').order('starts_on', { ascending: false })
      .then(({ data, error }) => { setComps((data as Competition[]) ?? []); setError(error?.message ?? null); });
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase.from('competitions').insert({
      name: form.name.trim(), name_he: form.name_he.trim() || null, venue: form.venue.trim() || null,
      starts_on: form.starts_on, ends_on: form.ends_on || form.starts_on, status: 'draft', discipline: form.discipline,
    }).select('id').single();
    if (error) return setError(error.message);
    navigate(`/admin/competition/${data.id}`);
  }

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <section>
      <h1>{t('admin')}</h1>
      <AdminNav />
      <ErrorLine error={error} />
      <SystemStatus />
      <div className="panel">
        <h2>{t('newCompetition')}</h2>
        <form className="form grid-form" onSubmit={create}>
          <label>{t('nameEn')}<input required value={form.name} onChange={set('name')} /></label>
          <label>{t('nameHe')}<input value={form.name_he} onChange={set('name_he')} dir="rtl" /></label>
          <label>{t('venue')}<input value={form.venue} onChange={set('venue')} /></label>
          <label>{t('discipline')}
            <select name="discipline" required value={form.discipline} onChange={set('discipline')}>
              <option value="" disabled>{t('chooseDiscipline')}</option>
              {DISCIPLINES.map((d) => <option key={d} value={d}>{t(DISC_LABEL[d])}</option>)}
            </select>
          </label>
          <label>{t('startsOn')}<input type="date" required value={form.starts_on} onChange={set('starts_on')} /></label>
          <label>{t('endsOn')}<input type="date" value={form.ends_on} min={form.starts_on} onChange={set('ends_on')} /></label>
          <button className="primary">{t('create')}</button>
        </form>
      </div>
      {comps === null && <p className="muted">{t('loading')}</p>}
      <ul className="cards">
        {comps?.map((c) => (
          <li key={c.id}>
            <Link to={`/admin/competition/${c.id}`} className="card">
              <span className="card-date">{formatDate(c.starts_on, lang)}</span>
              <span className="card-title">{localized(lang, c.name, c.name_he)}</span>
              {c.discipline && <span className="muted">{t(DISC_LABEL[c.discipline])}</span>}
              <span className={`badge ${c.status === 'draft' ? '' : 'badge-closed'}`}>{t(c.status)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
