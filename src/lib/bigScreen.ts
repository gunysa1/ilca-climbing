// Big-screen mode (venue TV): which rounds to rotate through, and how long to stay on each.
import type { CategoryRounds } from './roundData';

export interface ScreenRound { round_id: string; category_id: string; category: string; category_he: string | null; kind: 'qualification' | 'semifinal' | 'final'; live: boolean }

const KIND_ORDER = ['qualification', 'semifinal', 'final'];

/** The rounds to show: every live round; when none is live, each category's latest finished round. */
export function screenRounds(categories: CategoryRounds[]): ScreenRound[] {
  const pick = (status: 'live' | 'closed') => categories.flatMap((c) => {
    const rounds = c.rounds.filter((r) => r.status === status)
      .sort((a, b) => KIND_ORDER.indexOf(b.kind) - KIND_ORDER.indexOf(a.kind));
    // live: all of them; finished: only the latest per category
    return (status === 'live' ? rounds : rounds.slice(0, 1)).map((r) => ({
      round_id: r.id, category_id: c.id, category: c.name, category_he: c.name_he, kind: r.kind, live: status === 'live',
    }));
  });
  const live = pick('live');
  return live.length > 0 ? live : pick('closed');
}

/** The round after `currentId` (wrapping); the first one when the current is not in the list any more. */
export function nextRoundId(rounds: ScreenRound[], currentId: string | null): string | null {
  if (rounds.length === 0) return null;
  const i = rounds.findIndex((r) => r.round_id === currentId);
  return rounds[(i + 1) % rounds.length].round_id; // i = -1: the first
}

export const SCREEN_DWELL_MS = 20000;
export const SCREEN_SCROLL_PX_PER_S = 40;
export const SCREEN_SCROLL_PAUSE_MS = 3000;

/** How long one round stays: 20 s, or longer when the list must scroll (a pause at the top and at the
 * bottom, so a long list is read to the end before the next round). */
export function dwellMs(overflowPx: number): number {
  if (overflowPx <= 0) return SCREEN_DWELL_MS;
  return Math.max(SCREEN_DWELL_MS, 2 * SCREEN_SCROLL_PAUSE_MS + (overflowPx / SCREEN_SCROLL_PX_PER_S) * 1000);
}
