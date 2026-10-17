import { describe, expect, it } from 'vitest';
import { RANK_CLASSES } from './rankings';
import { parseSeason, rankingTable, seasonRanking, seasonTables } from './rankingTables';
import { seasonPayload } from './testdata/seasonPayload';

describe('ranking tables', () => {
  const season = '2026-27';
  const data = parseSeason(JSON.parse(JSON.stringify(seasonPayload(season))));

  it('every class, gender and discipline of the season', () => {
    const tables = seasonTables(data, season);
    expect(tables).toHaveLength(16);
    expect(new Set(tables.map((t) => `${t.rank_class}|${t.gender}|${t.discipline}`)).size).toBe(16);
    for (const c of RANK_CLASSES) expect(tables.filter((t) => t.rank_class === c)).toHaveLength(4);
  });

  it('rows are the ranking with each climber\'s name and club', () => {
    const t = rankingTable(data, season, 'senior', 'female', 'boulder');
    const ranking = seasonRanking(data, season, 'senior', 'female', 'boulder');
    expect(t.rows.map(({ full_name: _a, full_name_he: _b, club: _c, ...r }) => r)).toEqual(ranking);
    expect(t.rows.length).toBeGreaterThan(3);
    const noa = t.rows.find((r) => r.climber_id === 'w1')!;
    expect([noa.full_name, noa.full_name_he, noa.club]).toEqual(['Noa Levi', 'נועה לוי', 'Club A']);
    const unknown = t.rows.find((r) => r.climber_id === 'wn')!;
    expect([unknown.full_name, unknown.full_name_he, unknown.club]).toEqual([null, null, null]);
    expect(t.rows.some((r) => r.climber_id === 'wy')).toBe(false); // too young for the seniors
  });

  it('the fixture reaches every part a row can show', () => {
    const rows = seasonTables(data, season).flatMap((t) => t.rows)
      .concat(seasonTables(parseSeason(seasonPayload('2024-25')), '2024-25').flatMap((t) => t.rows));
    const events = rows.flatMap((r) => r.events);
    expect(rows.some((r) => r.championship)).toBe(true);
    expect(rows.some((r) => r.bonus > 0)).toBe(true);
    expect(rows.some((r) => r.adjustment < 0)).toBe(true);
    expect(events.some((e) => e.kind === 'world' && e.counted)).toBe(true);
    expect(events.some((e) => e.kind === 'intl' && e.href === 'https://ifsc.results.info/event/1401')).toBe(true);
    expect(events.some((e) => e.kind === 'intl' && e.points > 0)).toBe(true); // 2024-25: per-event points
    expect(events.some((e) => !e.counted)).toBe(true);
    expect(events.some((e) => e.kind === 'league' && !Number.isInteger(e.points))).toBe(true); // a shared place
  });

  it('meta: edition, assumed, world ranking missing or provisional', () => {
    expect(rankingTable(data, season, 'senior', 'male', 'lead').meta)
      .toEqual({ criteria: 'ilca2027', assumed: false, world_missing: false, provisional: true });
    expect(rankingTable(data, season, 'U17', 'female', 'boulder').meta)
      .toEqual({ criteria: 'ilca2027', assumed: false, world_missing: false, provisional: false });
    const fixed = { ...data, world: data.world.map((w) => ({ ...w, as_of: '2027-01-01' })) };
    expect(rankingTable(fixed, season, 'senior', 'male', 'lead').meta.provisional).toBe(false);
    expect(rankingTable({ ...data, world: [] }, season, 'senior', 'male', 'lead').meta)
      .toEqual({ criteria: 'ilca2027', assumed: false, world_missing: true, provisional: false });
    expect(rankingTable(parseSeason(seasonPayload('2025-26')), '2025-26', 'senior', 'male', 'lead').meta)
      .toEqual({ criteria: 'ilca2025', assumed: true, world_missing: false, provisional: false });
  });

  it('parses numerics that arrive as strings', () => {
    expect(data.adjustments[0].points).toBe(-10);
    expect(data.intl.find((r) => r.event_type === 'manual')!.points).toBe(42.5);
  });
});
