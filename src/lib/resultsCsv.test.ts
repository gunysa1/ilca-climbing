import { describe, expect, it } from 'vitest';
import { csvEscape, csvText, csvFileName, resultsCsvText, roundTable, type CsvLabels } from './resultsCsv';
import { resultKey, type LeadRow, type ResultRow, type Starter } from './roundData';
import type { Round } from './types';

const labels: CsvLabels = { rank: 'Rank', athlete: 'Athlete', bib: 'Bib', club: 'Club', ageClass: 'Age class', group: 'Group',
  boulder: 'Boulder', route: 'Route', score: 'Points', dns: 'DNS', dsq: 'DSQ' };
const starter = (id: string, name: string, over: Partial<Starter> = {}, he: string | null = null): Starter => ({
  climber_id: id, bib: 1, age_class: 'U16', start_order: 1, prev_place: null, group_label: null,
  profile: { id, full_name: name, full_name_he: he, club: 'Hapoel', country: 'ISR' }, ...over,
});
const boulders = [{ id: 'b1', round_id: 'r', number: 1 }, { id: 'b2', round_id: 'r', number: 2 }];
const res = (b: string, c: string, attempts: number, zone: number | null, top: number | null): [string, ResultRow] =>
  [resultKey(b, c), { boulder_id: b, climber_id: c, attempts, zone_attempt: zone, top_attempt: top }];
const boulderRound: Round = { id: 'r', category_id: 'c', kind: 'qualification', status: 'live', scoring: 'ifsc2025' };

describe('csvEscape', () => {
  it('leaves plain text alone and quotes commas, quotes and newlines', () => {
    expect(csvEscape('abc')).toBe('abc');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape('a\r\nb')).toBe('"a\r\nb"');
  });
  it('keeps Hebrew as it is', () => { expect(csvEscape('מאיה גל')).toBe('מאיה גל'); });
});

describe('resultsCsvText', () => {
  it('starts with the BOM, ends rows with CRLF, one blank line between tables', () => {
    const text = resultsCsvText([[['a', 'b,c'], ['1', '2']], [['x']]]);
    expect(text).toBe('﻿a,"b,c"\r\n1,2\r\n\r\nx\r\n');
  });
});

describe('roundTable: boulder', () => {
  const starters = [starter('a', 'Maya Gal', { bib: 201 }, 'מאיה גל'), starter('b', 'Tamar "T" Cohen, Jr', { bib: 202, age_class: null }),
    starter('c', 'Dan Levi', { bib: 203, status: 'dns' }), starter('d', 'Eli Bar', { bib: 204, status: 'dsq' })];
  const results = new Map([res('b1', 'a', 2, 1, 2), res('b2', 'a', 1, null, null), res('b1', 'b', 3, 2, null),
    res('b1', 'c', 1, null, null)]);
  const table = (lang: 'he' | 'en') => roundTable({ round: boulderRound, boulders, starters, results, leadResults: new Map(), totals: new Map(), lang, labels });

  it('header, rows with places, boulder cells and points', () => {
    const t = table('en');
    expect(t[0]).toEqual(['Rank', 'Bib', 'Athlete', 'Club', 'Age class', 'Boulder 1', 'Boulder 2', 'Points']);
    expect(t[1].slice(0, 7)).toEqual(['1', '201', 'Maya Gal', 'Hapoel', 'U16', 'T2 Z1', '–']);
    expect(t[2].slice(0, 7)).toEqual(['2', '202', 'Tamar "T" Cohen, Jr', 'Hapoel', '', 'Z2', '']);
    expect(t[1][7]).toMatch(/^\d+\.\d$/);
  });
  it('DNS then DSQ come last with the status as the place; a DNS row has empty cells', () => {
    const t = table('en');
    expect(t[3]).toEqual(['DNS', '203', 'Dan Levi', 'Hapoel', 'U16', '', '', '–']);
    expect(t[4].slice(0, 3)).toEqual(['DSQ', '204', 'Eli Bar']);
  });
  it('uses the Hebrew name in Hebrew', () => { expect(table('he')[1][2]).toBe('מאיה גל'); });
  it('a competition block can have a title row', () => {
    const t = roundTable({ round: boulderRound, boulders, starters, results, leadResults: new Map(), totals: new Map(), lang: 'en', labels, title: 'Men - Final' });
    expect(t[0]).toEqual(['Men - Final']);
    expect(t[1][0]).toBe('Rank');
  });
  it('classic scoring shows T/Z/attempts as the page does', () => {
    const t = roundTable({ round: { ...boulderRound, scoring: 'classic' }, boulders, starters: starters.slice(0, 1), results, leadResults: new Map(), totals: new Map(), lang: 'en', labels });
    expect(t[1][7]).toBe('1T1z 2 1');
  });
  it('qualification groups add a column and rank separately', () => {
    const g = [starter('a', 'A', { group_label: 'A' }), starter('b', 'B', { group_label: 'B' })];
    const rs = new Map([res('b1', 'a', 1, 1, 1), res('b1', 'b', 1, 1, 1)]);
    const t = roundTable({ round: boulderRound, boulders, starters: g, results: rs, leadResults: new Map(), totals: new Map(), lang: 'en', labels });
    expect(t[0]).toContain('Group');
    expect(t.slice(1).map((r) => [r[0], r[5]])).toEqual([['1', 'A'], ['1', 'B']]);
  });
  it('starters without a group in a round with groups: listed last, ranked among themselves', () => {
    const g = [starter('n', 'N'), starter('a', 'A', { group_label: 'A' }), starter('m', 'M')];
    const rs = new Map([res('b1', 'a', 1, 1, 1), res('b1', 'n', 2, 1, null), res('b1', 'm', 1, 1, 1)]);
    const t = roundTable({ round: boulderRound, boulders, starters: g, results: rs, leadResults: new Map(), totals: new Map(), lang: 'en', labels });
    expect(t.slice(1).map((r) => [r[0], r[2], r[5]])).toEqual([['1', 'A', 'A'], ['1', 'M', ''], ['2', 'N', '']]);
  });
});

describe('roundTable: lead', () => {
  const leadRound: Round = { id: 'f', category_id: 'c', kind: 'final', status: 'live', scoring: 'lead' };
  const routes = [{ id: 'r1', round_id: 'f', number: 1 }];
  const lead = (c: string, hold: number, plus: boolean, top: boolean, time_ms: number | null): [string, LeadRow] =>
    [resultKey('r1', c), { boulder_id: 'r1', climber_id: c, hold, plus, top, time_ms }];
  it('heights like 36+ and TOP, with the time in a timed final', () => {
    const t = roundTable({ round: leadRound, boulders: routes, starters: [starter('a', 'A'), starter('b', 'B')], results: new Map(),
      leadResults: new Map([lead('a', 36, true, false, null), lead('b', 40, false, true, 130_000)]), totals: new Map(), lang: 'en',
      labels: { ...labels, score: 'Climb time' } });
    expect(t[0].slice(-2)).toEqual(['Route 1', 'Climb time']);
    expect(t[1].slice(0, 3)).toEqual(['1', '1', 'B']);
    expect(t[1][5]).toBe('TOP · 2:10');
    expect(t[2][5]).toBe('36+');
  });
});

describe('csvFileName', () => {
  it('joins the parts, keeps Hebrew, replaces unsafe characters, collapses repeats', () => {
    expect(csvFileName(['Open: Cup/2026', 'גברים', 'Final'])).toBe('Open- Cup-2026-גברים-Final.csv');
    expect(csvFileName(['a??b', 'c\u0001d'])).toBe('a-b-c-d.csv');
    expect(csvFileName(['ליגה'])).toBe('ליגה.csv');
  });
});

describe('formula injection', () => {
  it('csvText prefixes a quote on = + - @ tab CR only', () => {
    for (const v of ['=1+1', '+1', '-x', '@a', '\tx', '\rx']) expect(csvText(v)).toBe(`'${v}`);
    expect(csvText('Maya')).toBe('Maya');
    expect(csvText('')).toBe('');
  });
  it('free-text cells are neutralised, generated cells are not', () => {
    const st = [starter('a', '=HYPERLINK("http://x","y")', { bib: 5, age_class: '@U16' }), starter('b', 'B')];
    st[1].profile.club = '-x';
    const t = roundTable({ round: boulderRound, boulders, starters: st, title: '=T', labels, lang: 'en',
      results: new Map([res('b1', 'a', 1, 1, 1)]), leadResults: new Map(), totals: new Map() });
    expect(t[0]).toEqual(["'=T"]);
    expect(t[2][2]).toBe(`'=HYPERLINK("http://x","y")`);
    expect(resultsCsvText([t])).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(t[2][4]).toBe("'@U16");
    expect(t[3][3]).toBe("'-x");
    expect(t[2][0]).toBe('1');
    expect(t[3][0]).toBe('–');
    expect(t[3][5]).toBe('');
    expect(t[2][5]).toBe('T1 Z1');
    expect(t[3].at(-1)).toBe('–');
  });
});
describe('csvFileName: trailing dots', () => {
  it('no dot or space before .csv', () => {
    expect(csvFileName(['name.'])).toBe('name.csv');
    expect(csvFileName(['a', 'b. '])).toBe('a-b.csv');
    expect(csvFileName(['  '])).toBe('results.csv');
  });
});
