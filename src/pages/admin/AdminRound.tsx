import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RoundStatus } from '../../components/RoundStatus';
import { useAuth } from '../../lib/auth';
import { errorText } from '../../lib/errors';
import { localized, useI18n } from '../../lib/i18n';
import { formatHeight } from '../../lib/lead';
import { loadStarters, resultKey, type LeadRow, type ResultRow, type Starter } from '../../lib/roundData';
import { supabase } from '../../lib/supabase';
import { LEAD_COLUMNS, RESULT_COLUMNS, type AdminAccount, type Boulder, type Round } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';

interface RoundInfo extends Round {
  category: { name: string; name_he: string | null; competition_id: string };
}
interface Assignment { id: string; boulder_id: string | null; judge: { id: string; full_name: string; full_name_he: string | null } }
/** Row of score_events (boulder) or lead_events (lead). */
interface ScoreEvent {
  id: number; boulder_id: string; climber_id: string; judge_id: string | null; created_at: string;
  attempts?: number; zone_attempt?: number | null; top_attempt?: number | null;
  hold?: number; plus?: boolean; top?: boolean;
}
interface AppealRow {
  id: string; boulder_id: string | null; climber_id: string; status: 'open' | 'upheld' | 'rejected'; created_at: string;
  details: { reason: string; decision: string | null } | null;
}
const eventText = (e: ScoreEvent) => e.hold != null ? formatHeight({ hold: e.hold, plus: !!e.plus, top: !!e.top })
  : `${e.attempts}/${e.zone_attempt ?? '-'}/${e.top_attempt ?? '-'}`;

export function AdminRound() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [boulders, setBoulders] = useState<Boulder[]>([]);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [results, setResults] = useState<Map<string, ResultRow>>(new Map());
  const [leadResults, setLeadResults] = useState<Map<string, LeadRow>>(new Map());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [judges, setJudges] = useState<AdminAccount[]>([]);
  const [events, setEvents] = useState<ScoreEvent[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [appeals, setAppeals] = useState<AppealRow[]>([]);
  const { profileId } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const { data: r, error } = await supabase.from('rounds')
      .select('*, category:categories(name, name_he, competition_id)').eq('id', id).single();
    if (error || !r) return setError(errorText(error, t));
    const lead = r.scoring === 'lead';
    const [b, regs, res, asg, acc, ev, ap] = await Promise.all([
      supabase.from('boulders').select('*').eq('round_id', id).order('number'),
      loadStarters(r),
      supabase.from(lead ? 'lead_results' : 'boulder_results').select(lead ? LEAD_COLUMNS : RESULT_COLUMNS).eq('round_id', id),
      supabase.from('judge_assignments').select('id, boulder_id, judge:profiles(id, full_name, full_name_he)').eq('round_id', id),
      supabase.rpc('admin_accounts'),
      supabase.from(lead ? 'lead_events' : 'score_events').select('*').eq('round_id', id).order('created_at', { ascending: false }).limit(200),
      supabase.from('appeals').select('id, boulder_id, climber_id, status, created_at, details:appeal_details(reason, decision)')
        .eq('round_id', id).order('created_at'),
    ]);
    setAppeals((ap.data as unknown as AppealRow[]) ?? []);
    setRound(r as RoundInfo);
    setBoulders((b.data as Boulder[]) ?? []);
    const st: Starter[] = regs.starters;
    setStarters(st);
    const resRows = (res.data ?? []) as unknown as (ResultRow & LeadRow)[];
    setResults(lead ? new Map() : new Map(resRows.map((x) => [resultKey(x.boulder_id, x.climber_id), x])));
    setLeadResults(lead ? new Map(resRows.map((x) => [resultKey(x.boulder_id, x.climber_id), x])) : new Map());
    setAssignments((asg.data as unknown as Assignment[]) ?? []);
    setJudges(((acc.data as AdminAccount[]) ?? []).filter((a) => a.profile_id && a.roles.includes('judge')));
    const evs = (ev.data as ScoreEvent[]) ?? [];
    setEvents(evs);
    // Names for the audit log: starters plus whoever entered scores (judges/admins).
    const ids = [...new Set(evs.map((e) => e.judge_id).filter((x): x is string => !!x))];
    const { data: who } = ids.length ? await supabase.from('profiles').select('id, full_name, full_name_he').in('id', ids) : { data: [] };
    setNames(new Map([...st.map((s) => s.profile), ...((who ?? []) as { id: string; full_name: string; full_name_he: string | null }[])]
      .map((p) => [p.id, localized(lang, p.full_name, p.full_name_he)])));
    setError(errorText(b.error ?? regs.error ?? res.error ?? asg.error ?? acc.error ?? ev.error, t));
  }, [id, lang, t]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(errorText(error, t));
    if (!error) await reload();
  };

  const boulderNo = useMemo(() => new Map(boulders.map((b) => [b.id, b.number])), [boulders]);

  if (!round) return <section><AdminNav /><ErrorLine error={error} /><p className="muted">{t('loading')}</p></section>;
  const lead = round.scoring === 'lead';

  function assign(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const boulder = String(f.get('boulder'));
    void run(supabase.from('judge_assignments').insert({
      round_id: round!.id, judge_id: String(f.get('judge')), boulder_id: boulder === 'all' ? null : boulder,
    }));
  }

  return (
    <section>
      <h1>{localized(lang, round.category.name, round.category.name_he)} · {t(round.kind)} <RoundStatus status={round.status} /></h1>
      <AdminNav />
      <p><Link to={`/admin/competition/${round.category.competition_id}`}>{lang === 'he' ? '→' : '←'} {t('competition')}</Link></p>
      <ErrorLine error={error} />

      <div className="panel">
        <h2>{t('judges')}</h2>
        <ul className="admin-rows">
          {assignments.map((a) => (
            <li key={a.id} className="admin-row">
              <strong>{localized(lang, a.judge.full_name, a.judge.full_name_he)}</strong>
              <span>{a.boulder_id ? `${t('boulder')} ${boulderNo.get(a.boulder_id)}` : t('wholeRound')}</span>
              <button className="link danger-text" onClick={() => void run(supabase.from('judge_assignments').delete().eq('id', a.id))}>{t('remove')}</button>
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={assign}>
          <select name="judge" required>
            {judges.map((j) => <option key={j.user_id} value={j.profile_id!}>{j.full_name ?? j.email}</option>)}
          </select>
          <select name="boulder">
            <option value="all">{t('wholeRound')}</option>
            {boulders.map((b) => <option key={b.id} value={b.id}>{t(lead ? 'route' : 'boulder')} {b.number}</option>)}
          </select>
          <button className="secondary" disabled={judges.length === 0}>{t('assign')}</button>
        </form>
        <p className="muted small">{t('addJudgeHint')}</p>
      </div>

      <div className="panel">
        <h2>{t('corrections')}</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>{t('bib')}</th><th>{t('athlete')}</th>{boulders.map((b) => <th key={b.id}>{b.number}</th>)}<th /></tr>
            </thead>
            <tbody>
              {starters.map((s) => editing === s.climber_id ? (lead
                ? <LeadCorrectionRow key={s.climber_id} starter={s} routes={boulders} results={leadResults}
                    onCancel={() => setEditing(null)} onSave={async (p) => { await run(p); setEditing(null); }} />
                : <CorrectionRow key={s.climber_id} starter={s} boulders={boulders} results={results}
                    onCancel={() => setEditing(null)} onSave={async (p) => { await run(p); setEditing(null); }} />
              ) : (
                <tr key={s.climber_id}>
                  <td>{s.bib}</td>
                  <td>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</td>
                  {boulders.map((b) => {
                    if (lead) {
                      const l = leadResults.get(resultKey(b.id, s.climber_id));
                      return <td key={b.id} className="mono" dir="ltr">{l ? formatHeight(l) : ''}</td>;
                    }
                    const r = results.get(resultKey(b.id, s.climber_id));
                    return <td key={b.id} className="mono">{r ? `${r.locked ? '🔒' : ''}${r.attempts}/${r.zone_attempt ?? '-'}/${r.top_attempt ?? '-'}` : ''}</td>;
                  })}
                  <td>
                    <button className="link" onClick={() => setEditing(s.climber_id)}>✎</button>
                    {[...(lead ? leadResults : results).values()].some((r) => r.climber_id === s.climber_id && r.locked) && (
                      <button className="link" title={t('unlock')} onClick={() => void run(supabase.from(lead ? 'lead_results' : 'boulder_results')
                        .update({ locked: false }).eq('round_id', round.id).eq('climber_id', s.climber_id))}>🔓</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!lead && <p className="muted small">{t('attempts')} / {t('zone')} / {t('top')}</p>}
      </div>

      <div className="panel">
        <h2>{t('appeals')}</h2>
        {appeals.length === 0 && <p className="muted">{t('empty')}</p>}
        <ul className="admin-rows">
          {appeals.map((a) => (
            <li key={a.id} className="admin-row">
              <strong>{names.get(a.climber_id) ?? a.climber_id.slice(0, 8)}</strong>
              <span>{a.boulder_id ? `${t(lead ? 'route' : 'boulder')} ${boulderNo.get(a.boulder_id)}` : t('wholeRound')}</span>
              <span className="muted">{a.details?.reason}</span>
              {a.status === 'open' ? <>
                <span className="appeal-badge">{t('appealOpen')}</span>
                {(['upheld', 'rejected'] as const).map((st) => (
                  <button key={st} className="link" onClick={() => {
                    const decision = window.prompt(t('appealDecision')) ?? '';
                    void run((async () => {
                      const { error } = await supabase.from('appeals').update({ status: st, resolved_at: new Date().toISOString() }).eq('id', a.id);
                      if (error) return { error };
                      return supabase.from('appeal_details').update({ decision: decision || null, resolved_by: profileId }).eq('appeal_id', a.id);
                    })());
                  }}>{t(st === 'upheld' ? 'appealUpheld' : 'appealRejected')}</button>
                ))}
              </> : <span>{t(a.status === 'upheld' ? 'appealUpheld' : 'appealRejected')}{a.details?.decision ? ` · ${a.details.decision}` : ''}</span>}
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          const boulder = String(f.get('boulder'));
          const appealId = crypto.randomUUID();
          void run((async () => {
            const { error } = await supabase.from('appeals').insert({ id: appealId, round_id: round.id,
              boulder_id: boulder === 'all' ? null : boulder, climber_id: String(f.get('climber')) });
            if (error) return { error };
            form.reset();
            return supabase.from('appeal_details').insert({ appeal_id: appealId, reason: String(f.get('reason')).trim(), created_by: profileId });
          })());
        }}>
          <select name="climber" required aria-label={t('athlete')}>
            {starters.map((s) => <option key={s.climber_id} value={s.climber_id}>{s.bib ? `${s.bib} · ` : ''}{localized(lang, s.profile.full_name, s.profile.full_name_he)}</option>)}
          </select>
          <select name="boulder" aria-label={t(lead ? 'route' : 'boulder')}>
            <option value="all">{t('wholeRound')}</option>
            {boulders.map((b) => <option key={b.id} value={b.id}>{t(lead ? 'route' : 'boulder')} {b.number}</option>)}
          </select>
          <input name="reason" required placeholder={t('appealReason')} />
          <button className="secondary">{t('openAppeal')}</button>
        </form>
      </div>

      <div className="panel">
        <h2>{t('auditLog')}</h2>
        {events.length === 0 && <p className="muted">{t('empty')}</p>}
        <table className="admin-table">
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="muted small">{new Date(e.created_at).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB')}</td>
                <td>{names.get(e.climber_id) ?? e.climber_id.slice(0, 8)}</td>
                <td>{t(lead ? 'route' : 'boulder')} {boulderNo.get(e.boulder_id)}</td>
                <td className="mono">{eventText(e)}</td>
                <td className="muted">{t('by')} {e.judge_id ? names.get(e.judge_id) ?? '?' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type Cell = { attempts: string; zone: string; top: string };
const num = (v: string) => (v.trim() === '' ? null : Number(v));

/** Inline editor for one climber's results across all boulders of the round. */
function CorrectionRow({ starter, boulders, results, onSave, onCancel }: {
  starter: Starter; boulders: Boulder[]; results: Map<string, ResultRow>;
  onSave: (p: PromiseLike<{ error: { message: string } | null }>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  const [cells, setCells] = useState<Record<string, Cell>>(() => Object.fromEntries(boulders.map((b) => {
    const r = results.get(resultKey(b.id, starter.climber_id));
    return [b.id, { attempts: String(r?.attempts ?? ''), zone: String(r?.zone_attempt ?? ''), top: String(r?.top_attempt ?? '') }];
  })));
  const [invalid, setInvalid] = useState<string | null>(null);

  async function save() {
    const upserts = [];
    const deletes = [];
    for (const b of boulders) {
      const c = cells[b.id];
      const attempts = num(c.attempts) ?? 0;
      const zone = num(c.zone);
      const top = num(c.top);
      const had = results.has(resultKey(b.id, starter.climber_id));
      if (attempts === 0 && zone == null && top == null) { if (had) deletes.push(b.id); continue; }
      // Mirrors the DB checks: zone/top within attempts; a top needs a zone on the same or an earlier attempt.
      const ok = (zone == null || (zone >= 1 && zone <= attempts)) && (top == null || (top >= 1 && top <= attempts && zone != null && zone <= top));
      if (!ok) { setInvalid(`${t('boulder')} ${b.number}`); return; }
      upserts.push({ boulder_id: b.id, climber_id: starter.climber_id, round_id: b.round_id, attempts, zone_attempt: zone, top_attempt: top });
    }
    setInvalid(null);
    await onSave((async () => {
      if (upserts.length) {
        const { error } = await supabase.from('boulder_results').upsert(upserts, { onConflict: 'boulder_id,climber_id' });
        if (error) return { error };
      }
      if (deletes.length) {
        const { error } = await supabase.from('boulder_results').delete().eq('climber_id', starter.climber_id).in('boulder_id', deletes);
        if (error) return { error };
      }
      return { error: null };
    })());
  }

  const set = (bid: string, k: keyof Cell) => (e: { target: { value: string } }) =>
    setCells({ ...cells, [bid]: { ...cells[bid], [k]: e.target.value } });

  return (
    <tr className="editing">
      <td>{starter.bib}</td>
      <td>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}{invalid && <span className="error small"> ✗ {invalid}</span>}</td>
      {boulders.map((b) => (
        <td key={b.id} className="cell-edit">
          <input aria-label={`${t('attempts')} ${b.number}`} type="number" min={0} value={cells[b.id].attempts} onChange={set(b.id, 'attempts')} />
          <input aria-label={`${t('zone')} ${b.number}`} type="number" min={1} value={cells[b.id].zone} onChange={set(b.id, 'zone')} />
          <input aria-label={`${t('top')} ${b.number}`} type="number" min={1} value={cells[b.id].top} onChange={set(b.id, 'top')} />
        </td>
      ))}
      <td>
        <button className="primary" onClick={() => void save()}>{t('save')}</button>
        <button className="link" onClick={onCancel}>✕</button>
      </td>
    </tr>
  );
}

/** Inline editor for one climber's lead results across the round's routes. */
function LeadCorrectionRow({ starter, routes, results, onSave, onCancel }: {
  starter: Starter; routes: Boulder[]; results: Map<string, LeadRow>;
  onSave: (p: PromiseLike<{ error: { message: string } | null }>) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, lang } = useI18n();
  type LeadCell = { hold: string; plus: boolean; top: boolean };
  const [cells, setCells] = useState<Record<string, LeadCell>>(() => Object.fromEntries(routes.map((b) => {
    const r = results.get(resultKey(b.id, starter.climber_id));
    return [b.id, { hold: r ? String(r.hold) : '', plus: r?.plus ?? false, top: r?.top ?? false }];
  })));
  const set = (id: string, patch: Partial<LeadCell>) => setCells({ ...cells, [id]: { ...cells[id], ...patch } });

  async function save() {
    const upserts = [];
    const deletes = [];
    for (const b of routes) {
      const c = cells[b.id];
      const had = results.has(resultKey(b.id, starter.climber_id));
      if (c.hold.trim() === '' && !c.top) { if (had) deletes.push(b.id); continue; }
      upserts.push({ boulder_id: b.id, climber_id: starter.climber_id, round_id: b.round_id,
        hold: Number(c.hold) || 0, plus: c.top ? false : c.plus, top: c.top });
    }
    await onSave((async () => {
      if (upserts.length) {
        const { error } = await supabase.from('lead_results').upsert(upserts, { onConflict: 'boulder_id,climber_id' });
        if (error) return { error };
      }
      if (deletes.length) {
        const { error } = await supabase.from('lead_results').delete().eq('climber_id', starter.climber_id).in('boulder_id', deletes);
        if (error) return { error };
      }
      return { error: null };
    })());
  }

  return (
    <tr className="editing">
      <td>{starter.bib}</td>
      <td>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</td>
      {routes.map((b) => (
        <td key={b.id} className="cell-edit">
          <input aria-label={`${t('hold')} ${b.number}`} type="number" min={0} value={cells[b.id].hold}
            onChange={(e) => set(b.id, { hold: e.target.value })} disabled={cells[b.id].top} />
          <label className="inline small"><input type="checkbox" aria-label={`+ ${b.number}`} checked={cells[b.id].plus}
            disabled={cells[b.id].top} onChange={(e) => set(b.id, { plus: e.target.checked })} />+</label>
          <label className="inline small"><input type="checkbox" aria-label={`TOP ${b.number}`} checked={cells[b.id].top}
            onChange={(e) => set(b.id, { top: e.target.checked, plus: false })} />TOP</label>
        </td>
      ))}
      <td>
        <button className="primary" onClick={() => void save()}>{t('save')}</button>
        <button className="link" onClick={onCancel}>✕</button>
      </td>
    </tr>
  );
}
