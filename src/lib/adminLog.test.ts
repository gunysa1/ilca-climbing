import { describe, expect, it } from 'vitest';
import { logFields, logProfileIds, type AdminLogEntry } from './adminLog';

const entry = (o: Partial<AdminLogEntry>): AdminLogEntry => ({
  id: 1, at: '2026-10-28T08:00:00Z', actor_id: 'admin', table_name: 'rounds', row_id: 'r1', action: 'update',
  changes: {}, competition_id: 'c1', round_id: 'r1', ...o,
});

describe('admin log', () => {
  it('an update shows each changed column with its old and new value', () => {
    expect(logFields(entry({ changes: { status: ['planned', 'live'], advance_quota: [null, 8] } }))).toEqual([
      { field: 'status', before: 'planned', after: 'live' },
      { field: 'advance_quota', before: null, after: 8 },
    ]);
  });

  it('an insert or delete shows its own non-empty fields, not where it belongs', () => {
    const e = entry({ table_name: 'judge_assignments', action: 'insert',
      changes: { id: 'a1', round_id: 'r1', boulder_id: null, judge_id: 'j1' } });
    expect(logFields(e)).toEqual([{ field: 'judge_id', after: 'j1' }]);
    expect(logFields(entry({ table_name: 'competitions', action: 'delete',
      changes: { id: 'c1', name: 'Cup', status: 'draft', created_at: 'x', venue: null } }))).toEqual([
      { field: 'name', after: 'Cup' }, { field: 'status', after: 'draft' },
    ]);
  });

  it('names to look up: who made it and the judges / climbers it mentions', () => {
    expect(logProfileIds([
      entry({ actor_id: 'admin', table_name: 'judge_assignments', action: 'update', changes: { judge_id: ['j1', 'j2'] } }),
      entry({ actor_id: null, table_name: 'appeals', action: 'insert', changes: { climber_id: 'k1', status: 'open' } }),
      entry({ actor_id: 'admin', changes: { status: ['planned', 'live'] } }),
    ]).sort()).toEqual(['admin', 'j1', 'j2', 'k1']);
  });
});
