import { useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { useOutbox } from '../../lib/judgeOutbox';
import { ackedSince, keyState, type FailedEntry, type OutboxSnapshot } from '../../lib/saveQueue';

export const pendingEntry = (snap: OutboxSnapshot, key: string) => snap.pending.find((e) => e.key === key);

/** Header badge while results wait on this device to be sent (any staff screen: they keep sending). */
export function OutboxBadge() {
  const { t } = useI18n();
  const { snap } = useOutbox();
  if (!snap.pending.length) return null;
  return <span className="outbox-badge" role="status" title={t('pendingBadgeHint')}>⏳ {snap.pending.length} {t('pendingCount')}</span>;
}

/** Why the server refused a row, for the judge. */
export function useFailureText() {
  const { t } = useI18n();
  return (f: FailedEntry) => (f.code === 'held' ? `${t('claimedBy')} ${f.error}` : f.code === 'changed' ? t('changedOnServer') : f.error);
}

let storageWarningSeen = false;

/** On the judge screens: sign in again (rows paused), storage can't keep unsent rows (once), and the
 *  results the server refused (held by another judge, changed meanwhile, locked by an admin …):
 *  never retried; the judge tells an admin, who fixes them on the round page, and dismisses it. */
export function OutboxNotices() {
  const { t } = useI18n();
  const { queue, snap } = useOutbox();
  const why = useFailureText();
  const [, setSeen] = useState(storageWarningSeen);
  if (!queue) return null;
  return (
    <>
      {snap.needsSignIn && <p className="notice outbox-failed" role="alert">{snap.pending.length} {t('pendingCount')} · {t('signInAgain')}</p>}
      {snap.storageFailed && !storageWarningSeen && (
        <div className="notice outbox-failed" role="alert">
          {t('storageWarning')}{' '}
          <button className="secondary" onClick={() => { storageWarningSeen = true; setSeen(true); }}>{t('dismiss')}</button>
        </div>
      )}
      {snap.failed.length > 0 && (
        <div className="notice outbox-failed" role="alert">
          <strong>{snap.failed.length} {t('failedResults')}</strong>
          <ul>
            {snap.failed.map((f) => (
              <li key={f.key}>
                {f.meta ? `${f.meta.climber} · ${t(f.table === 'lead_results' ? 'route' : 'boulder')} ${f.meta.boulder}` : f.key}
                <span className="muted small"> · {why(f)}</span>
              </li>
            ))}
          </ul>
          <button className="secondary" onClick={() => queue.dismiss()}>{t('dismiss')}</button>
        </div>
      )}
    </>
  );
}

/** Under the pad: waiting to send (with the count across all climbers) / refused / saved — "saved"
 *  only once the server confirmed a save made since `since` (and after any failure the judge saw). */
export function PadStatus({ outboxKey: key, since }: { outboxKey: string; since: number | null }) {
  const { t } = useI18n();
  const { snap } = useOutbox();
  const why = useFailureText();
  const failedSeen = useRef(0);
  const state = keyState(snap, key);
  const failed = snap.failed.find((f) => f.key === key);
  if (failed) failedSeen.current = Date.now();
  const text = state === 'pending' ? `⏳ ${t('pendingSend')}${snap.pending.length > 1 ? ` (${snap.pending.length})` : ''}`
    : failed ? `${t('notSaved')} · ${why(failed)}`
    : since !== null && ackedSince(snap, key, Math.max(since, failedSeen.current)) ? t('saved') : '';
  return <p className={`pad-status ${failed ? 'error' : text ? state : ''}`} aria-live="polite">{text}</p>;
}

/** When the pad's status starts to count: now if it opens on unsent work (reload, back), else at the first save. */
export const unsentNow = (queue: { snapshot: () => OutboxSnapshot } | null, key: string) =>
  queue && keyState(queue.snapshot(), key) === 'pending' ? Date.now() : null;
