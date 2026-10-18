// When the alerts ask the server (at most one request per tick, a tick every 30 s, one tab per device).
export const ALERT_TICK_MS = 30000;
/** A page hidden longer than this stops asking (nobody is looking); it resumes when shown again. */
export const ALERT_HIDDEN_MAX_MS = 10 * 60000;
/** How often the competition days are looked up (one small request). */
export const ALERT_DAYS_MS = 60 * 60000;
const SLACK = 1000; // timer jitter

export interface PollContext {
  now: number;
  /** When each part was last fetched (0: never). */
  lastWall: number;
  lastHist: number;
  lastDays: number;
  /** A round is live right now (as of the last live fetch). */
  anyLive: boolean;
  /** Today is a day of some published competition (as of the last days fetch). */
  competitionDay: boolean;
  /** A live round just ended: its closing results / next start lists are still to be read once. */
  finishedPending: boolean;
  /** The hourly days lookup found no competition today: read the live part once, in case a round is live anyway. */
  wallProbe: boolean;
  /** Some starred climber was never read (just enabled, or newly starred): one read as baseline. */
  needBaseline: boolean;
  /** The history events (result, advance, podium) are on. */
  wantHistory: boolean;
  /** The last history read had rows (a starred climber is in a live / recent competition). */
  histActive: boolean;
  /** Since when the page is hidden (null: visible). */
  hiddenSince: number | null;
}

/** Which request to make now, if any. Outside competition days with nothing live: nothing (only the
 * days lookup, once an hour). On a competition day: the live part every 2 minutes, to notice a round
 * that starts. While live: the live part every 30 s; the starred climbers' rounds (favorites_live)
 * every 2 minutes, and only while the last read found a starred climber in a live / recent competition. */
export function planFetch(c: PollContext): 'days' | 'wall' | 'history' | null {
  if (c.hiddenSince !== null && c.now - c.hiddenSince > ALERT_HIDDEN_MAX_MS) return null;
  if (c.lastDays === 0 || c.now - c.lastDays >= ALERT_DAYS_MS - SLACK) return 'days';
  if (c.wallProbe) return 'wall';
  const active = c.anyLive || c.competitionDay;
  if (!active && !c.finishedPending) return null;
  const urgent = c.needBaseline || c.finishedPending;
  const histDue = c.wantHistory && (urgent || (active && c.histActive))
    && c.now - c.lastHist >= (urgent ? ALERT_TICK_MS : 120000) - SLACK;
  if (histDue) return 'history'; // the rarer read goes first, or the live part would always win
  const wallDue = c.now - c.lastWall >= (c.anyLive ? 30000 : 120000) - SLACK;
  return wallDue ? 'wall' : null;
}

/** The leader stamp kept in localStorage where Web Locks are missing: who polled last, when, and
 * whether that tab was hidden. */
export interface LeaderStamp { id: string; t: number; h: boolean }

/** May this tab poll? Another tab's fresh stamp wins, except that a visible tab takes over from a hidden one. */
export function mayLead(stamp: LeaderStamp | null, me: string, now: number, hidden: boolean): boolean {
  if (!stamp || stamp.id === me || now - stamp.t >= ALERT_TICK_MS * 1.5) return true;
  return stamp.h && !hidden;
}
