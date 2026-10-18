import { useState } from 'react';
import { Sheet } from '../../components/Sheet';
import { useI18n } from '../../lib/i18n';
import { useOutbox } from '../../lib/judgeOutbox';
import { formatHeight } from '../../lib/lead';
import { type LeadRow, type Starter } from '../../lib/roundData';
import { outboxKey } from '../../lib/saveQueue';
import { PadStatus, unsentNow } from './OutboxNotices';
import { PadBlocked, PadHeader, type PadLabel, type PadNav, type Row } from './padParts';
import { useClaim, WallToggle } from './useClaim';

/** Lead: the judge records the final height (hold, + or TOP); saving keeps it editable, locking ends it. */
export function LeadPad({ roundId, routeId, starter, label, baseRow, initial, locked: initiallyLocked, ...nav }:
  { roundId: string; routeId: string; starter: Starter; label: PadLabel; baseRow: Row | null; initial: Pick<LeadRow, 'hold' | 'plus' | 'top'> | undefined; locked: boolean } & PadNav) {
  const { t } = useI18n();
  const { holder, mine, onWall, markWall } = useClaim(roundId, routeId, starter.climber_id, !initiallyLocked);
  const { queue } = useOutbox();
  const key = outboxKey('lead_results', routeId, starter.climber_id);
  const [hold, setHold] = useState(initial?.hold ?? 0);
  const [plus, setPlus] = useState(initial?.plus ?? false);
  const [top, setTop] = useState(initial?.top ?? false);
  // Edited since the last save: no status until saved; saved: what the outbox says.
  const [edited, setEdited] = useState(false);
  const [since, setSince] = useState(() => unsentNow(queue, key));
  const [startBase] = useState(baseRow);
  const [ask, setAsk] = useState(false);
  const [lockedNow, setLockedNow] = useState(false);
  const locked = initiallyLocked || lockedNow;
  const blocked = locked || !mine || !queue;
  const changed = () => setEdited(true);

  // Through the outbox, like the boulder pad; locking without signal moves on as well.
  function save(lock = false) {
    queue?.enqueue({ key, table: 'lead_results', lock, meta: label, baseRow: startBase,
      row: { boulder_id: routeId, climber_id: starter.climber_id, round_id: roundId, hold, plus: top ? false : plus, top } });
    setEdited(false);
    setSince((v) => v ?? Date.now());
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
      {edited ? <p className="pad-status" /> : <PadStatus outboxKey={key} since={since} />}
      {ask && (
        <Sheet title={t('confirmLockTitle')} confirm={t('yesLock')} onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); save(true); }}>
          <p>{t('confirmLockText')}</p>
          <p className="sheet-result" dir="ltr">#{starter.bib ?? '–'} · {formatHeight({ hold, plus, top })}</p>
        </Sheet>
      )}
    </div>
  );
}
