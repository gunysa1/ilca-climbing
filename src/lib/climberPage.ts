// The public climber page's data: climber_page(climber), one request. Opened directly (a shared link, a
// reload), the request starts as soon as the app's script runs, alongside the page's lazily loaded chunk,
// instead of after the chunk has loaded and rendered (prefetchClimberRoute, called by the viewer's router).
import { FIRST_SEASON } from './criteria';
import { supabase } from './supabase';
import type { HistoryEntry, Profile } from './types';

export interface ClimberPage {
  profile: Profile | null;
  /** Rounds the climber started, planned rounds left out. */
  history: HistoryEntry[];
  /** Competition id -> counts for the national rankings (a series other than 'other' in a ranked season). */
  ranked: Map<string, boolean>;
}

interface RawClimberPage {
  profile: Profile | null;
  history: HistoryEntry[];
  competitions: { id: string; season: string | null; series: string | null }[];
}

/** The climber id of a /climber/:id path, or null. */
export function climberIdFromPath(path: string): string | null {
  return /^\/climber\/([^/]+)\/?$/.exec(path)?.[1] ?? null;
}

export function toClimberPage(d: RawClimberPage | null): ClimberPage {
  return {
    profile: d?.profile ?? null,
    history: (d?.history ?? []).filter((r) => r.round_status !== 'planned'),
    ranked: new Map((d?.competitions ?? []).map((c) => [c.id, c.series !== 'other' && c.season != null && c.season >= FIRST_SEASON] as const)),
  };
}

/**
 * A request started ahead of the page that needs it. The first get() for the same key within maxAge ms
 * takes it; any other get() loads afresh (a later visit must not show minutes-old results).
 */
export function oneShotPrefetch<T>(load: (key: string) => Promise<T>, maxAge: number, now: () => number = Date.now) {
  let ahead: { key: string; at: number; value: Promise<T> } | null = null;
  return {
    prefetch(key: string) { ahead = { key, at: now(), value: load(key) }; },
    get(key: string): Promise<T> {
      const a = ahead;
      ahead = null;
      return a && a.key === key && now() - a.at <= maxAge ? a.value : load(key);
    },
  };
}

const pages = oneShotPrefetch(async (id) => {
  const { data } = await supabase.rpc('climber_page', { p_climber: id });
  return toClimberPage(data as RawClimberPage | null);
}, 10_000);

/** The climber page's data (the prefetched request when there is one). */
export const loadClimberPage = (id: string) => pages.get(id);

/**
 * Called once by the router when the app starts. Opened on a climber page: start its chunk and its data
 * now, side by side. Otherwise fetch the (small) chunk after the page has loaded, so a tap on a climber
 * waits for the data only.
 */
export function prefetchClimberRoute(path: string, loadChunk: () => Promise<unknown>) {
  const id = climberIdFromPath(path);
  if (id) {
    void loadChunk().catch(() => {});  // (a failed load is retried when the page renders)
    pages.prefetch(id);
  } else {
    window.addEventListener('load', () => setTimeout(() => void loadChunk().catch(() => {}), 1000), { once: true });
  }
}
