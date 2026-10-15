// The competition (and round) the viewer looked at last, so the competitions list can offer a
// one-tap way back. Stored on the device, like favorites.
const KEY = 'last-viewed';

export interface LastViewed {
  competition_id: string;
  competition: string;
  competition_he: string | null;
  /** Deepest page visited: a round, else the competition page. */
  round_id: string | null;
  round_kind: 'qualification' | 'semifinal' | 'final' | null;
  category: string | null;
  category_he: string | null;
}

export function parseLastViewed(raw: string | null): LastViewed | null {
  try {
    const v = JSON.parse(raw ?? 'null');
    return v && typeof v.competition_id === 'string' && typeof v.competition === 'string' ? (v as LastViewed) : null;
  } catch {
    return null;
  }
}

export function readLastViewed(): LastViewed | null {
  try { return parseLastViewed(localStorage.getItem(KEY)); } catch { return null; }
}

export function saveLastViewed(v: LastViewed | null): void {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Where the bar links to: the round if there was one, else the competition. */
export const lastViewedHref = (v: LastViewed) => (v.round_id ? `/round/${v.round_id}` : `/competition/${v.competition_id}`);
