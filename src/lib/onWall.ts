import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Boulder } from './types';

/** How often the live results ask who is on the wall. Claims aren't public, so no Realtime here. */
export const ON_WALL_POLL_MS = 5000;

export interface OnWallRow { boulder_id: string; climber_id: string }
/** One climber on the wall: on which boulder (number), in boulder order. */
export interface OnWall { number: number; boulder_id: string; climber_id: string }

/** Rows of on_wall() in boulder order, dropping boulders that aren't in the round. */
export function onWallList(rows: OnWallRow[], boulders: Boulder[]): OnWall[] {
  const numbers = new Map(boulders.map((b) => [b.id, b.number]));
  return rows.filter((r) => numbers.has(r.boulder_id))
    .map((r) => ({ ...r, number: numbers.get(r.boulder_id)! }))
    .sort((a, b) => a.number - b.number);
}

/** Climber id -> boulder ids they are on now (a climber is normally on one boulder at a time). */
export function onWallByClimber(list: OnWall[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const w of list) m.set(w.climber_id, [...(m.get(w.climber_id) ?? []), w.boulder_id]);
  return m;
}

/** Who is climbing now in a live round (on_wall: fresh judge claims on unlocked results). */
export function useOnWall(roundId: string | undefined, live: boolean): OnWallRow[] {
  const [rows, setRows] = useState<OnWallRow[]>([]);
  useEffect(() => {
    setRows([]);
    if (!roundId || !live) return;
    let stop = false;
    const load = () => supabase.rpc('on_wall', { p_round: roundId })
      .then(({ data }) => { if (!stop) setRows((data ?? []) as OnWallRow[]); });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, ON_WALL_POLL_MS);
    return () => { stop = true; clearInterval(timer); };
  }, [roundId, live]);
  return rows;
}
