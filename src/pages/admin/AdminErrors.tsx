import { useCallback, useEffect, useState } from 'react';
import { groupErrors, type ClientErrorRow } from '../../lib/clientErrors';
import { localized, useI18n } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import { AdminNav, ErrorLine } from './AdminHome';

export type { ClientErrorRow };

/** Errors grouped by message: count, last seen, who, page, build; expand for stack and context. */
export function ErrorGroups({ rows, onChanged, readOnly }: { rows: ClientErrorRow[]; onChanged: () => void; readOnly?: boolean }) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const groups = groupErrors(rows);
  const when = (iso: string) => new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB');

  async function clear(ids: string[]) {
    const { error: e } = await supabase.from('client_errors').delete().in('id', ids);
    setError(e?.message ?? null);
    if (!e) onChanged();
  }

  if (groups.length === 0) return <p className="muted">{t('clientErrorsNone')}</p>;
  return (
    <>
      <ErrorLine error={error} />
      <ul className="cards">
        {groups.map((g) => (
          <li key={g.message} className="card">
            <details>
              <summary>
                <strong>{g.message}</strong>
                <span className="muted small"> · {t('errorTimes').replace('{n}', String(g.count))} · {t('errorLastSeen')}: {when(g.lastSeen)}</span>
              </summary>
              <p className="small">
                {t('errorWho')}: {g.who.map((p) => localized(lang, p.name, p.name_he)).join(', ') || '-'}<br />
                {t('errorPage')}: {g.paths.join(', ') || '-'}<br />
                {t('errorBuild')}: {g.builds.join(', ') || '-'}
              </p>
              {g.stack && <><strong className="small">{t('errorStack')}</strong><pre className="small" dir="ltr">{g.stack}</pre></>}
              {g.context != null && <><strong className="small">{t('errorContext')}</strong><pre className="small" dir="ltr">{JSON.stringify(g.context, null, 2)}</pre></>}
              {!readOnly && <button className="link danger-text" onClick={() => void clear(g.ids)}>{t('errorClear')}</button>}
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}

/** admin/errors: the last 7 days. */
export function AdminErrors() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ClientErrorRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error: e } = await supabase.from('client_errors')
      .select('id, created_at, app, path, message, stack, build, context, profile:profiles(full_name, full_name_he)')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(1000);
    setRows((data as unknown as ClientErrorRow[]) ?? []);
    setError(e?.message ?? null);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section>
      <h1>{t('clientErrors')}</h1>
      <AdminNav />
      <ErrorLine error={error} />
      <p className="muted">{t('clientErrorsHint')}</p>
      {rows === null ? <p className="muted">{t('loading')}</p> : <ErrorGroups rows={rows} onChanged={() => void load()} />}
    </section>
  );
}
