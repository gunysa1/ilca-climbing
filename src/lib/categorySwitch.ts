import type { Round } from './types';

const ORDER: Round['kind'][] = ['qualification', 'semifinal', 'final'];
type R = Pick<Round, 'id' | 'kind' | 'status'>;

/** Where switching to another category (men ↔ women) goes from a round of `kind`: the same round
 *  when it has started there, else that category's latest started round; null when none has. */
export function switchTarget(rounds: R[], kind: Round['kind']): string | null {
  const started = rounds.filter((r) => r.status !== 'planned');
  const same = started.find((r) => r.kind === kind);
  if (same) return same.id;
  const latest = [...started].sort((a, b) => ORDER.indexOf(b.kind) - ORDER.indexOf(a.kind))[0];
  return latest?.id ?? null;
}
