import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { localized, useI18n } from '../../lib/i18n';
import {
  RANK_CLASSES, seniorIntlPoints, type Adjustment, type IntlEventType, type IntlResult,
} from '../../lib/rankings';
import { criteriaForSeason } from '../../lib/criteria';
import { seasonOf } from '../../lib/season';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';
import { ClimberPicker } from './ClimberPicker';
import { Sheet } from '../../components/Sheet';

const EVENT_TYPES: IntlEventType[] = ['world_cup', 'world_championship', 'european_cup', 'european_championship',
  'european_youth_cup', 'european_youth_championship', 'world_youth_championship', 'manual'];
const KINDS = ['qualification', 'semifinal', 'final'] as const;

type IntlRow = IntlResult & { id: string; season: string; ifsc_dcat_id?: number | null };
type AdjustmentRow = Adjustment & { id: string; season: string };

/** Points of an international result under the criteria edition of its season. */
function editionPoints(r: IntlResult & { season: string }) {
  const c = criteriaForSeason(r.season).criteria;
  return Math.max(c.seniorIntl === 'per_event' ? seniorIntlPoints(r) : 0, c.youthBonus(r));
}

/** Season ranking inputs that aren't ILCA competitions: international results and adjustments. */
export function AdminRankings() {
  const { t, lang } = useI18n();
  const [season, setSeason] = useState(() => seasonOf(new Date()));
  const [intl, setIntl] = useState<IntlRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [names, setNames] = useState(new Map<string, Profile>());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [{ data: i, error: e1 }, { data: a, error: e2 }] = await Promise.all([
      supabase.from('international_results').select('*').eq('season', season).order('starts_on'),
      supabase.from('ranking_adjustments').select('*').eq('season', season).order('created_at'),
    ]);
    setIntl(((i ?? []) as IntlRow[]).map((r) => ({ ...r, points: r.points == null ? null : Number(r.points) })));
    setAdjustments(((a ?? []) as AdjustmentRow[]).map((r) => ({ ...r, points: Number(r.points) })));
    setError(e1?.message ?? e2?.message ?? null);
    const ids = [...new Set([...(i ?? []), ...(a ?? [])].map((r) => r.climber_id as string))];
    if (ids.length) {
      const { data: ps } = await supabase.from('profiles').select('id, full_name, full_name_he, club, country').in('id', ids);
      setNames(new Map(((ps ?? []) as Profile[]).map((p) => [p.id, p])));
    }
  }, [season]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(error?.message ?? null);
    if (!error) await reload();
    return !error;
  };
  // A deleted IFSC row is remembered in ifsc_dismissed, so the daily sync never imports it again.
  const remove = async (r: IntlRow) => {
    if (r.ifsc_event_id != null && r.ifsc_dcat_id != null) {
      const ok = await run(supabase.from('ifsc_dismissed').upsert(
        { climber_id: r.climber_id, ifsc_event_id: r.ifsc_event_id, ifsc_dcat_id: r.ifsc_dcat_id },
        { onConflict: 'climber_id,ifsc_event_id,ifsc_dcat_id', ignoreDuplicates: true }));
      if (!ok) return;
    }
    await run(supabase.from('international_results').delete().eq('id', r.id));
  };
  const name = (id: string) => { const p = names.get(id); return p ? localized(lang, p.full_name, p.full_name_he) : id.slice(0, 8); };

  return (
    <section>
      <h1>{t('rankings')}</h1>
      <AdminNav />
      <ErrorLine error={error} />
      <IfscSync />
      <label className="inline-form">{t('season')}
        <input value={season} pattern="\d{4}-\d{2}" onChange={(e) => setSeason(e.target.value)} placeholder="2025-26" />
      </label>

      <h2>{t('intlResults')}</h2>
      <div className="table-wrap">
        <table className="results">
          <tbody>
            {intl.map((r) => (
              <tr key={r.id}>
                <td className="name">
                  <strong>{name(r.climber_id)}</strong>
                  <span className="athlete-meta">
                    {t(r.discipline === 'boulder' ? 'discBoulder' : 'discLead')} · {t(r.event_type)} · {r.event_name} · {r.starts_on}
                    {r.event_type === 'manual' ? ` · ${t(r.for_class === 'senior' ? 'seniors' : 'youthRanking')}`
                      : ` · ${r.place}/${r.field_size} · ${t(r.reached)}`}
                  </span>
                </td>
                <td className="score">{r.event_type === 'manual' ? r.points : editionPoints(r)}</td>
                <td><button className="link danger" onClick={() => remove(r)}>{t('delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <IntlForm season={season} onAdd={(row) => run(supabase.from('international_results').insert(row))} />
      <p className="muted small">{t('ifscAutoNote')}</p>

      <h2>{t('adjustments')}</h2>
      <ul className="event-list">
        {adjustments.map((a) => (
          <li key={a.id} className="event">
            <span className="event-main">
              <span className="event-title">{name(a.climber_id)} · {a.points > 0 ? '+' : ''}{a.points}</span>
              <span className="muted small">{t(a.discipline === 'boulder' ? 'discBoulder' : 'discLead')} · {a.rank_class ?? t('allClasses')} · {a.note}</span>
            </span>
            <button className="link danger" onClick={() => run(supabase.from('ranking_adjustments').delete().eq('id', a.id))}>{t('delete')}</button>
          </li>
        ))}
      </ul>
      <AdjustmentForm season={season} onAdd={(row) => run(supabase.from('ranking_adjustments').insert(row))} />
    </section>
  );
}


function PickedClimber({ id, onPick }: { id: string | null; onPick: (id: string) => void }) {
  const { t, lang } = useI18n();
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => {
    if (!id) { setP(null); return; }
    supabase.from('profiles').select('id, full_name, full_name_he, club, country').eq('id', id).single().then(({ data }) => setP(data as Profile));
  }, [id]);
  const none = useMemo(() => new Set<string>(), []);
  return (
    <div className="span-all">
      {p ? <p><strong>{localized(lang, p.full_name, p.full_name_he)}</strong> <span className="muted small">{p.club}</span></p>
        : <p className="muted">{t('selectClimber')}</p>}
      <ClimberPicker exclude={none} actionLabel={t('selectClimber')} defaultGender={null} onPick={onPick} />
    </div>
  );
}

function IntlForm({ season, onAdd }: { season: string; onAdd: (row: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useI18n();
  const [climber, setClimber] = useState<string | null>(null);
  const [type, setType] = useState<IntlEventType>('world_cup');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!climber) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const manual = type === 'manual';
    const ok = await onAdd({
      climber_id: climber, season, discipline: v('discipline'), event_type: type, event_name: v('event_name'), starts_on: v('starts_on'),
      place: manual ? null : Number(v('place')), field_size: manual ? null : Number(v('field_size')),
      reached: manual ? 'qualification' : v('reached'),
      points: manual ? Number(v('points')) : null, for_class: manual ? v('for_class') : null,
    });
    if (ok) form.reset();
  }
  return (
    <form className="panel form grid-form" onSubmit={submit}>
      <PickedClimber id={climber} onPick={setClimber} />
      <label>{t('discipline')}
        <select name="discipline"><option value="boulder">{t('discBoulder')}</option><option value="lead">{t('discLead')}</option></select>
      </label>
      <label>{t('eventType')}
        <select value={type} onChange={(e) => setType(e.target.value as IntlEventType)}>
          {EVENT_TYPES.map((k) => <option key={k} value={k}>{t(k)}</option>)}
        </select>
      </label>
      <label>{t('eventName')}<input name="event_name" required /></label>
      <label>{t('startsOn')}<input name="starts_on" type="date" required /></label>
      {type === 'manual' ? <>
        <label>{t('points')}<input name="points" type="number" step="0.01" required /></label>
        <label>{t('forClass')}
          <select name="for_class"><option value="youth">{t('youthRanking')}</option><option value="senior">{t('seniors')}</option></select>
        </label>
      </> : <>
        <label>{t('place')}<input name="place" type="number" min={1} required /></label>
        <label>{t('fieldSize')}<input name="field_size" type="number" min={1} required /></label>
        <label>{t('reached')}
          <select name="reached">{KINDS.map((k) => <option key={k} value={k}>{t(k)}</option>)}</select>
        </label>
      </>}
      <div className="form-actions"><button className="primary" disabled={!climber}>{t('add')}</button></div>
    </form>
  );
}

function AdjustmentForm({ season, onAdd }: { season: string; onAdd: (row: Record<string, unknown>) => Promise<boolean> }) {
  const { t } = useI18n();
  const [climber, setClimber] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!climber) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const ok = await onAdd({ climber_id: climber, season, discipline: v('discipline'), rank_class: v('rank_class') || null,
      points: Number(v('points')), note: v('note') });
    if (ok) form.reset();
  }
  return (
    <form className="panel form grid-form" onSubmit={submit}>
      <PickedClimber id={climber} onPick={setClimber} />
      <label>{t('discipline')}
        <select name="discipline"><option value="boulder">{t('discBoulder')}</option><option value="lead">{t('discLead')}</option></select>
      </label>
      <label>{t('ageClass')}
        <select name="rank_class">
          <option value="">{t('allClasses')}</option>
          {RANK_CLASSES.map((c) => <option key={c} value={c}>{c === 'senior' ? t('seniors') : c}</option>)}
        </select>
      </label>
      <label>{t('points')}<input name="points" type="number" step="0.01" required /></label>
      <label>{t('note')}<input name="note" required /></label>
      <div className="form-actions"><button className="primary" disabled={!climber}>{t('add')}</button></div>
    </form>
  );
}

type Counts = { added?: number; updated?: number; linked?: number; pending?: number; world?: number; warnings?: string[] };
type SyncRun = { id: number; started_at: string; status: 'running' | 'ok' | 'failed'; added: number; updated: number; linked: number;
  pending: number; world: number; warnings: string[] | null; error: string | null };
type PendingAthlete = { ifsc_athlete_id: number; firstname: string; lastname: string; gender: string | null; birthday: string | null;
  suggested_profile: string | null; score: number | null; status: 'pending' | 'ignored'; results: { event_name?: string }[] };

/** The sync's own bar for a confident match (pickMatch); below it the suggestion is shown but not offered as Confirm. */
const CONFIDENT = 0.5;

class Busy extends Error {}

/** Calls the ifsc-sync function; a non-2xx answer comes back as an error whose body holds the reason
 *  (`Busy` while another run is going). */
async function invokeSync(body: { athlete?: number }, counts: (c: Counts) => string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('ifsc-sync', { body });
  if (!error) return counts(data ?? {});
  const res = (error as { context?: Response }).context;
  const j = res && typeof res.json === 'function' ? await res.json().catch(() => null) : null;
  if (j?.status === 'busy') throw new Busy();
  throw new Error(j?.error ?? error.message);
}

/** The daily IFSC sync: last runs, run now, and athletes waiting for an admin to confirm who they are. */
function IfscSync() {
  const { t, lang } = useI18n();
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [athletes, setAthletes] = useState<PendingAthlete[]>([]);
  const [names, setNames] = useState(new Map<string, Profile>());
  const [picking, setPicking] = useState<number | null>(null);
  // A link waits here for the second confirmation, which names both people.
  const [linking, setLinking] = useState<{ a: PendingAthlete; profile: Profile } | null>(null);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkedIds, setLinkedIds] = useState(new Set<string>());
  const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
  const counts = (c: Counts) => [fill(t('ifscCounts'), { added: c.added ?? 0, updated: c.updated ?? 0, linked: c.linked ?? 0,
    pending: c.pending ?? 0, world: c.world ?? 0 }), c.warnings?.length ? fill(t('ifscWarnings'), { n: c.warnings.length }) : '']
    .filter(Boolean).join(' · ');
  const statusKey = { ok: 'ifscOk', failed: 'ifscFailed', running: 'ifscRunning' } as const;
  const pending = athletes.filter((a) => a.status === 'pending');
  const ignored = athletes.filter((a) => a.status === 'ignored');
  const profileName = (p: Profile) => localized(lang, p.full_name, p.full_name_he);

  const reload = useCallback(async () => {
    const [{ data: r, error: e1 }, { data: p, error: e2 }, { data: l }] = await Promise.all([
      supabase.from('ifsc_sync_runs').select('id, started_at, status, added, updated, linked, pending, world, warnings, error')
        .order('started_at', { ascending: false }).limit(5),
      supabase.from('ifsc_pending').select('ifsc_athlete_id, firstname, lastname, gender, birthday, suggested_profile, score, status, results')
        .order('lastname'),
      // already linked profiles are left out of the picker (the confirm guard catches the rest)
      supabase.from('profiles').select('id').not('ifsc_id', 'is', null),
    ]);
    setRuns((r ?? []) as SyncRun[]);
    setLinkedIds(new Set(((l ?? []) as { id: string }[]).map((x) => x.id)));
    const list = (p ?? []) as PendingAthlete[];
    setAthletes(list);
    setError(e1?.message ?? e2?.message ?? null);
    const ids = list.map((a) => a.suggested_profile).filter((id): id is string => !!id);
    const { data: ps } = ids.length ? await supabase.from('profiles').select('id, full_name, full_name_he, club, country').in('id', ids) : { data: [] };
    setNames(new Map(((ps ?? []) as Profile[]).map((x) => [x.id, x])));
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const sync = async (body: { athlete?: number }) => {
    setWorking(true); setNote(null);
    try { setNote(await invokeSync(body, counts)); setError(null); }
    catch (e) {
      if (!(e instanceof Busy)) setError((e as Error).message);
      else if (body.athlete !== undefined) { setNote(t('ifscBusyLater')); setError(null); }
      else setError(t('ifscBusy'));
    }
    setWorking(false);
    await reload();
  };
  // Asks first (both names on screen): a wrong link imports someone else's results.
  const ask = async (a: PendingAthlete, profileId: string) => {
    const known = names.get(profileId);
    if (known) { setLinking({ a, profile: known }); return; }
    const { data, error: e } = await supabase.from('profiles').select('id, full_name, full_name_he, club, country').eq('id', profileId).single();
    if (e || !data) { setError(e?.message ?? null); return; }
    setLinking({ a, profile: data as Profile });
  };
  // Links only a profile without an IFSC id. The link stays even when the import fails: the next daily run
  // imports the waiting results anyway.
  const confirm = async (a: PendingAthlete, profileId: string) => {
    setLinking(null);
    if (working) return;
    setWorking(true);
    const { data, error: e } = await supabase.from('profiles').update({ ifsc_id: String(a.ifsc_athlete_id) })
      .eq('id', profileId).is('ifsc_id', null).select('id');
    if (e || !data?.length) { setError(e?.message ?? t('ifscAlreadyLinked')); setWorking(false); return; }
    setPicking(null);
    await sync({ athlete: a.ifsc_athlete_id });
  };
  const setStatus = async (a: PendingAthlete, status: 'pending' | 'ignored') => {
    setWorking(true);
    const { error: e } = await supabase.from('ifsc_pending').update({ status }).eq('ifsc_athlete_id', a.ifsc_athlete_id);
    setError(e?.message ?? null);
    await reload();
    setWorking(false);
  };
  const suggested = (a: PendingAthlete) => {
    const p = a.suggested_profile ? names.get(a.suggested_profile) : null;
    if (!p) return null;
    const score = a.score == null ? '' : ` (${Number(a.score).toFixed(2)})`;
    return fill(t('ifscSuggested'), { name: profileName(p) }) + score;
  };
  const confident = (a: PendingAthlete) => !!a.suggested_profile && a.score != null && Number(a.score) >= CONFIDENT;
  const gender = (g: string | null) => (g === 'male' ? t('ifscMale') : g === 'female' ? t('ifscFemale') : null);
  const events = (a: PendingAthlete) => [...new Set(a.results.map((r) => r.event_name).filter(Boolean))];

  return (
    <div className="ifsc-sync">
      <h2>{t('ifscSync')}</h2>
      <ErrorLine error={error} />
      <p>
        <button className="secondary" disabled={working} onClick={() => sync({})}>{t('ifscRunNow')}</button>
        {note && <span className="muted small"> {note}</span>}
      </p>
      <h3>{t('ifscLastRuns')}</h3>
      <ul className="event-list">
        {runs.map((r) => (
          <li key={r.id} className="event">
            <span className="event-main">
              <span className="event-title">{new Date(r.started_at).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB')} · {t(statusKey[r.status])}</span>
              <span className="muted small">{counts({ ...r, warnings: r.warnings ?? [] })}</span>
              {(r.warnings ?? []).map((w, i) => <span key={i} className="muted small" dir="ltr">{w}</span>)}
              {r.error && <span className="error small">{r.error}</span>}
            </span>
          </li>
        ))}
      </ul>
      <h3>{t('ifscPending')}</h3>
      <ul className="event-list">
        {pending.map((a) => (
          <li key={a.ifsc_athlete_id} className="event">
            <span className="event-main">
              <span className="event-title">{a.firstname} {a.lastname}</span>
              <span className="muted small">
                {[gender(a.gender), a.birthday, fill(t('ifscResults'), { n: a.results.length }), suggested(a)].filter(Boolean).join(' · ')}
              </span>
              {a.suggested_profile && !confident(a) && <span className="error small">{t('ifscWeak')}</span>}
              {events(a).map((name) => <span key={name} className="muted small" dir="ltr">{name}</span>)}
              {picking === a.ifsc_athlete_id && (
                <ClimberPicker exclude={linkedIds} actionLabel={t('ifscLink')} defaultGender={null} onPick={(id) => void ask(a, id)} />
              )}
            </span>
            {confident(a) && (
              <button className="primary" disabled={working} onClick={() => void ask(a, a.suggested_profile!)}>{t('ifscConfirm')}</button>
            )}
            <button className={confident(a) ? 'secondary' : 'primary'} disabled={working}
              onClick={() => setPicking(picking === a.ifsc_athlete_id ? null : a.ifsc_athlete_id)}>{t('ifscPickOther')}</button>
            <button className="secondary" disabled={working} onClick={() => setStatus(a, 'ignored')}>{t('ifscIgnore')}</button>
          </li>
        ))}
      </ul>
      {ignored.length > 0 && (
        <details className="ifsc-ignored">
          <summary>{fill(t('ifscIgnored'), { n: ignored.length })}</summary>
          <ul className="event-list">
            {ignored.map((a) => (
              <li key={a.ifsc_athlete_id} className="event">
                <span className="event-main">
                  <span className="event-title">{a.firstname} {a.lastname}</span>
                  <span className="muted small">{[gender(a.gender), fill(t('ifscResults'), { n: a.results.length })].filter(Boolean).join(' · ')}</span>
                </span>
                <button className="secondary" disabled={working} onClick={() => setStatus(a, 'pending')}>{t('ifscRestore')}</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {linking && (
        <Sheet title={t('ifscLinkTitle')} confirm={t('ifscLink')}
          onConfirm={() => void confirm(linking.a, linking.profile.id)} onCancel={() => setLinking(null)}>
          <p className="sheet-result">{fill(t('ifscLinkQuestion'), { ifsc: `${linking.a.firstname} ${linking.a.lastname}`, name: profileName(linking.profile) })}</p>
          <p className="muted small">
            {[gender(linking.a.gender), linking.a.birthday, linking.profile.club].filter(Boolean).join(' · ')}
          </p>
          <p>{fill(t('ifscLinkText'), { ifsc: `${linking.a.firstname} ${linking.a.lastname}`, name: profileName(linking.profile) })}</p>
        </Sheet>
      )}
    </div>
  );
}
