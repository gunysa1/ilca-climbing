import { useMemo, useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../lib/i18n';
import { useOutbox } from '../../lib/judgeOutbox';
import { type Starter } from '../../lib/roundData';
import { outboxKey } from '../../lib/saveQueue';
import { applyAction, boulderPoints, type BoulderResult, type JudgeAction } from '../../lib/scoring';
import { PadStatus, unsentNow } from './OutboxNotices';
import { PadBlocked, PadHeader, type PadLabel, type PadNav, type Row } from './padParts';
import { useClaim, WallToggle } from './useClaim';

export function ScorePad({ roundId, boulderId, starter, label, baseRow, initial, locked: initiallyLocked, notLive = false, ...nav }:
  { roundId: string; boulderId: string; starter: Starter; label: PadLabel; baseRow: Row | null; initial: BoulderResult; locked: boolean; notLive?: boolean } & PadNav) {
  const { t } = useI18n();
  const { holder, mine, onWall, markWall } = useClaim(roundId, boulderId, starter.climber_id, !initiallyLocked && !notLive);
  const { queue } = useOutbox();
  const key = outboxKey('boulder_results', boulderId, starter.climber_id);
  const [since, setSince] = useState(() => unsentNow(queue, key));
  // The row this pad started from (frozen: a change arriving meanwhile is a conflict, not a new base).
  const [startBase] = useState(baseRow);
  const [history, setHistory] = useState<BoulderResult[]>([]);
  const [state, setState] = useState<BoulderResult>({
    attempts: initial.attempts, zone_attempt: initial.zone_attempt, top_attempt: initial.top_attempt,
  });
  const [ask, setAsk] = useState<null | 'zone' | 'top' | 'lock'>(null);
  const [lockedNow, setLockedNow] = useState(false); // before the live update arrives
  const locked = initiallyLocked || lockedNow;
  const blocked = locked || notLive || !mine || !queue;
  const topped = state.top_attempt != null;
  const climbed = state.attempts > 0 || state.zone_attempt != null || state.top_attempt != null;
  const points = useMemo(() => boulderPoints(state), [state]);

  // Through the outbox: kept on the phone until the server has it (no revert without signal).
  function save(next: BoulderResult, lock = false) {
    queue?.enqueue({ key, table: 'boulder_results', lock, meta: label, baseRow: startBase, row: { boulder_id: boulderId, climber_id: starter.climber_id,
      round_id: roundId, attempts: next.attempts, zone_attempt: next.zone_attempt, top_attempt: next.top_attempt } });
    setSince((v) => v ?? Date.now());
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
      <PadStatus outboxKey={key} since={since} />

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
