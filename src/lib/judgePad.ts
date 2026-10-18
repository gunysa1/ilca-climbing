// Pure steps of the judge pad (src/pages/judge/JudgeBoulder.tsx, src/lib/roundData.ts).

/** The climber the pad is on: by id, so a start list that changes under the pad (a reload while the
 *  round isn't live) keeps the same climber; `at` is where they were, used when they left the list. */
export interface PadPosition { id: string; at: number }

/** Index of the current climber in `ids` (start order); null before one is chosen or with no list. */
export function padIndex(ids: string[], current: PadPosition | null): number | null {
  if (!current || !ids.length) return null;
  const k = ids.indexOf(current.id);
  return k >= 0 ? k : Math.min(current.at, ids.length - 1);
}

/** The judge pad's first load: the server's page when the server answered (even "no page"); the copy
 *  kept on the phone only when it couldn't be reached (no signal, timeout, server error). */
export function pickPadPage<P>(fetched: { page: P | null; reachable: boolean }, kept: P | undefined): { page: P | null; offline: boolean } {
  if (fetched.page) return { page: fetched.page, offline: false };
  if (fetched.reachable) return { page: null, offline: false };
  return { page: kept ?? null, offline: !!kept };
}
