import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { localized, useI18n, type MsgKey } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';
import type { Profile } from '../../lib/types';
import { Sheet } from '../../components/Sheet';
import { AdminNav, ErrorLine } from './AdminHome';
import { ClimberPicker } from './ClimberPicker';
import { fill } from './ifscSync';

/** Report of merge_profiles() (migration 039). */
interface MergeReport {
  keep: { id: string; full_name: string };
  drop: { id: string; full_name: string };
  moves: Record<string, number>;  // "table.column" -> rows
  differences: { field: string; keep: string | null; drop: string | null; result: string | null }[];
  conflicts: ({ kind: string; text: string } & Record<string, string | undefined>)[];
  applied: boolean;
}
interface Suggestion { a: string; a_name: string; b: string; b_name: string; reason: 'same_name' | 'swapped_name' }
type Picked = Pick<Profile, 'id' | 'full_name' | 'full_name_he' | 'club'>;

// The moves an admin recognises; the rest (score logs, who entered results, caches) are summed as "other records".
const MOVE_LABELS: Record<string, MsgKey> = {
  'registrations.climber_id': 'mergeTRegistrations',
  'round_starters.climber_id': 'mergeTStarters',
  'boulder_results.climber_id': 'mergeTResults',
  'lead_results.climber_id': 'mergeTLeadResults',
  'round_totals.climber_id': 'mergeTTotals',
  'international_results.climber_id': 'mergeTIntl',
  'ranking_adjustments.climber_id': 'mergeTAdjust',
  'world_rankings.climber_id': 'mergeTWorld',
  'coach_athletes.climber_id': 'mergeTCoach',
  'coach_athletes.coach_id': 'mergeTCoach',
  'coach_notes.climber_id': 'mergeTNotes',
  'coach_notes.coach_id': 'mergeTNotes',
  'judge_assignments.judge_id': 'mergeTJudging',
  'appeals.climber_id': 'mergeTAppeals',
};
const FIELD_LABELS: Record<string, MsgKey> = {
  full_name: 'nameEn', full_name_he: 'nameHe', gender: 'gender', club: 'club', country: 'country', ifsc_id: 'ifscId',
  login: 'mergeLogin', birth_date: 'birthDate', phone: 'phone', email: 'email',
  emergency_contact: 'emergencyContact', medical_notes: 'medicalNotes',
};
const ROUND_KINDS = new Set(['qualification', 'semifinal', 'final']);

/** Admin: merge two profiles of the same climber (preview first, then a second confirmation). */
export function AdminMerge() {
  const { t, lang } = useI18n();
  const [keep, setKeep] = useState<Picked | null>(null);
  const [drop, setDrop] = useState<Picked | null>(null);
  const [report, setReport] = useState<MergeReport | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [merged, setMerged] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = (p: Picked) => localized(lang, p.full_name, p.full_name_he);

  const loadSuggestions = useCallback(async () => {
    const { data, error } = await supabase.rpc('possible_duplicate_profiles');
    if (error) setError(error.message);
    setSuggestions((data as Suggestion[] | null) ?? []);
  }, []);
  useEffect(() => { void loadSuggestions(); }, [loadSuggestions]);

  async function profile(id: string): Promise<Picked | null> {
    const { data, error } = await supabase.from('profiles').select('id, full_name, full_name_he, club').eq('id', id).maybeSingle();
    if (error) setError(error.message);
    return (data as Picked | null) ?? null;
  }
  const pick = (set: (p: Picked | null) => void) => async (id: string) => { setMerged(null); set(await profile(id)); };
  async function compare(s: Suggestion) {
    setMerged(null);
    const [a, b] = await Promise.all([profile(s.a), profile(s.b)]);
    setKeep(a); setDrop(b);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Preview whenever both are picked.
  useEffect(() => {
    setReport(null);
    if (!keep || !drop || keep.id === drop.id) return;
    let live = true;
    void supabase.rpc('merge_profiles', { p_keep: keep.id, p_drop: drop.id }).then(({ data, error }) => {
      if (!live) return;
      setError(error?.message ?? null);
      setReport((data as MergeReport | null) ?? null);
    });
    return () => { live = false; };
  }, [keep, drop]);

  async function merge() {
    if (!keep || !drop) return;
    setConfirming(false); setBusy(true); setError(null);
    const { error } = await supabase.rpc('merge_profiles', { p_keep: keep.id, p_drop: drop.id, p_apply: true });
    setBusy(false);
    if (error) return setError(error.message);
    setMerged(keep); setKeep(null); setDrop(null);
    void loadSuggestions();
  }

  const conflictText = (c: MergeReport['conflicts'][number]) => {
    const round = c.round && ROUND_KINDS.has(c.round) ? t(c.round as MsgKey) : c.round ?? '';
    const v = {
      competition: localized(lang, c.competition ?? '', c.competition_he), category: localized(lang, c.category ?? '', c.category_he),
      round, event: c.event ?? '', date: c.date ?? '', season: c.season ?? '',
      discipline: c.discipline === 'boulder' || c.discipline === 'lead' ? t(c.discipline) : c.discipline ?? '',
      keep: c.keep ?? '', drop: c.drop ?? '',
    };
    switch (c.kind) {
      case 'round': return fill(t('mergeConflictRound'), v);
      case 'registration': return fill(t('mergeConflictRegistration'), v);
      case 'international': return fill(t('mergeConflictInternational'), v);
      case 'world_ranking': return fill(t('mergeConflictWorld'), v);
      case 'two_logins': return t('mergeConflictLogins');
      case 'different_ifsc': return fill(t('mergeConflictIfsc'), v);
      default: return c.text;
    }
  };

  const moves = useMemo(() => {
    const known = new Map<MsgKey, number>();
    let other = 0;
    for (const [k, n] of Object.entries(report?.moves ?? {})) {
      const label = MOVE_LABELS[k];
      if (label) known.set(label, (known.get(label) ?? 0) + n); else other += n;
    }
    return { known: [...known], other };
  }, [report]);

  const picker = (label: string, value: Picked | null, set: (p: Picked | null) => void, other: Picked | null) => (
    <div className="panel">
      <h2>{label}</h2>
      {value ? (
        <p className="admin-row">
          <strong>{name(value)}</strong> <span className="muted small">{value.club}</span>
          <Link to={`/climber/${value.id}`} target="_blank" className="small">↗</Link>
          <button className="link" onClick={() => set(null)}>{t('mergeChange')}</button>
        </p>
      ) : (
        <ClimberPicker exclude={new Set(other ? [other.id] : [])} actionLabel={t('mergePick')} defaultGender={null}
          allowCreate={false} onPick={pick(set)} />
      )}
    </div>
  );

  const canMerge = report && !report.applied && report.conflicts.length === 0 && !busy;

  return (
    <section>
      <h1>{t('mergeTitle')}</h1>
      <AdminNav />
      <p className="muted">{t('mergeIntro')}</p>
      <ErrorLine error={error} />
      {merged && (
        <p className="notice">✓ {t('mergeDone')} <Link to={`/climber/${merged.id}`}>{name(merged)}</Link></p>
      )}

      {picker(t('mergeKeep'), keep, setKeep, drop)}
      {picker(t('mergeDrop'), drop, setDrop, keep)}
      {keep && drop && (
        <p><button className="link" onClick={() => { setKeep(drop); setDrop(keep); }}>⇅ {t('mergeSwap')}</button></p>
      )}

      {report && keep && drop && (
        <div className="panel">
          <h2>{t('mergeMoves')}</h2>
          {moves.known.length === 0 && moves.other === 0 ? <p className="muted">{t('mergeNothingMoves')}</p> : (
            <ul className="admin-rows">
              {moves.known.map(([label, n]) => <li key={label} className="admin-row"><span>{t(label)}</span><strong>{n}</strong></li>)}
              {moves.other > 0 && <li className="admin-row muted"><span>{t('mergeOther')}</span><span>{moves.other}</span></li>}
            </ul>
          )}

          <h2>{t('mergeDiffs')}</h2>
          {report.differences.length === 0 ? <p className="muted">{t('mergeNoDiffs')}</p> : (
            <div className="table-wrap">
              <table className="admin-table">
                <thead><tr><th /><th>{name(keep)}</th><th>{name(drop)}</th><th>{t('mergeAfter')}</th></tr></thead>
                <tbody>
                  {report.differences.map((d) => (
                    <tr key={d.field}>
                      <th>{FIELD_LABELS[d.field] ? t(FIELD_LABELS[d.field]) : d.field}</th>
                      <td>{d.keep ?? <span className="muted">—</span>}</td>
                      <td>{d.drop ?? <span className="muted">—</span>}</td>
                      <td><strong>{d.result ?? '—'}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.conflicts.length > 0 && (
            <div role="alert">
              <p className="error">{t('mergeConflicts')}</p>
              <ul>{report.conflicts.map((c, i) => <li key={i}>{conflictText(c)}</li>)}</ul>
            </div>
          )}
          <button className="danger" disabled={!canMerge} onClick={() => setConfirming(true)}>{t('mergeButton')}</button>
        </div>
      )}

      {confirming && keep && drop && (
        <Sheet title={t('mergeConfirmTitle')} confirm={t('mergeButton')} danger
          onConfirm={() => void merge()} onCancel={() => setConfirming(false)}>
          <p className="sheet-result">{fill(t('mergeConfirmText'), { keep: name(keep), drop: name(drop) })}</p>
        </Sheet>
      )}

      <div className="panel">
        <h2>{t('mergeSuggestions')}{suggestions ? ` (${suggestions.length})` : ''}</h2>
        {suggestions?.length === 0 && <p className="muted">{t('mergeNoSuggestions')}</p>}
        <ul className="admin-rows">
          {suggestions?.slice(0, 100).map((s) => (
            <li key={`${s.a}:${s.b}`} className="admin-row">
              <span>{s.a_name} · {s.b_name}</span>
              <span className="muted small">{t(s.reason === 'same_name' ? 'mergeSameName' : 'mergeSwappedName')}</span>
              <button className="link" onClick={() => void compare(s)}>{t('mergeCompare')}</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
