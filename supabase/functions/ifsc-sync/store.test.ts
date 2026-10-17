import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { supabaseStore } from './store.ts';

/** A query-builder stand-in: records every call as `table.method(args)` and answers { data: [], error: null }. */
function fakeDb() {
  const calls: string[] = [];
  const builder = (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'in', 'is', 'not', 'order', 'range', 'lt', 'limit']) {
      q[m] = (...args: unknown[]) => { calls.push(`${table}.${m}(${JSON.stringify(args)})`); return q; };
    }
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
    return q;
  };
  return { db: { from: builder } as unknown as SupabaseClient, calls };
}

describe('supabaseStore.replaceWorldFor', () => {
  it('upserts the athlete\'s positions and deletes only the disciplines they dropped out of', async () => {
    const { db, calls } = fakeDb();
    await supabaseStore(db).replaceWorldFor('2026-27', 'p2', [{ climber_id: 'p2', discipline: 'boulder', position: 77 }], '2026-10-17');
    expect(calls.filter((c) => c.includes('.upsert('))).toEqual([
      'world_rankings.upsert([[{"climber_id":"p2","discipline":"boulder","position":77,"season":"2026-27","as_of":"2026-10-17"}],{"onConflict":"climber_id,season,discipline"}])']);
    expect(calls.slice(calls.findIndex((c) => c.includes('.delete(')))).toEqual(['world_rankings.delete([])',
      'world_rankings.eq(["season","2026-27"])', 'world_rankings.eq(["climber_id","p2"])', 'world_rankings.in(["discipline",["lead"]])']);
  });

  it('deletes both disciplines when the athlete is in no list', async () => {
    const { db, calls } = fakeDb();
    await supabaseStore(db).replaceWorldFor('2026-27', 'p3', [], '2026-10-17');
    expect(calls.some((c) => c.includes('.upsert('))).toBe(false);
    expect(calls).toContain('world_rankings.in(["discipline",["boulder","lead"]])');
  });
});
