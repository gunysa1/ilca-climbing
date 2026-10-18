import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { localized, useI18n } from '../../lib/i18n';
import { judgeRoundsKey, useOutbox } from '../../lib/judgeOutbox';
import { padIndex, type PadPosition } from '../../lib/judgePad';
import { formatClimbTime, isTimedRound } from '../../lib/climbTime';
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
  const { round, boulders, starters, results, leadResults, loading, offline, reload } = useRoundData(roundId, { offlineKey: profileId ? judgeRoundsKey(profileId) : undefined });
  const boulder = boulders.find((b) => b.id === boulderId);
  const claims = useBoulderClaims(boulder?.id);
  const { snap } = useOutbox();
  const lead = round?.scoring === 'lead';
  const table: ResultTable = lead ? 'lead_results' : 'boulder_results';
  // The current climber, by id (a start list reloaded while the round isn't live keeps them).
  const [position, setPosition] = useState<PadPosition | null>(null);
  const [showList, setShowList] = useState(false);
  const [toast, setToast] = useState('');
  const timed = isTimedRound(round, boulders.length);
  // Not live yet (opened the evening before, JudgeHome) or closed: read-only, as the server would refuse
  // the rows. Planned and the server can't be reached (the page came from the device copy, or the check
  // below failed: no signal at the venue): scoring goes on, the rows wait in the outbox (if the round is
  // still planned when they arrive, they are refused and listed as not saved).
  const [unreachable, setUnreachable] = useState(false);
  const status = round?.status;
  const fromDevice = !!offline || unreachable;
  const notLive = !!round && status !== 'live' && !(fromDevice && status === 'planned');
  // Times a read-only pad opened because the round went live (or was reopened): part of the pads' key
  // (below). Not when it opens on the copy without signal: something typed there must stay.
  const [openings, setOpenings] = useState(0);
  const wasNotLive = useRef(notLive);
  useEffect(() => {
    if (wasNotLive.current && !notLive && status === 'live') setOpenings((n) => n + 1);
    wasNotLive.current = notLive;
  }, [notLive, status]);
  useEffect(() => {
    if (!status || status === 'live' || !reload) return;
    // Not live: load the page again every 20 s (status, start list made meanwhile), so the pad opens by
    // itself when the admin sets the round live (or reopens it).
    const check = () => void reload().then((reachable) => setUnreachable(!reachable));
    const poll = setInterval(check, 20_000);
    window.addEventListener('online', check);
    return () => { clearInterval(poll); window.removeEventListener('online', check); };
  }, [status, reload]);
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
    if (position === null && starters.length) {
      const k = Math.max(0, nextFree(-1));
      setPosition({ id: starters[k].climber_id, at: k });
    }
  }, [position, starters, nextFree]);
  useEffect(() => { if (!toast) return; const h = setTimeout(() => setToast(''), 2500); return () => clearTimeout(h); }, [toast]);

  if (loading) return <p className="muted">{t('loading')}</p>;
  if (!boulder || !round) return <p className="notice">{t('noAccess')}</p>;
  const i = padIndex(starters.map((s) => s.climber_id), position) ?? 0;
  const current = starters[i];
  const done = starters.filter(locked).length;
  const go = (to: number) => { if (starters[to]) setPosition({ id: starters[to].climber_id, at: to }); setShowList(false); };
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
      {notLive && <p className="notice" role="status">{t(round.status === 'planned' ? 'roundNotLiveYet' : 'roundClosedJudge')}</p>}
      {fromDevice && round.status === 'planned' && <p className="notice" role="status">{t('roundNotLiveOffline')}</p>}
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
                    {l ? `${formatHeight(l)}${timed && l.time_ms ? ` · ${formatClimbTime(l.time_ms)}` : ''}` : r ? shorthand(r) : ''}
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
        // … and when the round opens (live, reopened): the pad starts again from the server's values (it was
        // read-only, so nothing typed is lost).
        const padKey = `${current.climber_id}:${failed?.id ?? ''}:${openings}`;
        return lead
          ? <LeadPad key={padKey} roundId={roundId!} routeId={boulder.id} starter={current} label={label(current)} baseRow={saved ?? null}
              initial={shown as unknown as LeadRow | undefined} locked={locked(current)} timed={timed} notLive={notLive}
              onLocked={() => afterLock(current.bib)} nextFree={nextFree(i)} onGo={go} />
          : <ScorePad key={padKey} roundId={roundId!} boulderId={boulder.id} starter={current} label={label(current)} baseRow={saved ?? null}
              initial={(shown as unknown as BoulderResult | undefined) ?? EMPTY_RESULT}
              locked={locked(current)} notLive={notLive} onLocked={() => afterLock(current.bib)} nextFree={nextFree(i)} onGo={go} />;
      })()}
      {toast && <div className="toast" role="status">{toast}</div>}
    </section>
  );
}

const shorthand = (r: BoulderResult) =>
  [r.top_attempt != null && `T${r.top_attempt}`, r.zone_attempt != null && `Z${r.zone_attempt}`, `· ${r.attempts}`].filter(Boolean).join(' ');
