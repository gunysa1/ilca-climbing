import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { localized, useI18n } from '../lib/i18n';
import { formatHeight } from '../lib/lead';
import { resultKey, useRoundData, type LeadRow, type Starter } from '../lib/roundData';
import { applyAction, EMPTY_RESULT, type BoulderResult, type JudgeAction } from '../lib/scoring';
import { supabase } from '../lib/supabase';
import { LEAD_COLUMNS, RESULT_COLUMNS, type Boulder, type RoundFormat } from '../lib/types';

interface Assignment {
  id: string;
  round_id: string;
  boulder_id: string | null;
  round: {
    kind: 'qualification' | 'semifinal' | 'final';
    status: string;
    scoring: RoundFormat;
    boulders: Boulder[];
    category: { name: string; name_he: string | null; competition: { name: string; name_he: string | null } };
  };
}

/** List of the judge's assignments in live rounds (RLS returns only the caller's own). */
export function JudgeHome() {
  const { t, lang } = useI18n();
  const { profileId } = useAuth();
  const [items, setItems] = useState<Assignment[] | null>(null);

  useEffect(() => {
    if (!profileId) return;
    supabase.from('judge_assignments')
      .select('id, round_id, boulder_id, round:rounds!inner(kind, status, scoring, boulders(id, round_id, number), category:categories(name, name_he, competition:competitions(name, name_he)))')
      .eq('judge_id', profileId).eq('round.status', 'live')
      .then(({ data }) => setItems((data as unknown as Assignment[]) ?? []));
  }, [profileId]);

  return (
    <section>
      <h1>{t('myAssignments')}</h1>
      {items === null && <p className="muted">{t('loading')}</p>}
      {items?.length === 0 && <p className="muted">{t('noAssignments')}</p>}
      {items?.map((a) => {
        const boulders = a.boulder_id ? a.round.boulders.filter((b) => b.id === a.boulder_id) : a.round.boulders;
        return (
          <div key={a.id} className="panel">
            <h2>
              {localized(lang, a.round.category.competition.name, a.round.category.competition.name_he)} ·{' '}
              {localized(lang, a.round.category.name, a.round.category.name_he)} · {t(a.round.kind)}
            </h2>
            <div className="chips">
              {[...boulders].sort((x, y) => x.number - y.number).map((b) => (
                <Link key={b.id} className="chip" to={`/judge/${a.round_id}/${b.id}`}>{t(a.round.scoring === 'lead' ? 'route' : 'boulder')} {b.number}</Link>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Who holds a climber on a boulder: the calling judge claims them (re-claimed every 2 minutes while
 * the pad is open, released on close); another judge's fresh claim blocks the pad. */
function useClaim(roundId: string, boulderId: string, climberId: string) {
  const { profileId } = useAuth();
  const [holder, setHolder] = useState<{ judge_id: string; judge_name: string } | null>(null);
  const claim = useCallback(async () => {
    const { data } = await supabase.rpc('claim_climber', { p_round: roundId, p_boulder: boulderId, p_climber: climberId });
    setHolder(((data ?? []) as { judge_id: string; judge_name: string }[])[0] ?? null);
  }, [roundId, boulderId, climberId]);
  useEffect(() => {
    void claim();
    const beat = setInterval(() => void claim(), 120_000);
    return () => { clearInterval(beat); void supabase.rpc('release_claim', { p_boulder: boulderId, p_climber: climberId }); };
  }, [claim, boulderId, climberId]);
  return { holder, mine: !!holder && holder.judge_id === profileId, retry: claim };
}

/** Claims on a boulder by other judges, live (climber id -> judge name). */
function useBoulderClaims(boulderId: string | undefined) {
  const { profileId } = useAuth();
  const [claims, setClaims] = useState(new Map<string, string>());
  useEffect(() => {
    if (!boulderId) return;
    const load = () => supabase.from('judge_claims').select('climber_id, judge_id, claimed_at, judge:profiles!judge_claims_judge_id_fkey(full_name)')
      .eq('boulder_id', boulderId)
      .then(({ data }) => setClaims(new Map(((data ?? []) as unknown as { climber_id: string; judge_id: string; claimed_at: string; judge: { full_name: string } | null }[])
        .filter((c) => c.judge_id !== profileId && Date.now() - Date.parse(c.claimed_at) < 600_000)
        .map((c) => [c.climber_id, c.judge?.full_name ?? '?']))));
    void load();
    const channel = supabase.channel(`claims:${boulderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judge_claims', filter: `boulder_id=eq.${boulderId}` }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), 30_000);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [boulderId, profileId]);
  return claims;
}

/** Scoring pad for one boulder: pick a climber, record attempts / zone / top. */
export function JudgeBoulder() {
  const { roundId, boulderId } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, leadResults, loading } = useRoundData(roundId);
  const [current, setCurrent] = useState<Starter | null>(null);
  const boulder = boulders.find((b) => b.id === boulderId);
  const claims = useBoulderClaims(boulder?.id);

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!boulder) return <p className="notice">{t('noAccess')}</p>;

  return (
    <section>
      <h1>{t(round?.scoring === 'lead' ? 'route' : 'boulder')} {boulder.number}</h1>
      <div className="judge-layout">
        <ul className="starter-list">
          {starters.map((s) => {
            const r = results.get(resultKey(boulder.id, s.climber_id));
            const l = leadResults.get(resultKey(boulder.id, s.climber_id));
            return (
              <li key={s.climber_id}>
                <button className={current?.climber_id === s.climber_id ? 'selected' : ''} onClick={() => setCurrent(s)}>
                  <span className="bib">{s.bib ?? '–'}</span>
                  <span>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</span>
                  <span className="muted small">
                    {(r?.locked || l?.locked) && <span title={t('resultLocked')}>🔒 </span>}
                    {claims.has(s.climber_id) && <span title={t('claimedBy')}>✋ {claims.get(s.climber_id)} · </span>}
                    {l ? formatHeight(l) : r ? `${r.top_attempt ? 'T' + r.top_attempt : ''} ${r.zone_attempt ? 'Z' + r.zone_attempt : ''} · ${r.attempts}` : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {current && round?.scoring === 'lead' && (
          <LeadPad
            key={current.climber_id}
            roundId={roundId!}
            routeId={boulder.id}
            starter={current}
            initial={leadResults.get(resultKey(boulder.id, current.climber_id))}
            locked={!!leadResults.get(resultKey(boulder.id, current.climber_id))?.locked}
          />
        )}
        {current && round?.scoring !== 'lead' && (
          <ScorePad
            key={current.climber_id}
            roundId={roundId!}
            boulderId={boulder.id}
            starter={current}
            initial={results.get(resultKey(boulder.id, current.climber_id)) ?? EMPTY_RESULT}
            locked={!!results.get(resultKey(boulder.id, current.climber_id))?.locked}
          />
        )}
      </div>
    </section>
  );
}

function ScorePad({ roundId, boulderId, starter, initial, locked: initiallyLocked }:
  { roundId: string; boulderId: string; starter: Starter; initial: BoulderResult; locked: boolean }) {
  const { t, lang } = useI18n();
  const { holder, mine, retry } = useClaim(roundId, boulderId, starter.climber_id);
  const [locked, setLocked] = useState(initiallyLocked);
  const [history, setHistory] = useState<BoulderResult[]>([]);
  const [state, setState] = useState<BoulderResult>({
    attempts: initial.attempts, zone_attempt: initial.zone_attempt, top_attempt: initial.top_attempt,
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save(next: BoulderResult, prev: BoulderResult, lock = false) {
    setStatus('saving');
    const { error } = await supabase.from('boulder_results').upsert(
      { boulder_id: boulderId, climber_id: starter.climber_id, round_id: roundId, ...next, ...(lock ? { locked: true } : {}) },
      { onConflict: 'boulder_id,climber_id' },
    ).select(RESULT_COLUMNS);
    if (error) { setState(prev); setStatus('error'); } else { setStatus('saved'); if (lock) setLocked(true); }
  }

  function act(action: JudgeAction) {
    const next = applyAction(state, action);
    if (next === state) return;
    setHistory((h) => [...h, state]);
    setState(next);
    void save(next, state);
  }

  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    const before = state;
    setState(prev);
    void save(prev, before);
  }

  const blocked = locked || !mine;
  return (
    <div className="pad">
      <h2>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</h2>
      <PadNotice locked={locked} holder={mine ? null : holder} onRetry={retry} />
      <div className="pad-readout">
        <div><span className="muted">{t('attempt')}</span><strong>{state.attempts}</strong></div>
        <div><span className="muted">{t('zone')}</span><strong>{state.zone_attempt ?? '–'}</strong></div>
        <div><span className="muted">{t('top')}</span><strong>{state.top_attempt ?? '–'}</strong></div>
      </div>
      <div className="pad-buttons">
        <button className="pad-attempt" onClick={() => act('attempt')} disabled={blocked || state.top_attempt != null}>+1 {t('attempt')}</button>
        <button className="pad-zone" onClick={() => act('zone')} disabled={blocked || state.zone_attempt != null}>{t('zone')}</button>
        <button className="pad-top" onClick={() => act('top')} disabled={blocked || state.top_attempt != null}>{t('top')}</button>
        <button className="pad-undo" onClick={undo} disabled={blocked || history.length === 0}>{t('undo')}</button>
      </div>
      <button className="primary pad-save" disabled={blocked || state.attempts === 0}
        onClick={() => { if (window.confirm(t('finishConfirm'))) void save(state, state, true); }}>{t('finishClimber')}</button>
      <p className={`pad-status ${status}`} aria-live="polite">
        {status === 'saved' ? t('saved') : status === 'error' ? t('saveFailed') : status === 'saving' ? '…' : ''}
      </p>
    </div>
  );
}

/** Lead pad for one route: the judge records the final height (hold, + or TOP) and saves it. */
function LeadPad({ roundId, routeId, starter, initial, locked: initiallyLocked }:
  { roundId: string; routeId: string; starter: Starter; initial: LeadRow | undefined; locked: boolean }) {
  const { t, lang } = useI18n();
  const { holder, mine, retry } = useClaim(roundId, routeId, starter.climber_id);
  const [locked, setLocked] = useState(initiallyLocked);
  const blocked = locked || !mine;
  const [hold, setHold] = useState(initial?.hold ?? 0);
  const [plus, setPlus] = useState(initial?.plus ?? false);
  const [top, setTop] = useState(initial?.top ?? false);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const changed = () => setStatus('idle');

  async function save(lock = false) {
    setStatus('saving');
    const { error } = await supabase.from('lead_results').upsert(
      { boulder_id: routeId, climber_id: starter.climber_id, round_id: roundId, hold, plus: top ? false : plus, top, ...(lock ? { locked: true } : {}) },
      { onConflict: 'boulder_id,climber_id' },
    ).select(LEAD_COLUMNS);
    setStatus(error ? 'error' : 'saved');
    if (!error && lock) setLocked(true);
  }

  return (
    <div className="pad">
      <h2>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</h2>
      <PadNotice locked={locked} holder={mine ? null : holder} onRetry={retry} />
      <div className="pad-readout lead-readout">
        <div><span className="muted">{t('hold')}</span><strong dir="ltr">{formatHeight({ hold, plus, top })}</strong></div>
      </div>
      <div className="pad-buttons">
        <button className="pad-undo" onClick={() => { setHold((h) => Math.max(0, h - 1)); changed(); }} disabled={blocked || top || hold === 0}>−1</button>
        <button className="pad-attempt" onClick={() => { setHold((h) => h + 1); changed(); }} disabled={blocked || top}>+1 {t('hold')}</button>
        <button className="pad-zone" aria-pressed={plus} onClick={() => { setPlus((p) => !p); changed(); }} disabled={blocked || top}>{t('plusMove')}</button>
        <button className="pad-top" aria-pressed={top} onClick={() => { setTop((v) => !v); setPlus(false); changed(); }} disabled={blocked}>TOP</button>
      </div>
      <button className="primary pad-save" onClick={() => void save()} disabled={blocked || status === 'saving'}>{t('save')}</button>
      <button className="secondary pad-save" disabled={blocked || status === 'saving'}
        onClick={() => { if (window.confirm(t('finishConfirm'))) void save(true); }}>{t('finishClimber')}</button>
      <p className={`pad-status ${status}`} aria-live="polite">
        {status === 'saved' ? t('saved') : status === 'error' ? t('saveFailed') : status === 'saving' ? '…' : ''}
      </p>
    </div>
  );
}

/** Why the pad is read-only: the result is final, or another judge is scoring this climber. */
function PadNotice({ locked, holder, onRetry }: { locked: boolean; holder: { judge_name: string } | null; onRetry: () => void }) {
  const { t } = useI18n();
  if (locked) return <p className="notice">🔒 {t('resultLockedHint')}</p>;
  if (holder) return <p className="notice">✋ {t('claimedBy')} {holder.judge_name} <button className="link" onClick={onRetry}>{t('retry')}</button></p>;
  return null;
}
