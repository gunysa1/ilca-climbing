import { useEffect, useState, type FormEvent } from 'react';
import { localized, useI18n } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/types';
import { ErrorLine } from './AdminHome';

const HEBREW = /[֐-׿]/;

/** Create a climber profile (no account needed) plus its private row. Returns the new id. */
export async function createClimber(c: {
  name: string; club?: string | null; gender?: Profile['gender']; birthDate?: string | null; email?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  const id = crypto.randomUUID();
  const name = c.name.trim();
  const { error } = await supabase.from('profiles').insert({
    id, full_name: name, full_name_he: HEBREW.test(name) ? name : null,
    club: c.club?.trim() || null, gender: c.gender ?? null,
  });
  if (error) return { id: null, error: error.message };
  const { error: e2 } = await supabase.from('profile_private')
    .insert({ id, birth_date: c.birthDate ?? null, email: c.email ?? null });
  return { id, error: e2?.message ?? null };
}

/** Search existing profiles or create a new one (unless allowCreate is false), then call onPick with the profile id. */
export function ClimberPicker({ exclude, actionLabel, defaultGender, onPick, allowCreate = true }: {
  exclude: Set<string>;
  actionLabel: string;
  defaultGender: Profile['gender'];
  onPick: (climberId: string) => Promise<void> | void;
  allowCreate?: boolean;
}) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Profile[]>([]);
  const [club, setClub] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const term = q.replace(/[,()*%\\]/g, ' ').trim();
    if (term.length < 2) { setHits([]); return; }
    const handle = setTimeout(() => {
      supabase.from('profiles').select('id, full_name, full_name_he, club, country')
        .or(`full_name.ilike.*${term}*,full_name_he.ilike.*${term}*`).limit(12)
        .then(({ data }) => setHits(((data as Profile[]) ?? []).filter((p) => !exclude.has(p.id)).slice(0, 8)));
    }, 200);
    return () => clearTimeout(handle);
  }, [q, exclude]);

  async function createAndPick(e: FormEvent) {
    e.preventDefault();
    if (!allowCreate || q.trim().length < 2) return;
    const { id, error } = await createClimber({ name: q, club, gender: defaultGender });
    setError(error);
    if (id) { await onPick(id); setQ(''); setClub(''); }
  }

  return (
    <div className="picker">
      <form className="inline-form" onSubmit={createAndPick}>
        <input placeholder={allowCreate ? `${t('search')} / ${t('newClimber')}` : t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {allowCreate && <>
          <input placeholder={t('club')} value={club} onChange={(e) => setClub(e.target.value)} />
          <button className="secondary" disabled={q.trim().length < 2}>+ {t('newClimber')}</button>
        </>}
      </form>
      <ErrorLine error={error} />
      {hits.length > 0 && (
        <ul className="picker-hits">
          {hits.map((p) => (
            <li key={p.id}>
              <span>{localized(lang, p.full_name, p.full_name_he)} <span className="muted small">{p.club}</span></span>
              <button className="link" onClick={async () => { await onPick(p.id); setQ(''); }}>{actionLabel}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
