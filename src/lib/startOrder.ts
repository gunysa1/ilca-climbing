/** Optimistic version of SQL move_starter(): the climber takes `position` (clamped to 1..n), the others keep their
 *  relative order, and the start order becomes 1..n. Returns the starters in the new order. An unknown climber
 *  changes nothing (the server raises). */
export function moveStarter<T extends { climber_id: string; start_order: number | null }>(starters: T[], climberId: string, position: number): T[] {
  const sorted = [...starters].sort((a, b) =>
    (a.start_order ?? Infinity) - (b.start_order ?? Infinity) || (a.climber_id < b.climber_id ? -1 : a.climber_id > b.climber_id ? 1 : 0));
  const moving = sorted.find((s) => s.climber_id === climberId);
  if (!moving) return starters;
  const others = sorted.filter((s) => s !== moving);
  const pos = Math.max(1, Math.min(Number.isFinite(position) ? Math.trunc(position) : 1, sorted.length));
  others.splice(pos - 1, 0, moving);
  return others.map((s, i) => ({ ...s, start_order: i + 1 }));
}
