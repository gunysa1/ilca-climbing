// admin_log (migration 045): who changed competitions, rounds, judge assignments, roles and appeals. The
// admin round and competition pages list the entries; these pure steps pick the fields to show. Pure.

export type AdminLogTable = 'competitions' | 'rounds' | 'judge_assignments' | 'user_roles' | 'appeals';
export interface AdminLogEntry {
  id: number;
  at: string;
  actor_id: string | null;
  table_name: AdminLogTable;
  row_id: string;
  action: 'insert' | 'update' | 'delete';
  /** update: {column: [old, new]}; insert / delete: {column: value} */
  changes: Record<string, unknown>;
  competition_id: string | null;
  round_id: string | null;
}
export const ADMIN_LOG_COLUMNS = 'id, at, actor_id, table_name, row_id, action, changes, competition_id, round_id';

export interface LogField { field: string; before?: unknown; after: unknown }

/** Columns that only say where the row belongs (the page shows that already) or are bookkeeping. */
const CONTEXT = new Set(['id', 'created_at', 'competition_id', 'category_id', 'round_id']);

/** The fields of an entry to show: what changed (before, after), or what was added / deleted (its non-empty
 * fields, without ids of where it belongs). */
export function logFields(e: Pick<AdminLogEntry, 'action' | 'changes'>): LogField[] {
  if (e.action === 'update') {
    return Object.entries(e.changes).map(([field, v]) => {
      const [before, after] = Array.isArray(v) ? v : [undefined, v];
      return { field, before, after };
    });
  }
  return Object.entries(e.changes).filter(([f, v]) => !CONTEXT.has(f) && v != null).map(([field, after]) => ({ field, after }));
}

/** Profile ids an entry mentions (who made it, the judge or climber of the row), to look up their names. */
export function logProfileIds(entries: AdminLogEntry[]): string[] {
  const ids = new Set<string>();
  for (const e of entries) {
    if (e.actor_id) ids.add(e.actor_id);
    for (const f of logFields(e)) {
      if (f.field !== 'judge_id' && f.field !== 'climber_id') continue;
      for (const v of [f.before, f.after]) if (typeof v === 'string') ids.add(v);
    }
  }
  return [...ids];
}
