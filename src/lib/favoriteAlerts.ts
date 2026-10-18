// Alerts for followed (star) climbers while the app is open: what to tell, from what the viewer
// already reads (home_page's live part for the wall, favorites_page's history for results). Pure; the
// polling and the browser notification live in useFavoriteAlerts.ts. Nothing is sent to the server.
import type { HomeLiveRound } from './home';
import type { HistoryRow } from './types';

export type AlertKind = 'wall' | 'result' | 'advance' | 'podium';
export const ALERT_KINDS: AlertKind[] = ['wall', 'result', 'advance', 'podium'];

export interface AlertSettings {
  enabled: boolean;
  /** Which events to tell about. */
  kinds: Record<AlertKind, boolean>;
}
export const DEFAULT_SETTINGS: AlertSettings = { enabled: false, kinds: { wall: true, result: true, advance: true, podium: true } };

/** What was already told (kept on the device). `wall`: on the wall at the last look. `seen`: result
 * fingerprints and told advance / podium keys. `known`: climbers whose history was read once (the first
 * read is the baseline: old results never alert). */
export interface AlertState {
  wallKnown: boolean;
  wall: string[];
  seen: Record<string, string>;
  known: string[];
}
export const EMPTY_STATE: AlertState = { wallKnown: false, wall: [], seen: {}, known: [] };

export interface Alert {
  /** Unique per event: used as the notification tag, so the same event never shows twice. */
  key: string;
  kind: AlertKind;
  climber_id: string;
  round_id: string;
  name: string;
  name_he: string | null;
  competition: string;
  competition_he: string | null;
  round_kind: HistoryRow['round'];
  /** Boulder number (wall alerts on boulder rounds). */
  boulder?: number;
  rank?: number;
  of?: number;
}

export interface AlertInput {
  favorites: string[];
  /** Names of favorites (from favorites_page); the wall carries its own. */
  names: Map<string, { full_name: string; full_name_he: string | null }>;
  /** home_page's live part; null when not fetched this time. */
  live: HomeLiveRound[] | null;
  /** favorites_page's history; null when not fetched this time. */
  history: HistoryRow[] | null;
}

export function parseSettings(raw: string | null): AlertSettings {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<AlertSettings> | null;
    if (!v || typeof v !== 'object') return DEFAULT_SETTINGS;
    return { enabled: v.enabled === true, kinds: Object.fromEntries(ALERT_KINDS.map((k) => [k, v.kinds?.[k] !== false])) as Record<AlertKind, boolean> };
  } catch { return DEFAULT_SETTINGS; }
}

export function parseState(raw: string | null): AlertState {
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<AlertState> | null;
    if (!v || typeof v !== 'object') return EMPTY_STATE;
    return {
      wallKnown: v.wallKnown === true,
      wall: Array.isArray(v.wall) ? v.wall.filter((x): x is string => typeof x === 'string') : [],
      seen: v.seen && typeof v.seen === 'object' && !Array.isArray(v.seen) ? v.seen : {},
      known: Array.isArray(v.known) ? v.known.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch { return EMPTY_STATE; }
}

/** Keep the stored state small: forget result fingerprints of rounds that are over long ago is not
 * possible without dates, so cap by count (oldest first; insertion order is kept). */
const MAX_SEEN = 1500;
export function trimState(s: AlertState): AlertState {
  const keys = Object.keys(s.seen);
  if (keys.length <= MAX_SEEN) return s;
  return { ...s, seen: Object.fromEntries(keys.slice(keys.length - MAX_SEEN).map((k) => [k, s.seen[k]])) };
}

/** What is new since `state`, and the state after looking. `settings.kinds` only filters what is
 * returned: the state always advances, so turning an event on later does not flood. */
export function diffAlerts(state: AlertState, input: AlertInput, settings: AlertSettings): { alerts: Alert[]; state: AlertState } {
  const fav = new Set(input.favorites);
  const alerts: Alert[] = [];
  let next: AlertState = { ...state, seen: { ...state.seen } };

  if (input.live) {
    const nowOnWall = new Map<string, Alert>();
    for (const r of input.live) {
      for (const w of r.on_wall) {
        if (!fav.has(w.climber_id)) continue;
        const key = `wall:${r.round_id}:${w.climber_id}:${w.boulder_id}`;
        nowOnWall.set(key, {
          key, kind: 'wall', climber_id: w.climber_id, round_id: r.round_id, name: w.full_name, name_he: w.full_name_he,
          competition: r.competition.name, competition_he: r.competition.name_he, round_kind: r.kind, boulder: r.scoring === 'lead' ? undefined : w.number,
        });
      }
    }
    // a new arrival on the wall (also again after having left it); the first look is the baseline
    if (state.wallKnown) for (const [key, a] of nowOnWall) if (!state.wall.includes(key)) alerts.push(a);
    next = { ...next, wallKnown: true, wall: [...nowOnWall.keys()] };
  }

  if (input.history) {
    const baselined = new Set(state.known);
    const nameOf = (id: string) => input.names.get(id) ?? { full_name: '', full_name_he: null };
    for (const h of input.history) {
      if (!fav.has(h.climber_id)) continue;
      const told = baselined.has(h.climber_id);
      const base = {
        climber_id: h.climber_id, round_id: h.round_id, name: nameOf(h.climber_id).full_name, name_he: nameOf(h.climber_id).full_name_he,
        competition: h.competition, competition_he: h.competition_he, round_kind: h.round,
      };
      // a new result in a live round: boulder rounds when the climber's own totals changed, lead when the place did
      if (h.round_status === 'live' && h.rank != null) {
        const key = `result:${h.round_id}:${h.climber_id}`;
        const sig = h.discipline === 'lead' ? `${h.rank}` : [h.tops, h.zones, h.top_attempts, h.zone_attempts, h.points].join('|');
        if (next.seen[key] !== sig) {
          if (told) alerts.push({ ...base, key: `${key}:${sig}`, kind: 'result', rank: h.rank, of: h.starters });
          next.seen[key] = sig;
        }
      }
      // on the start list of a round after the qualification
      if (h.round !== 'qualification') {
        const key = `advance:${h.round_id}:${h.climber_id}`;
        if (next.seen[key] === undefined) {
          if (told) alerts.push({ ...base, key, kind: 'advance' });
          next.seen[key] = '1';
        }
      }
      // on the podium of a finished final
      if (h.round === 'final' && h.round_status === 'closed' && h.rank != null && h.rank <= 3) {
        const key = `podium:${h.round_id}:${h.climber_id}`;
        if (next.seen[key] === undefined) {
          if (told) alerts.push({ ...base, key, kind: 'podium', rank: h.rank, of: h.starters });
          next.seen[key] = '1';
        }
      }
    }
    next = { ...next, known: [...new Set([...state.known, ...input.favorites])] };
  }

  return { alerts: alerts.filter((a) => settings.kinds[a.kind]), state: trimState(next) };
}
