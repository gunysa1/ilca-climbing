import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { dwellMs, nextRoundId, screenRounds, SCREEN_SCROLL_PAUSE_MS, SCREEN_SCROLL_PX_PER_S } from '../lib/bigScreen';
import { localized, useI18n } from '../lib/i18n';
import { onWallByClimber, onWallList, useOnWall } from '../lib/onWall';
import { prefetchRound, resultKey, useRoundData, type CategoryRounds } from '../lib/roundData';
import { roundRows } from '../lib/roundRows';
import { supabase } from '../lib/supabase';
import { Cell, RouteChip } from './RoundResults';

/** Rounds list refresh. The results themselves come live (Realtime) and the wall every 5 s, as on the round page. */
const ROUNDS_POLL_MS = 30000;

/** Keep the screen awake while this page is open (re-requested when the tab comes back). */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let stop = false;
    const request = () => {
      const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
      if (!wl || document.visibilityState !== 'visible') return;
      wl.request('screen').then((l) => { if (stop) void l.release(); else lock = l; }, () => { /* refused: battery saver, etc. */ });
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => { stop = true; document.removeEventListener('visibilitychange', request); void lock?.release(); };
  }, []);
}

/** A button that shows when the pointer moves and hides itself a few seconds later. */
function FullscreenButton() {
  const { t } = useI18n();
  const [shown, setShown] = useState(true);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const wake = () => { setShown(true); clearTimeout(timer); timer = setTimeout(() => setShown(false), 4000); };
    wake();
    for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.addEventListener(ev, wake);
    return () => { clearTimeout(timer); for (const ev of ['pointermove', 'pointerdown', 'keydown']) window.removeEventListener(ev, wake); };
  }, []);
  if (!document.documentElement.requestFullscreen) return null;
  return (
    <button className={`screen-fs${shown ? '' : ' hidden'}`} tabIndex={shown ? 0 : -1}
      onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => {}); }}>
      ⛶ {t('screenFullscreen')}
    </button>
  );
}

/** Venue TV / projector: the competition's live rounds in turn, no navigation. */
export function Screen() {
  const { competitionId } = useParams();
  const { t, lang } = useI18n();
  const [name, setName] = useState<{ name: string; name_he: string | null } | null | undefined>(undefined);
  const [categories, setCategories] = useState<CategoryRounds[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const overflow = useRef(0); // how far the current list scrolls (reported by the list)
  const shownSince = useRef(Date.now());
  const setOverflow = useCallback((px: number) => { overflow.current = px; }, []);
  useWakeLock();

  useEffect(() => {
    if (!competitionId) return;
    let stop = false;
    void supabase.from('competitions').select('name, name_he').eq('id', competitionId).maybeSingle()
      .then(({ data }) => { if (!stop) setName((data as { name: string; name_he: string | null } | null) ?? null); }, () => {});
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      void supabase.from('categories').select('id, name, name_he, rounds(id, kind, status)').eq('competition_id', competitionId).order('name')
        .then(({ data, error }) => { if (!stop && !error) setCategories((data as CategoryRounds[]) ?? []); }, () => {});
    };
    load();
    const timer = setInterval(load, ROUNDS_POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, [competitionId]);

  const rounds = useMemo(() => screenRounds(categories ?? []), [categories]);
  const roundsKey = rounds.map((r) => r.round_id).join(',');
  const current = rounds.find((r) => r.round_id === currentId) ?? rounds[0] ?? null;

  // Stay on a round for its dwell time (longer when its list scrolls), then the next one. The deadline is
  // checked each second against when the round came up, so a longer list (a changing on-wall banner, a
  // late starter) extends it instead of restarting it.
  const roundsRef = useRef(rounds);
  roundsRef.current = rounds;
  useEffect(() => {
    shownSince.current = Date.now();
    overflow.current = 0;
    if (!current) return;
    const upNext = nextRoundId(roundsRef.current, current.round_id);
    if (upNext && upNext !== current.round_id) prefetchRound(upNext); // loaded while this one is shown
    const timer = setInterval(() => {
      if (roundsRef.current.length < 2 || Date.now() - shownSince.current < dwellMs(overflow.current)) return;
      setCurrentId(nextRoundId(roundsRef.current, current.round_id));
    }, 1000);
    return () => clearInterval(timer);
  }, [current?.round_id, roundsKey]);

  const live = rounds.some((r) => r.live);
  return (
    <div className="screen">
      <header className="screen-head">
        <h1>{name ? localized(lang, name.name, name.name_he) : ''}</h1>
        {current && (
          <p className="screen-round">
            {live && <span className="live-dot" aria-hidden />}
            {localized(lang, current.category, current.category_he)} · {t(current.kind)}
            {rounds.length > 1 && <span className="screen-count">{rounds.findIndex((r) => r.round_id === current.round_id) + 1}/{rounds.length}</span>}
          </p>
        )}
      </header>
      {current && !live && categories !== null && <p className="screen-note">{t('screenNoLive')}</p>}
      {current ? <ScreenRound key={current.round_id} roundId={current.round_id} live={current.live} onOverflow={setOverflow} />
        : <p className="screen-note big">{name === null ? t('screenNotFound') : categories === null ? t('loading') : t('screenNothing')}</p>}
      <footer className="screen-foot"><span>{t('screenLiveAt')} <bdi dir="ltr">{location.host}</bdi></span></footer>
      <FullscreenButton />
    </div>
  );
}

function ScreenRound({ roundId, live, onOverflow }: { roundId: string; live: boolean; onOverflow: (px: number) => void }) {
  const { t, lang } = useI18n();
  const { round, boulders, starters, results, leadResults, totals, loading } = useRoundData(roundId, { reuseMs: 20000 });
  const wallRows = useOnWall(roundId, live && round?.status === 'live');
  const wall = useMemo(() => onWallList(wallRows, boulders), [wallRows, boulders]);
  const wallBy = useMemo(() => onWallByClimber(wall), [wall]);
  const byId = useMemo(() => new Map(starters.map((s) => [s.climber_id, s])), [starters]);

  // Qualification groups are ranked separately: one block per group.
  const blocks = useMemo(() => {
    if (!round) return [];
    const groups = [...new Set(starters.map((s) => s.group_label).filter((g): g is string => !!g))].sort();
    return (groups.length ? groups : [null]).map((g) => ({
      group: g,
      rows: roundRows(round, starters.filter((s) => g === null || s.group_label === g), boulders, results, leadResults, totals),
    }));
  }, [round, starters, boulders, results, leadResults, totals]);

  // Long lists scroll by themselves: wait at the top, scroll, wait at the bottom, back to the top.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let phase: 'top' | 'scroll' | 'bottom' = 'top';
    let since = performance.now();
    let last = since;
    let reported = 0;
    let pos = 0; // fractional: scrollTop alone snaps to whole pixels, which loses slow steps
    const tick = (now: number) => {
      const el = box.current;
      if (el) {
        const max = el.scrollHeight - el.clientHeight;
        const rounded = max > 4 ? Math.round(max / 50) * 50 : 0;
        if (rounded !== reported) { reported = rounded; onOverflow(rounded); }
        if (max <= 4) { el.scrollTop = 0; pos = 0; phase = 'top'; since = now; }
        else if (phase === 'top' && now - since >= SCREEN_SCROLL_PAUSE_MS) { phase = 'scroll'; }
        else if (phase === 'scroll') {
          pos = Math.min(max, pos + (Math.min(now - last, 100) / 1000) * SCREEN_SCROLL_PX_PER_S);
          el.scrollTop = pos;
          if (pos >= max - 1) { phase = 'bottom'; since = now; }
        } else if (phase === 'bottom' && now - since >= SCREEN_SCROLL_PAUSE_MS) { el.scrollTop = 0; pos = 0; phase = 'top'; since = now; }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onOverflow]);

  if (loading) return <p className="screen-note big">{t('loading')}</p>;
  if (!round) return <p className="screen-note big">{t('screenNothing')}</p>;
  const isLead = round.scoring === 'lead';
  return (
    <>
      {wall.length > 0 && (
        <div className="screen-wall" aria-live="polite">
          <span className="on-wall-title"><span className="live-dot" aria-hidden />{t('onWallNow')}</span>
          {wall.map((w) => {
            const s = byId.get(w.climber_id);
            return s && <span key={w.boulder_id} className="on-wall-item"><span className="on-wall-num">{w.number}</span>{localized(lang, s.profile.full_name, s.profile.full_name_he)}</span>;
          })}
        </div>
      )}
      <div className="screen-list" ref={box}>
        <table className="results">
          <tbody>
            {blocks.map((b) => [
              b.group !== null && <tr key={`g${b.group}`} className="screen-group"><td colSpan={4}>{t('group')} {b.group}</td></tr>,
              ...b.rows.map((row) => {
                const s = byId.get(row.climber_id);
                if (!s) return null;
                const climbing = wallBy.get(row.climber_id);
                return (
                  <tr key={`${b.group}-${row.climber_id}`} className={climbing ? 'on-wall-row' : undefined}>
                    <td className="rank">{row.rank ?? '–'}</td>
                    <td className="name">
                      <span className="athlete">{localized(lang, s.profile.full_name, s.profile.full_name_he)}</span>
                      <span className="athlete-meta">{[s.age_class, s.profile.club].filter(Boolean).join(' • ')}</span>
                    </td>
                    <td className="asc-col">
                      <span className="ascents">
                        {boulders.map((bo) => isLead
                          ? <RouteChip key={bo.id} number={bo.number} r={leadResults.get(resultKey(bo.id, row.climber_id))} climbing={!!climbing?.includes(bo.id)} />
                          : <Cell key={bo.id} number={bo.number} r={results.get(resultKey(bo.id, row.climber_id))} climbing={!!climbing?.includes(bo.id)} />)}
                      </span>
                    </td>
                    <td className="score">{row.score}</td>
                  </tr>
                );
              }),
            ])}
          </tbody>
        </table>
      </div>
    </>
  );
}
