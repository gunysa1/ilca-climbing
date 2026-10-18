// The public home page's data (home_page(), one request) and the small pure steps that shape it.
import { climberEvents, type ClimberEvent } from './climberStats';
import type { RankingRow } from './rankings';
import type { HistoryRow, Profile, Round } from './types';

export interface HomeOnWall { boulder_id: string; number: number; climber_id: string; full_name: string; full_name_he: string | null }
export interface HomeLiveRound {
  round_id: string;
  kind: Round['kind'];
  scoring: Round['scoring'];
  category: { id: string; name: string; name_he: string | null; gender: string };
  competition: { id: string; name: string; name_he: string | null };
  on_wall: HomeOnWall[];
}
export interface HomeCompetition { id: string; name: string; name_he: string | null; venue: string | null; starts_on: string; ends_on: string }
/** An upcoming competition; `today`: it is on today (started, last day not passed; Israel's date, migration 043). */
export type HomeUpcoming = HomeCompetition & { today?: boolean };
export interface HomeWinner {
  category_id: string; category: string; category_he: string | null; gender: string;
  round_id: string; round_kind: Round['kind'];
  climber_id: string; full_name: string; full_name_he: string | null; club: string | null;
}
export interface HomeData {
  live: HomeLiveRound[];
  upcoming: HomeUpcoming[];
  latest: (HomeCompetition & { winners: HomeWinner[] })[];
}

/** home_page() json -> HomeData (missing parts are empty). */
export function parseHome(raw: unknown): HomeData {
  const d = (raw ?? {}) as Partial<HomeData>;
  return withLive({
    live: [],
    upcoming: d.upcoming ?? [],
    latest: (d.latest ?? []).map((c) => ({ ...c, winners: c.winners ?? [] })),
  }, parseLive(raw));
}

/** The live part of home_page() / home_page(true). */
export function parseLive(raw: unknown): HomeLiveRound[] {
  return (((raw ?? {}) as Partial<HomeData>).live ?? []).map((r) => ({ ...r, on_wall: r.on_wall ?? [] }));
}

/** How often the home page asks for the live part (home_page(true)): often while something is live
 * (who is on the wall, as on the round page), rarely otherwise (a round that goes live later appears). */
export const HOME_LIVE_POLL_MS = 5000;
export const HOME_IDLE_POLL_MS = 60000;
/** After failed requests the wait is 5 s, doubling to the idle 60 s (failures = how many in a row). */
export const homeRetryMs = (failures: number) => Math.min(HOME_LIVE_POLL_MS * 2 ** Math.max(failures - 1, 0), HOME_IDLE_POLL_MS);
export const homePollDue = (now: number, last: number, anyLive: boolean, failures = 0) =>
  now - last >= (failures > 0 ? homeRetryMs(failures) : anyLive ? HOME_LIVE_POLL_MS : HOME_IDLE_POLL_MS) - 250; // timer jitter

/** True when a competition that was live is not any more: it belongs in another list (results or
 * upcoming), which only the whole page (home_page()) knows. */
export const liveCompetitionEnded = (before: HomeLiveRound[], after: HomeLiveRound[]) => {
  const now = new Set(after.map((r) => r.competition.id));
  return before.some((r) => !now.has(r.competition.id));
};

/** The page with a fresh live part (home_page(true)); a competition that is live now isn't "upcoming". */
export function withLive(home: HomeData, live: HomeLiveRound[]): HomeData {
  const liveComps = new Set(live.map((r) => r.competition.id));
  return { ...home, live, upcoming: home.upcoming.filter((c) => !liveComps.has(c.id)) };
}

/** Winners grouped by category (a tie gives one category several winners), in the order given. */
export function winnersByCategory(winners: HomeWinner[]): { category_id: string; category: string; category_he: string | null; round_id: string; climbers: HomeWinner[] }[] {
  const out = new Map<string, { category_id: string; category: string; category_he: string | null; round_id: string; climbers: HomeWinner[] }>();
  for (const w of winners) {
    if (!out.has(w.category_id)) out.set(w.category_id, { category_id: w.category_id, category: w.category, category_he: w.category_he, round_id: w.round_id, climbers: [] });
    out.get(w.category_id)!.climbers.push(w);
  }
  return [...out.values()];
}

/** The top of a ranking table: places 1 to n (ties at n are all kept). */
export function topOfRanking<T extends RankingRow>(rows: T[], n = 3): T[] {
  return rows.filter((r) => r.rank <= n);
}

/** Each starred climber (in starring order) with their latest result, as on the favorites page. */
export function favoritesLatest(ids: string[], profiles: Profile[], history: HistoryRow[]): { profile: Profile; latest: ClimberEvent | null }[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const shown = history.filter((h) => h.round_status !== 'planned');
  return ids.filter((id) => byId.has(id)).map((id) => ({
    profile: byId.get(id)!,
    latest: climberEvents(shown.filter((h) => h.climber_id === id))[0] ?? null,
  }));
}
