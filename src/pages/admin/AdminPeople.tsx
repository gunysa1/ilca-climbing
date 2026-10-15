import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { localized, useI18n } from '../../lib/i18n';
import { allRows } from '../../lib/allRows';
import { supabase } from '../../lib/supabase';
import type { AdminAccount, AppRole, Profile } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';
import { ClimberPicker } from './ClimberPicker';
import { InviteJudge } from './InviteJudge';

const STAFF_ROLES = ['judge', 'coach', 'admin'] as const satisfies readonly AppRole[];
type ProfileRow = Profile & { user_id: string | null };
interface CoachLink { coach_id: string; climber_id: string }

export function AdminPeople() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [links, setLinks] = useState<CoachLink[]>([]);
  const [coach, setCoach] = useState<string>('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    let profError: string | null = null;
    const [acc, prof, cl] = await Promise.all([
      supabase.rpc('admin_accounts'),
      allRows<ProfileRow>((from, to) => supabase.from('profiles').select('id, full_name, full_name_he, club, country, gender, user_id')
        .order('full_name').order('id').range(from, to)).catch((e: Error) => { profError = e.message; return []; }),
      supabase.from('coach_athletes').select('coach_id, climber_id'),
    ]);
    setAccounts((acc.data as AdminAccount[]) ?? []);
    setProfiles(prof);
    setLinks((cl.data as CoachLink[]) ?? []);
    setError(acc.error?.message ?? profError ?? cl.error?.message ?? null);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(error?.message ?? null);
    if (!error) await reload();
  };

  const byId = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const unlinked = profiles.filter((p) => !p.user_id);
  const coaches = accounts.filter((a) => a.profile_id && a.roles.includes('coach'));
  const name = (p: Profile | undefined) => (p ? localized(lang, p.full_name, p.full_name_he) : '?');

  function toggleRole(a: AdminAccount, role: AppRole, on: boolean) {
    if (role === 'admin' && !on && a.user_id === session?.user.id) return; // don't lock yourself out
    void run(on
      ? supabase.from('user_roles').insert({ user_id: a.user_id, role })
      : supabase.from('user_roles').delete().eq('user_id', a.user_id).eq('role', role));
  }

  const shownClimbers = profiles.filter((p) => {
    const q = filter.trim().toLowerCase();
    return !q || [p.full_name, p.full_name_he, p.club].some((v) => v?.toLowerCase().includes(q));
  });

  return (
    <section>
      <h1>{t('people')}</h1>
      <AdminNav />
      <ErrorLine error={error} />

      <InviteJudge onDone={() => void reload()} />

      <div className="panel">
        <h2>{t('accounts')} ({accounts.length})</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>{t('email')}</th><th>{t('profile')}</th><th>{t('roles')}</th><th>{t('linkProfile')}</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.user_id}>
                  <td>{a.email}</td>
                  <td>{a.profile_id ? name(byId.get(a.profile_id)) : <span className="muted">—</span>}</td>
                  <td className="role-toggles">
                    {STAFF_ROLES.map((r) => (
                      <label key={r} className="inline">
                        <input type="checkbox" checked={a.roles.includes(r)}
                          disabled={r === 'admin' && a.user_id === session?.user.id}
                          onChange={(e) => toggleRole(a, r, e.target.checked)} /> {t(r)}
                      </label>
                    ))}
                  </td>
                  <td>
                    <select value="" onChange={(e) => e.target.value && void run(
                      supabase.rpc('link_account', { p_profile: e.target.value, p_user: a.user_id }))}>
                      <option value="">{t('linkProfile')}…</option>
                      {unlinked.map((p) => <option key={p.id} value={p.id}>{name(p)}{p.club ? ` · ${p.club}` : ''}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>{t('coachLinks')}</h2>
        <select value={coach} onChange={(e) => setCoach(e.target.value)}>
          <option value="">{t('coach')}…</option>
          {coaches.map((c) => <option key={c.user_id} value={c.profile_id!}>{c.full_name ?? c.email}</option>)}
        </select>
        {coach && (
          <>
            <ul className="admin-rows">
              {links.filter((l) => l.coach_id === coach).map((l) => (
                <li key={l.climber_id} className="admin-row">
                  <span>{name(byId.get(l.climber_id))}</span>
                  <button className="link danger-text" onClick={() => void run(
                    supabase.from('coach_athletes').delete().eq('coach_id', coach).eq('climber_id', l.climber_id))}>{t('remove')}</button>
                </li>
              ))}
            </ul>
            <ClimberPicker
              exclude={new Set([coach, ...links.filter((l) => l.coach_id === coach).map((l) => l.climber_id)])}
              actionLabel={t('add')} defaultGender={null}
              onPick={(climberId) => run(supabase.from('coach_athletes').insert({ coach_id: coach, climber_id: climberId }))}
            />
          </>
        )}
      </div>

      <div className="panel">
        <h2>{t('climbers')} ({profiles.length})</h2>
        <input placeholder={t('search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>{t('athlete')}</th><th>{t('club')}</th><th>{t('gender')}</th><th>{t('accounts')}</th></tr></thead>
            <tbody>
              {shownClimbers.slice(0, 200).map((p) => (
                <tr key={p.id}>
                  <td>{name(p)}</td>
                  <td className="muted">{p.club}</td>
                  <td className="muted">{p.gender ? t(p.gender) : ''}</td>
                  <td>
                    {p.user_id
                      ? <>{accounts.find((a) => a.user_id === p.user_id)?.email}{' '}
                          <button className="link danger-text" onClick={() => void run(supabase.rpc('unlink_account', { p_profile: p.id }))}>{t('unlink')}</button></>
                      : <span className="muted">{t('noAccount')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
