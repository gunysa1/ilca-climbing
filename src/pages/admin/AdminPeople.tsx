import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { localized, useI18n } from '../../lib/i18n';
import { allRows } from '../../lib/allRows';
import { supabase } from '../../lib/supabase';
import type { AdminAccount, AppRole, Profile } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';
import { ClimberPicker } from './ClimberPicker';
import { InviteJudge } from './InviteJudge';
import { Sheet } from '../../components/Sheet';
import { Busy, countsText, fill, invokeSync } from './ifscSync';

const STAFF_ROLES = ['judge', 'coach', 'admin'] as const satisfies readonly AppRole[];
type ProfileRow = Profile & { user_id: string | null; ifsc_id: string | null };
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
  // Deleting an account: asked first in a sheet (no accidents), done by the delete-account function.
  const [toDelete, setToDelete] = useState<AdminAccount | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);
  // IFSC link of a climber: edited inline; unlinking is asked first in a sheet.
  const [ifscEdit, setIfscEdit] = useState<{ id: string; value: string } | null>(null);
  const [toUnlink, setToUnlink] = useState<ProfileRow | null>(null);
  const [toReplace, setToReplace] = useState<{ p: ProfileRow; value: string } | null>(null);
  const [ifscNote, setIfscNote] = useState<string | null>(null);

  const reload = useCallback(async () => {
    let profError: string | null = null;
    const [acc, prof, cl] = await Promise.all([
      supabase.rpc('admin_accounts'),
      allRows<Omit<ProfileRow, 'user_id'>>((from, to) => supabase.from('profiles').select('id, full_name, full_name_he, club, country, gender, ifsc_id')
        .order('full_name').order('id').range(from, to)).catch((e: Error) => { profError = e.message; return []; }),
      supabase.from('coach_athletes').select('coach_id, climber_id'),
    ]);
    const accs = (acc.data as AdminAccount[]) ?? [];
    // profiles.user_id is not readable through the table (migration 042): the login of a profile comes from
    // admin_accounts() (admins only).
    const login = new Map(accs.filter((a) => a.profile_id).map((a) => [a.profile_id!, a.user_id]));
    setAccounts(accs);
    setProfiles(prof.map((p) => ({ ...p, user_id: login.get(p.id) ?? null })));
    setLinks((cl.data as CoachLink[]) ?? []);
    // Only a failed reload sets the error: a reload after a refused change must not wipe the message saying why.
    const loadError = acc.error?.message ?? profError ?? cl.error?.message ?? null;
    if (loadError) setError(loadError);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function deleteAccount(a: AdminAccount) {
    setToDelete(null); setDeleted(null); setError(null);
    const { error } = await supabase.functions.invoke('delete-account', { body: { user_id: a.user_id } });
    if (error) {
      const body = await (error as { context?: Response }).context?.json?.().catch(() => null) as { error?: string } | null;
      return setError(body?.error ?? error.message);
    }
    setDeleted(a.email);
    await reload();
  }

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(error?.message ?? null);
    if (!error) await reload();
  };

  // Sets or clears profiles.ifsc_id (admins only, enforced by a trigger), only if it is still what this page showed.
  // In the database a change drops the climber's current-season world positions and keeps the old athlete as
  // ignored; results already imported stay. A new number's waiting results and world positions load right away.
  async function saveIfsc(p: ProfileRow, value: string | null) {
    setIfscEdit(null); setToUnlink(null); setToReplace(null); setIfscNote(null);
    const q = supabase.from('profiles').update({ ifsc_id: value }).eq('id', p.id);
    const { data, error } = await (p.ifsc_id ? q.eq('ifsc_id', p.ifsc_id) : q.is('ifsc_id', null)).select('id');
    if (error || !data?.length) {
      setError(error?.code === '23505' ? t('ifscIdTaken') : error?.message ?? t('ifscChanged'));
      return reload();
    }
    setError(null);
    await reload();
    if (!value) return;
    try { setIfscNote(countsText(t, await invokeSync({ athlete: Number(value) }))); }
    catch (e) { if (e instanceof Busy) setIfscNote(t('ifscBusyLater')); else setError((e as Error).message); }
  }
  const submitIfsc = (p: ProfileRow, value: string) => {
    if (value === p.ifsc_id) return setIfscEdit(null);
    if (p.ifsc_id) return setToReplace({ p, value }); // overwriting a link: asked first
    void saveIfsc(p, value);
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

      {deleted && <p className="notice">✓ {t('accountDeleted')}: {deleted}</p>}
      {toDelete && (
        <Sheet title={t('deleteAccountTitle')} confirm={t('deleteForever')} danger
          onConfirm={() => void deleteAccount(toDelete)} onCancel={() => setToDelete(null)}>
          <p className="sheet-result" dir="ltr">{toDelete.email}</p>
          <p>{t('deleteAccountText')}</p>
        </Sheet>
      )}

      {toUnlink && (
        <Sheet title={t('ifscUnlinkTitle')} confirm={t('unlink')} danger
          onConfirm={() => void saveIfsc(toUnlink, null)} onCancel={() => setToUnlink(null)}>
          <p className="sheet-result">{name(toUnlink)} · IFSC {toUnlink.ifsc_id}</p>
          <p>{t('ifscUnlinkText')}</p>
        </Sheet>
      )}
      {toReplace && (
        <Sheet title={t('ifscReplaceTitle')} confirm={t('ifscReplace')} danger
          onConfirm={() => void saveIfsc(toReplace.p, toReplace.value)} onCancel={() => setToReplace(null)}>
          <p className="sheet-result">{fill(t('ifscReplaceText'), { old: toReplace.p.ifsc_id ?? '', new: toReplace.value, name: name(toReplace.p) })}</p>
          <p>{t('ifscUnlinkText')}</p>
        </Sheet>
      )}
      {ifscNote && <p className="notice">IFSC: {ifscNote}</p>}

      <div className="panel">
        <h2>{t('accounts')} ({accounts.length})</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>{t('email')}</th><th>{t('profile')}</th><th>{t('roles')}</th><th>{t('linkProfile')}</th><th /></tr></thead>
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
                  <td>
                    {a.user_id !== session?.user.id && (
                      <button className="link danger-text" onClick={() => setToDelete(a)}>{t('deleteAccount')}</button>
                    )}
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
        <p><Link to="/admin/people/merge">{t('mergeTitle')}</Link></p>
        <input placeholder={t('search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="table-wrap">
          <table className="admin-table">
            <thead><tr><th>{t('athlete')}</th><th>{t('club')}</th><th>{t('gender')}</th><th>{t('accounts')}</th><th>{t('ifscId')}</th></tr></thead>
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
                  <td className="ifsc-cell">
                    {ifscEdit?.id === p.id ? (
                      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); submitIfsc(p, ifscEdit.value.trim()); }}>
                        <input aria-label={t('ifscIdLabel')} value={ifscEdit.value} inputMode="numeric" pattern="[1-9]\d*" required dir="ltr" size={8}
                          onChange={(e) => setIfscEdit({ id: p.id, value: e.target.value })} />
                        <button className="link">{t('save')}</button>
                        <button type="button" className="link" onClick={() => setIfscEdit(null)}>{t('cancel')}</button>
                      </form>
                    ) : <>
                      {p.ifsc_id && <a href={`https://ifsc.results.info/athlete/${p.ifsc_id}`} target="_blank" rel="noreferrer" dir="ltr">{p.ifsc_id}</a>}{' '}
                      <button className="link" onClick={() => setIfscEdit({ id: p.id, value: p.ifsc_id ?? '' })}>{t('ifscEdit')}</button>
                      {p.ifsc_id && <>{' '}<button className="link danger-text" onClick={() => setToUnlink(p)}>{t('unlink')}</button></>}
                    </>}
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
