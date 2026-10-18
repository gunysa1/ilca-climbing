import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { localized, useI18n } from '../../lib/i18n';
import { judgeRoundsKey, useOutbox } from '../../lib/judgeOutbox';
import { formatHeight } from '../../lib/lead';
import { resultKey, useRoundData, type LeadRow, type Starter } from '../../lib/roundData';
import { latestRow, outboxKey, type ResultTable } from '../../lib/saveQueue';
import { EMPTY_RESULT, type BoulderResult } from '../../lib/scoring';
import { LeadPad } from './LeadPad';
import { OutboxNotices, pendingEntry } from './OutboxNotices';
import { type Row } from './padParts';
import { ScorePad } from './ScorePad';
import { useBoulderClaims } from './useClaim';

/**
 * Judge pad for one boulder or route, like a judge works at the wall: one climber at a time in start
 * order, with progress, back / next and the full list one tap away. Locking a result ("next · lock")
 * moves to the next climber still to judge; a climber another judge holds can be skipped.
 */
export function JudgeBoulder() {
  const { roundId, boulderId } = useParams();
  const { t, lang } = useI18n();
  const { profileId } = useAuth();
  const { round, boulders, starters, results, leadResults, loading } = useRoundData(roundId, { offlineKey: profileId ? judgeRoundsKey(profileId) : undefined });
  const boulder = boulders.find((b) => b.id === boulderId);
  const claims = useBoulderClaims(boulder?.id);
  const { snap } = useOutbox();
  const lead = round?.scoring === 'lead';
  const table: ResultTable = lead ? 'lead_results' : 'boulder_results';
  const [index, setIndex] = useState<number | null>(null);
  const [showList, setShowList] = useState(false);
  const [toast, setToast] = useState('');
  // What the pad shows for a climber: the judge's unsent row, else the newest of the server's row, the
  // last one the server returned to this judge (acked: newer than a page kept for offline use) and the
  // one a refused row found on the server ("changed": the admin's values).
  const rowsOf = useCallback((s: Starter) => {
    if (!boulder) return { pending: undefined, saved: undefined, failed: undefined };
    const key = outboxKey(table, boulder.id, s.climber_id);
    const server = (lead ? leadResults : results).get(resultKey(boulder.id, s.climber_id)) as Row | undefined;
    const failed = snap.failed.find((f) => f.key === key);
    return { pending: pendingEntry(snap, key), saved: latestRow(latestRow(snap.acked[key]?.row, failed?.server), server), failed };
  }, [boulder, snap, table, lead, results, leadResults]);
  // Locked on the server (or in its answer to this judge), or locked here and still waiting to be sent.
  const locked = useCallback((s: Starter) => { const r = rowsOf(s); return !!(r.pending?.lock || r.saved?.locked); }, [rowsOf]);
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
      <OutboxNotices />
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
            const { pending, saved } = rowsOf(s);
            const waiting = pending?.row;
            const shown = waiting ?? saved;
            const r = !lead ? shown as unknown as BoulderResult | undefined : undefined;
            const l = lead ? shown as unknown as LeadRow | undefined : undefined;
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
      {current && (() => {
        const { pending, saved, failed } = rowsOf(current);
        // The pad builds on `saved`: a row that waits is checked against it before it's sent.
        const shown = pending?.row ?? saved;
        // A refused row (or dismissing it) reopens the pad on the server's values.
        const padKey = `${current.climber_id}:${failed?.id ?? ''}`;
        return lead
          ? <LeadPad key={padKey} roundId={roundId!} routeId={boulder.id} starter={current} label={label(current)} baseRow={saved ?? null}
              initial={shown as unknown as LeadRow | undefined} locked={locked(current)}
              onLocked={() => afterLock(current.bib)} nextFree={nextFree(i)} onGo={go} />
          : <ScorePad key={padKey} roundId={roundId!} boulderId={boulder.id} starter={current} label={label(current)} baseRow={saved ?? null}
              initial={(shown as unknown as BoulderResult | undefined) ?? EMPTY_RESULT}
              locked={locked(current)} onLocked={() => afterLock(current.bib)} nextFree={nextFree(i)} onGo={go} />;
      })()}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

const shorthand = (r: BoulderResult) =>
  [r.top_attempt != null && `T${r.top_attempt}`, r.zone_attempt != null && `Z${r.zone_attempt}`, `· ${r.attempts}`].filter(Boolean).join(' ');
