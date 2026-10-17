import { Sheet } from '../components/Sheet';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { localized, useI18n } from '../lib/i18n';
import { useOutbox } from '../lib/judgeOutbox';
import { formatHeight } from '../lib/lead';
import { resultKey, useRoundData, type LeadRow, type Starter } from '../lib/roundData';
import { isTransient, keyState, outboxKey, type OutboxEntry, type OutboxSnapshot, type ResultTable } from '../lib/saveQueue';
import { applyAction, boulderPoints, EMPTY_RESULT, type BoulderResult, type JudgeAction } from '../lib/scoring';
import { supabase } from '../lib/supabase';
import { type Boulder, type RoundFormat } from '../lib/types';

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
    // Kept on the device: without signal the judge still finds their boulders.
    const key = `ilca.judgeAssignments.${profileId}`;
    supabase.from('judge_assignments')
      .select('id, round_id, boulder_id, round:rounds!inner(kind, status, scoring, boulders(id, round_id, number), category:categories(name, name_he, competition:competitions(name, name_he)))')
      .eq('judge_id', profileId).eq('round.status', 'live')
      .then(({ data, error }) => {
        if (error) {
          let kept: Assignment[] = [];
          try { kept = JSON.parse(localStorage.getItem(key) ?? '[]') as Assignment[]; } catch { /* nothing kept */ }
          setItems(Array.isArray(kept) ? kept : []);
          return;
        }
        try { localStorage.setItem(key, JSON.stringify(data ?? [])); } catch { /* storage unavailable */ }
        setItems((data as unknown as Assignment[]) ?? []);
      });
  }, [profileId]);

  return (
    <section>
      <h1>{t('myAssignments')}</h1>
      <OutboxFailed />
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

/** Claims refresh every 10 s; another judge's claim older than 30 s is stale (claim_climber). */
const CLAIM_BEAT_MS = 10_000;
const CLAIM_STALE_MS = 30_000;

/** Who holds a climber on a boulder: the calling judge claims them while the pad is open (re-claimed
 * every 10 s, released on close); another judge's fresh claim keeps the pad read-only. Without
 * signal the last answer stands (no answer yet: the pad stays editable); only an explicit "held by
 * another judge" makes it read-only. */
function useClaim(roundId: string, boulderId: string, climberId: string, enabled: boolean) {
  const { profileId } = useAuth();
  const [holder, setHolder] = useState<{ judge_id: string; judge_name: string } | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const claim = useCallback(async () => {
    const { data, error, status } = await supabase.rpc('claim_climber', { p_round: roundId, p_boulder: boulderId, p_climber: climberId });
    if (error && isTransient(status)) { setUnreachable(true); return; }
    setUnreachable(false);
    setHolder(((data ?? []) as { judge_id: string; judge_name: string }[])[0] ?? null);
  }, [roundId, boulderId, climberId]);
  useEffect(() => {
    if (!enabled) return;
    void claim();
    const beat = setInterval(() => void claim(), CLAIM_BEAT_MS);
    return () => { clearInterval(beat); void supabase.rpc('release_claim', { p_boulder: boulderId, p_climber: climberId }); };
  }, [claim, boulderId, climberId, enabled]);
  // On the wall (public "climbing now"): only when the judge marks it (set_on_wall), never by opening.
  const [onWall, setOnWall] = useState(false);
  const markWall = useCallback(async (on: boolean) => {
    const { error } = await supabase.rpc('set_on_wall', { p_boulder: boulderId, p_climber: climberId, p_on: on });
    if (!error) setOnWall(on);
  }, [boulderId, climberId]);
  return { holder, mine: !enabled || (holder ? holder.judge_id === profileId : unreachable), onWall, markWall };
}

/** "▶ On the wall" / "■ Off the wall": what the public sees as climbing now on this boulder. */
function WallToggle({ onWall, markWall, disabled }: { onWall: boolean; markWall: (on: boolean) => Promise<void>; disabled: boolean }) {
  const { t } = useI18n();
  if (disabled) return null;
  return (
    <div className={`wall-toggle${onWall ? ' on' : ''}`}>
      <span className="small">{onWall ? <><span className="live-dot" aria-hidden /> {t('onWallShown')}</> : t('onWallHint')}</span>
      <button className={onWall ? 'secondary' : 'primary'} onClick={() => void markWall(!onWall)} aria-pressed={onWall}>
        {onWall ? `■ ${t('offWall')}` : `▶ ${t('putOnWall')}`}
      </button>
    </div>
  );
}

/** Fresh claims on a boulder by other judges, live (climber id -> judge name). */
function useBoulderClaims(boulderId: string | undefined) {
  const { profileId } = useAuth();
  const [claims, setClaims] = useState(new Map<string, string>());
  useEffect(() => {
    if (!boulderId) return;
    const load = () => supabase.from('judge_claims').select('climber_id, judge_id, claimed_at, judge:profiles!judge_claims_judge_id_fkey(full_name)')
      .eq('boulder_id', boulderId)
      .then(({ data, error }) => !error && setClaims(new Map(((data ?? []) as unknown as { climber_id: string; judge_id: string; claimed_at: string; judge: { full_name: string } | null }[])
        .filter((c) => c.judge_id !== profileId && Date.now() - Date.parse(c.claimed_at) < CLAIM_STALE_MS)
        .map((c) => [c.climber_id, c.judge?.full_name ?? '?']))));
    void load();
    const channel = supabase.channel(`claims:${boulderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'judge_claims', filter: `boulder_id=eq.${boulderId}` }, () => void load())
      .subscribe();
    const poll = setInterval(() => void load(), CLAIM_BEAT_MS);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [boulderId, profileId]);
  return claims;
}

/**
 * Judge pad for one boulder or route, like a judge works at the wall: one climber at a time in start
 * order, with progress, back / next and the full list one tap away. Locking a result ("next · lock")
 * moves to the next climber still to judge; a climber another judge holds can be skipped.
 */
export function JudgeBoulder() {
  const { roundId, boulderId } = useParams();
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, leadResults, loading } = useRoundData(roundId, { offline: true });
  const boulder = boulders.find((b) => b.id === boulderId);
  const claims = useBoulderClaims(boulder?.id);
  const { snap } = useOutbox();
  const lead = round?.scoring === 'lead';
  const table: ResultTable = lead ? 'lead_results' : 'boulder_results';
  const [index, setIndex] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);
  const [toast, setToast] = useState('');
  // The judge's unsent row for a climber on this boulder (shown instead of the server's).
  const unsent = useCallback((s: Starter) => boulder && pendingEntry(snap, outboxKey(table, boulder.id, s.climber_id)), [boulder, snap, table]);
  // Locked on the server, or locked here and still waiting to be sent.
  const locked = useCallback((s: Starter) => !!boulder && !!(results.get(resultKey(boulder.id, s.climber_id))?.locked
    || leadResults.get(resultKey(boulder.id, s.climber_id))?.locked || unsent(s)?.lock), [boulder, results, leadResults, unsent]);
  // The next climber still to judge after `from`: not locked and not held by another judge.
  const nextFree = useCallback((from: number) => {
    for (let i = from + 1; i < starters.length; i++) if (!locked(starters[i]) && !claims.has(starters[i].climber_id)) return i;
    return -1;
  }, [starters, locked, claims]);
  // Start with the first climber still to judge.
  useEffect(() => {
    if (index === null && starters.length) setIndex(Math.max(0, nextFree(-1)));
  }, [index, starters, nextFree]);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(''), 2500); return () => clearTimeout(h); }, [toast]);

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!boulder || !round) return <p className="notice">{t('noAccess')}</p>;
  const i = Math.min(index ?? 0, Math.max(0, starters.length - 1));
  const current = starters[i];
  const done = starters.filter(locked).length;
  const go = (to: number) => { setIndex(to); setShowList(false); };
  const afterLock = (bib: number | null) => {
    const next = nextFree(i);
    setToast(next >= 0 ? `${t('lockedToast')} #${bib ?? ''}` : `${t('lockedToast')} #${bib ?? ''} · ${t('endOfList')}`);
    if (next >= 0) go(next);
  };

  const label = (s: Starter) => ({ climber: `#${s.bib ?? '–'} ${localized(lang, s.profile.full_name, s.profile.full_name_he)}`, boulder: boulder.number });

  return (
    <section className="judge">
      <OutboxFailed />
      <div className="judge-top">
        <Link className="button secondary" to="/judge">{lang === 'he' ? '→' : '←'} {t(lead ? 'routesWord' : 'bouldersWord')}</Link>
        <div className="judge-title">
          <strong>{t(lead ? 'route' : 'boulder')} {boulder.number}</strong>
          <span className="muted small">{i + 1} / {starters.length} · {t('lockedCount')} {done}</span>
        </div>
        <button className="secondary" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>☰ {t('climberList')}</button>
      </div>
      <div className="judge-steps">
        <button className="secondary" onClick={() => go(i - 1)} disabled={i === 0}>{t('prevClimber')}</button>
        <button className="secondary" onClick={() => go(i + 1)} disabled={i >= starters.length - 1}>{t('followingClimber')}</button>
      </div>
      {showList && (
        <ul className="starter-list">
          {starters.map((s, k) => {
            const waiting = unsent(s)?.row;
            const r = (waiting && !lead ? waiting as unknown as BoulderResult : undefined) ?? results.get(resultKey(boulder.id, s.climber_id));
            const l = (waiting && lead ? waiting as unknown as LeadRow : undefined) ?? leadResults.get(resultKey(boulder.id, s.climber_id));
            return (
              <li key={s.climber_id}>
                <button className={k === i ? 'selected' : ''} onClick={() => go(k)}>
                  <span className="bib">{s.bib ?? '–'}</span>
                  <span>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</span>
                  <span className="muted small">
                    {waiting && '⏳ '}
                    {locked(s) && '🔒 '}
                    {claims.has(s.climber_id) && `✋ ${claims.get(s.climber_id)} · `}
                    {l ? formatHeight(l) : r ? shorthand(r) : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {current && (lead
        ? <LeadPad key={current.climber_id} roundId={roundId!} routeId={boulder.id} starter={current} label={label(current)}
            initial={(unsent(current)?.row as LeadRow | undefined) ?? leadResults.get(resultKey(boulder.id, current.climber_id))} locked={locked(current)}
            onLocked={() => afterLock(current.bib)} nextFree={nextFree(i)} onGo={go} />
        : <ScorePad key={current.climber_id} roundId={roundId!} boulderId={boulder.id} starter={current} label={label(current)}
            initial={(unsent(current)?.row as BoulderResult | undefined) ?? results.get(resultKey(boulder.id, current.climber_id)) ?? EMPTY_RESULT}
            locked={locked(current)} onLocked={() => afterLock(current.bib)} nextFree={nextFree(i)} onGo={go} />)}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

const shorthand = (r: BoulderResult) =>
  [r.top_attempt != null && `T${r.top_attempt}`, r.zone_attempt != null && `Z${r.zone_attempt}`, `· ${r.attempts}`].filter(Boolean).join(' ');

interface PadNav { onLocked: () => void; nextFree: number; onGo: (index: number) => void }
type PadLabel = NonNullable<OutboxEntry['meta']>;

const pendingEntry = (snap: OutboxSnapshot, key: string) => snap.pending.find((e) => e.key === key);

/** Header badge while results wait on this device to be sent (any staff screen: they keep sending). */
export function OutboxBadge() {
  const { t } = useI18n();
  const { snap } = useOutbox();
  if (!snap.pending.length) return null;
  return <span className="outbox-badge" role="status" title={t('pendingBadgeHint')}>⏳ {snap.pending.length} {t('pendingCount')}</span>;
}

/** Results the server refused (locked by an admin, not a starter …): never retried; the judge tells
 *  an admin, who fixes them on the round page, and dismisses the notice. */
function OutboxFailed() {
  const { t } = useI18n();
  const { queue, snap } = useOutbox();
  if (!queue || !snap.failed.length) return null;
  return (
    <div className="notice outbox-failed" role="alert">
      <strong>{snap.failed.length} {t('failedResults')}</strong>
      <ul>
        {snap.failed.map((f) => (
          <li key={f.key}>
            {f.meta ? `${f.meta.climber} · ${t(f.table === 'lead_results' ? 'route' : 'boulder')} ${f.meta.boulder}` : f.key}
            <span className="muted small"> · {f.error}</span>
          </li>
        ))}
      </ul>
      <button className="secondary" onClick={() => queue.dismiss()}>{t('dismiss')}</button>
    </div>
  );
}

/** Under the pad: saved / waiting to send (with the count across all climbers) / refused. */
function PadStatus({ outboxKey: key, show }: { outboxKey: string; show: boolean }) {
  const { t } = useI18n();
  const { snap } = useOutbox();
  const state = keyState(snap, key);
  const failed = snap.failed.find((f) => f.key === key);
  const text = !show && state === 'saved' ? ''
    : state === 'pending' ? `⏳ ${t('pendingSend')}${snap.pending.length > 1 ? ` (${snap.pending.length})` : ''}`
    : state === 'failed' ? `${t('notSaved')}${failed ? ` · ${failed.error}` : ''}` : t('saved');
  return <p className={`pad-status ${state === 'failed' ? 'error' : text ? state : ''}`} aria-live="polite">{text}</p>;
}

/** Name, club and the state badges of the climber being judged. */
function PadHeader({ starter, badge }: { starter: Starter; badge: ReactNode }) {
  const { lang } = useI18n();
  return (
    <div className="pad-head">
      <span className="pad-bib">#{starter.bib ?? '–'}</span>
      <div>
        <h2>{localized(lang, starter.profile.full_name, starter.profile.full_name_he)}</h2>
        <span className="muted small">{[starter.age_class, starter.profile.club].filter(Boolean).join(' · ')}</span>
      </div>
      {badge}
    </div>
  );
}

/** Read-only states: locked (next climber), or held by another judge (next free climber). */
function PadBlocked({ locked, holder, nav }: { locked: boolean; holder: { judge_name: string } | null; nav: PadNav }) {
  const { t } = useI18n();
  if (locked) return <p className="notice">🔒 {t('resultLockedHint')}</p>;
  if (!holder) return null;
  return (
    <div className="notice claim-banner">
      ✋ {t('claimedBy')} {holder.judge_name}. {t('claimedHint')}
      <button className="primary" disabled={nav.nextFree < 0} onClick={() => nav.onGo(nav.nextFree)}>{t('nextFreeClimber')}</button>
    </div>
  );
}

function ScorePad({ roundId, boulderId, starter, label, initial, locked: initiallyLocked, ...nav }:
  { roundId: string; boulderId: string; starter: Starter; label: PadLabel; initial: BoulderResult; locked: boolean } & PadNav) {
  const { t } = useI18n();
  const { holder, mine, onWall, markWall } = useClaim(roundId, boulderId, starter.climber_id, !initiallyLocked);
  const { queue } = useOutbox();
  const key = outboxKey('boulder_results', boulderId, starter.climber_id);
  // Status shows once the judge saves here, or at once for unsent work from before (reload, back).
  const [touched, setTouched] = useState(() => !!queue && keyState(queue.snapshot(), key) !== 'saved');
  const [history, setHistory] = useState<BoulderResult[]>([]);
  const [state, setState] = useState<BoulderResult>({
    attempts: initial.attempts, zone_attempt: initial.zone_attempt, top_attempt: initial.top_attempt,
  });
  const [ask, setAsk] = useState<null | 'zone' | 'top' | 'lock'>(null);
  const [lockedNow, setLockedNow] = useState(false); // before the live update arrives
  const locked = initiallyLocked || lockedNow;
  const blocked = locked || !mine || !queue;
  const topped = state.top_attempt != null;
  const climbed = state.attempts > 0 || state.zone_attempt != null || state.top_attempt != null;
  const points = useMemo(() => boulderPoints(state), [state]);

  // Through the outbox: kept on the phone until the server has it (no revert without signal).
  function save(next: BoulderResult, lock = false) {
    queue?.enqueue({ key, table: 'boulder_results', lock, meta: label, row: { boulder_id: boulderId, climber_id: starter.climber_id,
      round_id: roundId, attempts: next.attempts, zone_attempt: next.zone_attempt, top_attempt: next.top_attempt } });
    setTouched(true);
  }

  function act(action: JudgeAction) {
    const next = applyAction(state, action);
    if (next === state || next.attempts === state.attempts && next.zone_attempt === state.zone_attempt && next.top_attempt === state.top_attempt) return;
    setHistory((h) => [...h, state]);
    setState(next);
    save(next);
    if (action === 'attempt' && !onWall) void markWall(true); // counting an attempt means they're climbing
  }
  // Zone / Top before any attempt was counted: ask first (like the temporary app).
  const outcome = (kind: 'zone' | 'top') => (state.attempts === 0 ? setAsk(kind) : act(kind));

  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setState(prev);
    save(prev);
  }

  // Without signal too: the lock waits in the outbox, the climber counts as locked here.
  function lock() {
    setAsk(null);
    save(state, true);
    setLockedNow(true);
    nav.onLocked();
  }

  const summary = !climbed ? t('notClimbedYet')
    : [`${state.attempts} ${t('attemptsWord')}`, state.zone_attempt != null ? `Zone ${state.zone_attempt}` : t('noZone'),
      state.top_attempt != null ? `Top ${state.top_attempt}` : t('noTop')].join(' · ');

  return (
    <div className="pad">
      <PadHeader starter={starter} badge={locked ? <span className="pad-badge">{t('lockedBadge')}</span>
        : !mine && holder ? <span className="pad-badge busy">{t('busyBadge')}</span> : null} />
      <PadBlocked locked={locked} holder={mine ? null : holder} nav={nav} />
      <WallToggle onWall={onWall} markWall={markWall} disabled={blocked} />

      <div className="pad-section">{t('attemptsWord')}</div>
      <div className="stepper">
        <button className="stepper-btn" aria-label={t('addAttempt')} onClick={() => act('attempt')} disabled={blocked || topped}>+</button>
        <strong className="stepper-value" aria-live="polite">{state.attempts}</strong>
        <button className="stepper-btn" aria-label={t('removeAttempt')} onClick={() => act('unattempt')}
          disabled={blocked || topped || state.attempts <= (state.zone_attempt ?? 0)}>−</button>
      </div>

      <div className="pad-section">{t('outcome')}</div>
      <div className="outcomes">
        <button className={`outcome top${topped ? ' on' : ''}`} onClick={() => outcome('top')} disabled={blocked || topped}>
          {topped ? `T${state.top_attempt}` : t('top')}
        </button>
        <button className={`outcome zone${state.zone_attempt != null ? ' on' : ''}`} onClick={() => outcome('zone')}
          disabled={blocked || topped || state.zone_attempt != null}>
          {state.zone_attempt != null ? `Z${state.zone_attempt}` : t('zone')}
        </button>
      </div>

      <div className="score-box">
        <div><span className="muted small">{t('points')}</span><div className="small">{summary}</div></div>
        <strong>{climbed ? points.toFixed(1) : '—'}</strong>
      </div>

      {locked
        ? <button className="primary pad-save" disabled={nav.nextFree < 0} onClick={() => nav.onGo(nav.nextFree)}>{t('nextClimber')}</button>
        : (
          <div className="pad-actions">
            <button className="secondary" onClick={undo} disabled={blocked || history.length === 0}>{t('undo')}</button>
            <button className="primary" onClick={() => setAsk('lock')} disabled={blocked || !climbed}>{t('lockAndNext')}</button>
          </div>
        )}
      <PadStatus outboxKey={key} show={touched} />

      {ask === 'lock' && (
        <Sheet title={t('confirmLockTitle')} confirm={t('yesLock')} onConfirm={lock} onCancel={() => setAsk(null)}>
          <p>{t('confirmLockText')}</p>
          <p className="sheet-result">#{starter.bib ?? '–'} · {summary} · <strong>{points.toFixed(1)}</strong></p>
        </Sheet>
      )}
      {(ask === 'zone' || ask === 'top') && (
        <Sheet title={t('zeroAttemptsTitle')} confirm={t('yesRecord')} onCancel={() => setAsk(null)}
          onConfirm={() => { const kind = ask; setAsk(null); act(kind); }}>
          <p>{t('zeroAttemptsText')} {ask === 'zone' ? 'Zone' : 'Top'}?</p>
        </Sheet>
      )}
    </div>
  );
}

/** Lead: the judge records the final height (hold, + or TOP); saving keeps it editable, locking ends it. */
function LeadPad({ roundId, routeId, starter, label, initial, locked: initiallyLocked, ...nav }:
  { roundId: string; routeId: string; starter: Starter; label: PadLabel; initial: Pick<LeadRow, 'hold' | 'plus' | 'top'> | undefined; locked: boolean } & PadNav) {
  const { t } = useI18n();
  const { holder, mine, onWall, markWall } = useClaim(roundId, routeId, starter.climber_id, !initiallyLocked);
  const { queue } = useOutbox();
  const key = outboxKey('lead_results', routeId, starter.climber_id);
  const [hold, setHold] = useState(initial?.hold ?? 0);
  const [plus, setPlus] = useState(initial?.plus ?? false);
  const [top, setTop] = useState(initial?.top ?? false);
  // Edited since the last save: no status until saved; saved: what the outbox says.
  const [edited, setEdited] = useState(false);
  const [saved, setSaved] = useState(() => !!queue && keyState(queue.snapshot(), key) !== 'saved');
  const [ask, setAsk] = useState(false);
  const [lockedNow, setLockedNow] = useState(false);
  const locked = initiallyLocked || lockedNow;
  const blocked = locked || !mine || !queue;
  const changed = () => setEdited(true);

  // Through the outbox, like the boulder pad; locking without signal moves on as well.
  function save(lock = false) {
    queue?.enqueue({ key, table: 'lead_results', lock, meta: label,
      row: { boulder_id: routeId, climber_id: starter.climber_id, round_id: roundId, hold, plus: top ? false : plus, top } });
    setEdited(false);
    setSaved(true);
    if (lock) { setLockedNow(true); nav.onLocked(); }
  }

  return (
    <div className="pad">
      <PadHeader starter={starter} badge={locked ? <span className="pad-badge">{t('lockedBadge')}</span>
        : !mine && holder ? <span className="pad-badge busy">{t('busyBadge')}</span> : null} />
      <PadBlocked locked={locked} holder={mine ? null : holder} nav={nav} />
      <WallToggle onWall={onWall} markWall={markWall} disabled={blocked} />
      <div className="pad-section">{t('hold')}</div>
      <div className="stepper">
        <button className="stepper-btn" onClick={() => { setHold((h) => h + 1); changed(); if (!onWall) void markWall(true); }} disabled={blocked || top} aria-label={`+1 ${t('hold')}`}>+</button>
        <strong className="stepper-value" dir="ltr">{formatHeight({ hold, plus, top })}</strong>
        <button className="stepper-btn" onClick={() => { setHold((h) => Math.max(0, h - 1)); changed(); }} disabled={blocked || top || hold === 0} aria-label={`−1 ${t('hold')}`}>−</button>
      </div>
      <div className="outcomes">
        <button className={`outcome top${top ? ' on' : ''}`} aria-pressed={top} onClick={() => { setTop((v) => !v); setPlus(false); changed(); }} disabled={blocked}>TOP</button>
        <button className={`outcome zone${plus ? ' on' : ''}`} aria-pressed={plus} onClick={() => { setPlus((p) => !p); changed(); }} disabled={blocked || top}>{t('plusMove')}</button>
      </div>
      {locked
        ? <button className="primary pad-save" disabled={nav.nextFree < 0} onClick={() => nav.onGo(nav.nextFree)}>{t('nextClimber')}</button>
        : (
          <div className="pad-actions">
            <button className="secondary" onClick={() => save()} disabled={blocked}>{t('save')}</button>
            <button className="primary" onClick={() => setAsk(true)} disabled={blocked}>{t('lockAndNext')}</button>
          </div>
        )}
      {edited ? <p className="pad-status" /> : <PadStatus outboxKey={key} show={saved} />}
      {ask && (
        <Sheet title={t('confirmLockTitle')} confirm={t('yesLock')} onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); save(true); }}>
          <p>{t('confirmLockText')}</p>
          <p className="sheet-result" dir="ltr">#{starter.bib ?? '–'} · {formatHeight({ hold, plus, top })}</p>
        </Sheet>
      )}
    </div>
  );
}
