// When the alerts ask the server (at most one request per tick, a tick every 30 s).
export const ALERT_TICK_MS = 30000;
/** A page hidden longer than this stops asking (nobody is looking); it resumes when shown again. */
export const ALERT_HIDDEN_MAX_MS = 10 * 60000;
const SLACK = 1000; // timer jitter

export interface PollContext {
  now: number;
  /** When the live part / the history was last fetched (0: never). */
  lastWall: number;
  lastHist: number;
  /** A round is live right now (as of the last live fetch). */
  anyLive: boolean;
  /** A live round just ended: its closing results / next start lists are still to be read once. */
  finishedPending: boolean;
  /** Some starred climber was never read (just enabled, or newly starred): one read as baseline. */
  needBaseline: boolean;
  /** The history events (result, advance, podium) are on. */
  wantHistory: boolean;
  /** Since when the page is hidden (null: visible). */
  hiddenSince: number | null;
}

/** Which request to make now, if any. Idle (nothing live): the live part every 2 minutes, to notice a
 * round that starts. Live: the live part and the history take turns, each once a minute (the live part
 * every 30 s when no history event is on). */
export function planFetch(c: PollContext): 'wall' | 'history' | null {
  if (c.hiddenSince !== null && c.now - c.hiddenSince > ALERT_HIDDEN_MAX_MS) return null;
  const wallEvery = c.anyLive ? (c.wantHistory ? 60000 : 30000) : 120000;
  const wallDue = c.now - c.lastWall >= wallEvery - SLACK;
  const histDue = c.wantHistory && (c.needBaseline || c.finishedPending || c.anyLive) && c.now - c.lastHist >= 60000 - SLACK;
  if (wallDue && histDue) return c.lastWall <= c.lastHist ? 'wall' : 'history';
  return wallDue ? 'wall' : histDue ? 'history' : null;
}
