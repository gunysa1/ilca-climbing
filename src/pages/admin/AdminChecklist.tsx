import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { climbsRoutes, problemWord, type Discipline } from '../../lib/discipline';
import { checkText, fixPath, manualItemsFor, readTicks, writeTicks, type Check, type CheckItem, type ChecklistResult } from '../../lib/eventChecklist';
import { localized, useI18n } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import { AdminNav, ErrorLine } from './AdminHome';
import { ErrorGroups, type ClientErrorRow } from './AdminErrors';

/** Event-day checklist: automatic checks from `event_checklist`, manual ticks kept on this device. */
export function AdminChecklist() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [result, setResult] = useState<ChecklistResult | null>(null);
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [errors, setErrors] = useState<ClientErrorRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ticks, setTicks] = useState<string[]>(() => (id ? readTicks(id) : []));

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data, error: e }, { data: comp }] = await Promise.all([
      supabase.rpc('event_checklist', { p_competition: id }),
      // Names boulders or routes in the texts (event_checklist predates the discipline).
      supabase.from('competitions').select('discipline').eq('id', id).maybeSingle(),
    ]);
    setDiscipline((comp as { discipline: Discipline | null } | null)?.discipline ?? null);
    setError(e?.message ?? null);
    if (!data) return;
    const res = data as ChecklistResult;
    setResult(res);
    // The competition's days, Israel time (the admin works there).
    const from = new Date(`${res.competition.starts_on}T00:00:00`);
    const to = new Date(`${res.competition.ends_on}T00:00:00`);
    to.setDate(to.getDate() + 1);
    const { data: errs } = await supabase.from('client_errors')
      .select('id, created_at, app, path, message, stack, build, context, profile:profiles(full_name, full_name_he)')
      .gte('created_at', from.toISOString()).lt('created_at', to.toISOString())
      .order('created_at', { ascending: false }).limit(200);
    setErrors((errs as unknown as ClientErrorRow[]) ?? []);
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (item: string) => {
    if (!id) return;
    const next = ticks.includes(item) ? ticks.filter((x) => x !== item) : [...ticks, item];
    setTicks(next);
    writeTicks(id, next);
  };

  const name = (i: CheckItem) => localized(lang, i.label ?? '', i.label_he);
  const describe = (c: Check, i: CheckItem) => {
    if (c.id === 'judges_signed_in') {
      const state = !i.has_login ? t('judgeNoLogin')
        : !i.signed_in ? t('judgeNeverSignedIn')
        : t('judgeSignedInAt').replace('{when}', new Date(i.last_sign_in_at ?? '').toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB'));
      return `${name(i)} · ${state}`;
    }
    return [name(i), i.kind && t(i.kind), i.number != null && `${t(problemWord(climbsRoutes(discipline)))} ${i.number}`].filter(Boolean).join(' · ');
  };

  return (
    <section>
      <h1>{t('eventChecklist')}{result && ` · ${localized(lang, result.competition.name, result.competition.name_he)}`}</h1>
      <AdminNav />
      <ErrorLine error={error} />
      <p className="muted">{t('checklistIntro')}</p>
      {id && <p><Link to={`/admin/competition/${id}`}>← {t('competitions')}</Link></p>}

      <div className="panel">
        <div className="panel-head">
          <h2>{t('checklistAuto')}</h2>
          <button className="secondary" onClick={() => void load()}>{t('checklistRecheck')}</button>
        </div>
        {!result && !error && <p className="muted">{t('loading')}</p>}
        <ul className="checklist">
          {result?.checks.map((c) => (
            <li key={c.id}>
              <span className={c.ok ? 'success' : 'error'} aria-hidden="true">{c.ok ? '✓' : '✗'}</span>{' '}
              <strong>{t(checkText(c.id, discipline))}</strong>
              <span className="sr-only"> {c.ok ? t('checklistAllGood') : ''}</span>
              {!c.ok && c.id === 'published' && <> · <Link to={fixPath(id!, c.id)}>{t('checklistFix')}</Link></>}
              {(c.id === 'judges_signed_in' || !c.ok) && c.items.length > 0 && (
                <ul>
                  {c.items.map((i, n) => (
                    <li key={n}>
                      {describe(c, i)}
                      {(c.id !== 'judges_signed_in' || !i.signed_in) && <> · <Link to={fixPath(id!, c.id, i)}>{t('checklistFix')}</Link></>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h2>{t('checklistManual')}</h2>
        <ul className="checklist">
          {manualItemsFor(discipline).map((m) => (
            <li key={m.id}>
              <label className="inline">
                <input type="checkbox" checked={ticks.includes(m.id)} onChange={() => toggle(m.id)} /> {t(m.text)}
              </label>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{t('clientErrorsToday')}</h2>
          <Link to="/admin/errors">{t('clientErrors')}</Link>
        </div>
        <ErrorGroups rows={errors} onChanged={() => void load()} readOnly />
      </div>
    </section>
  );
}
