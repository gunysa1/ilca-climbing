import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RoundStatus } from '../../components/RoundStatus';
import { localized, useI18n } from '../../lib/i18n';
import { resultKey, type ResultRow, type Starter } from '../../lib/roundData';
import { supabase } from '../../lib/supabase';
import { RESULT_COLUMNS, type AdminAccount, type Boulder, type Round } from '../../lib/types';
import { AdminNav, ErrorLine } from './AdminHome';

interface RoundInfo extends Round {
  category: { name: string; name_he: string | null; competition_id: string };
}
interface Assignment { id: string; boulder_id: string | null; judge: { id: string; full_name: string; full_name_he: string | null } }
interface ScoreEvent {
  id: number; boulder_id: string; climber_id: string; attempts: number;
  zone_attempt: number | null; top_attempt: number | null; judge_id: string | null; created_at: string;
}

export function AdminRound() {
  const { id } = useParams();
  const { t, lang } = useI18n();
  const [round, setRound] = useState<RoundInfo | null>(null);
  const [boulders, setBoulders] = useState<Boulder[]>([]);
  const [starters, setStarters] = useState<Starter[]>([]);
  const [results, setResults] = useState<Map<string, ResultRow>>(new Map());
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [judges, setJudges] = useState<AdminAccount[]>([]);
  const [events, setEvents] = useState<ScoreEvent[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!id) return;
    const { data: r, error } = await supabase.from('rounds')
      .select('*, category:categories(name, name_he, competition_id)').eq('id', id).single();
    if (error || !r) return setError(error?.message ?? null);
    const [b, regs, res, asg, acc, ev] = await Promise.all([
      supabase.from('boulders').select('*').eq('round_id', id).order('number'),
      supabase.from('registrations').select('climber_id, bib, profile:profiles(id, full_name, full_name_he, club, country)')
        .eq('category_id', r.category_id).order('bib'),
      supabase.from('boulder_results').select(RESULT_COLUMNS).eq('round_id', id),
      supabase.from('judge_assignments').select('id, boulder_id, judge:profiles(id, full_name, full_name_he)').eq('round_id', id),
      supabase.rpc('admin_accounts'),
      supabase.from('score_events').select('*').eq('round_id', id).order('created_at', { ascending: false }).limit(200),
    ]);
    setRound(r as RoundInfo);
    setBoulders((b.data as Boulder[]) ?? []);
    const st = (regs.data as unknown as Starter[]) ?? [];
    setStarters(st);
    setResults(new Map(((res.data as ResultRow[]) ?? []).map((x) => [resultKey(x.boulder_id, x.climber_id), x])));
    setAssignments((asg.data as unknown as Assignment[]) ?? []);
    setJudges(((acc.data as AdminAccount[]) ?? []).filter((a) => a.profile_id && a.roles.includes('judge')));
    const evs = (ev.data as ScoreEvent[]) ?? [];
    setEvents(evs);
    // Names for the audit log: starters plus whoever entered scores (judges/admins).
    const ids = [...new Set(evs.map((e) => e.judge_id).filter((x): x is string => !!x))];
    const { data: who } = ids.length ? await supabase.from('profiles').select('id, full_name, full_name_he').in('id', ids) : { data: [] };
    setNames(new Map([...st.map((s) => s.profile), ...((who ?? []) as { id: string; full_name: string; full_name_he: string | null }[])]
      .map((p) => [p.id, localized(lang, p.full_name, p.full_name_he)])));
    setError(b.error?.message ?? regs.error?.message ?? res.error?.message ?? asg.error?.message ?? acc.error?.message ?? ev.error?.message ?? null);
  }, [id, lang]);
  useEffect(() => { void reload(); }, [reload]);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    setError(error?.message ?? null);
    if (!error) await reload();
  };

  const boulderNo = useMemo(() => new Map(boulders.map((b) => [b.id, b.number])), [boulders]);

  if (!round) return <section><AdminNav /><ErrorLine error={error} /><p className="muted">{t('loading')}</p></section>;

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
            {boulders.map((b) => <option key={b.id} value={b.id}>{t('boulder')} {b.number}</option>)}
          </select>
          <button className="secondary" disabled={judges.length === 0}>{t('assign')}</button>
        </form>
      </div>

      <div className="panel">
        <h2>{t('corrections')}</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr><th>{t('bib')}</th><th>{t('athlete')}</th>{boulders.map((b) => <th key={b.id}>{b.number}</th>)}<th /></tr>
            </thead>
            <tbody>
              {starters.map((s) => editing === s.climber_id ? (
                <CorrectionRow key={s.climber_id} starter={s} boulders={boulders} results={results}
                  onCancel={() => setEditing(null)}
                  onSave={async (p) => { await run(p); setEditing(null); }} />
              ) : (
                <tr key={s.climber_id}>
                  <td>{s.bib}</td>
                  <td>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</td>
                  {boulders.map((b) => {
                    const r = results.get(resultKey(b.id, s.climber_id));
                    return <td key={b.id} className="mono">{r ? `${r.attempts}/${r.zone_attempt ?? '-'}/${r.top_attempt ?? '-'}` : ''}</td>;
                  })}
                  <td><button className="link" onClick={() => setEditing(s.climber_id)}>✎</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">{t('attempts')} / {t('zone')} / {t('top')}</p>
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
                <td>{t('boulder')} {boulderNo.get(e.boulder_id)}</td>
                <td className="mono">{e.attempts}/{e.zone_attempt ?? '-'}/{e.top_attempt ?? '-'}</td>
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
