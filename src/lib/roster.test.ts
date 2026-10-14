import { describe, expect, it } from 'vitest';
import { parseCsv, parseRoster, planImport } from './roster';

describe('parseCsv', () => {
  it('handles BOM, quotes, escaped quotes, CRLF and blank lines', () => {
    const text = '﻿name,club\r\n"Cohen, Noa","Club ""A"""\r\n\r\nTamar,B\n';
    expect(parseCsv(text)).toEqual([['name', 'club'], ['Cohen, Noa', 'Club "A"'], ['Tamar', 'B']]);
  });

  it('detects semicolon and tab delimiters from the header', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('parseRoster', () => {
  it('reads the temporary app\'s Hebrew headers and ignores ID numbers', () => {
    const csv = 'שם מלא,שם אגודה,קטגוריה,מגדר,מספר גב,ת"ז/דרכון,תאריך לידה\n' +
      'נועה לוי,מטפסי תל אביב,בוגרות,נקבה,107,123456789,05/03/2008\n';
    const { rows, errors } = parseRoster(csv);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{
      line: 2, name: 'נועה לוי', club: 'מטפסי תל אביב', category: 'בוגרות', gender: 'female',
      bib: 107, birthDate: '2008-03-05', email: null,
    }]);
    expect(JSON.stringify(rows)).not.toContain('123456789');
  });

  it('reads English headers and reports rows missing a name or category', () => {
    const csv = 'Name,Club,Category,Gender,Bib,Email\nTamar Cohen,Top Netanya,U19 Women,F,12,t@x.il\n,X,U19 Women,F,13,\nDana,X,,F,14,\n';
    const { rows, errors } = parseRoster(csv);
    expect(rows.map((r) => [r.name, r.gender, r.bib, r.email])).toEqual([['Tamar Cohen', 'female', 12, 't@x.il']]);
    expect(errors).toEqual([{ line: 3, message: 'missing name' }, { line: 4, message: 'missing category' }]);
  });

  it('fails clearly when there is no name column', () => {
    expect(parseRoster('club,category\nA,B\n').errors).toEqual([{ line: 1, message: 'no name column' }]);
  });
});

describe('planImport', () => {
  const ctx = {
    categories: [{ id: 'cat-w', name: 'Senior Women', name_he: 'בוגרות', gender: 'female' as const }],
    profiles: [
      { id: 'p-noa', full_name: 'Noa Levi', full_name_he: 'נועה לוי', club: 'מטפסי תל אביב' },
      { id: 'p-dup1', full_name: 'Dana Oz', full_name_he: null, club: null },
      { id: 'p-dup2', full_name: 'Dana Oz', full_name_he: null, club: null },
    ],
    registrations: [{ category_id: 'cat-w', climber_id: 'p-reg' }],
  };
  const row = (over: Partial<ReturnType<typeof parseRoster>['rows'][number]>) => ({
    line: 2, name: '', club: '', category: 'בוגרות', gender: 'female' as const, bib: null, birthDate: null, email: null, ...over,
  });

  it('reuses existing categories and profiles, creates missing ones', () => {
    const plan = planImport([
      row({ line: 2, name: ' נועה  לוי ', club: 'מטפסי תל אביב', bib: 107 }),
      row({ line: 3, name: 'Tamar Cohen', club: 'Top Netanya', category: 'U19 Girls', bib: 12 }),
      row({ line: 4, name: 'Yael Bar', category: 'U19 Girls', gender: 'female' }),
    ], ctx);
    expect(plan.newCategories).toEqual([{ key: 'new-cat:u19 girls', name: 'U19 Girls', gender: 'female' }]);
    expect(plan.newProfiles.map((p) => p.row.name)).toEqual(['Tamar Cohen', 'Yael Bar']);
    expect(plan.registrations).toEqual([
      { line: 2, category: 'cat-w', climber: 'p-noa', bib: 107 },
      { line: 3, category: 'new-cat:u19 girls', climber: 'new-profile:3', bib: 12 },
      { line: 4, category: 'new-cat:u19 girls', climber: 'new-profile:4', bib: null },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it('new category with mixed genders becomes mixed', () => {
    const plan = planImport([
      row({ line: 2, name: 'A', category: 'Open', gender: 'female' }),
      row({ line: 3, name: 'B', category: 'Open', gender: 'male' }),
    ], ctx);
    expect(plan.newCategories).toEqual([{ key: 'new-cat:open', name: 'Open', gender: 'mixed' }]);
  });

  it('skips duplicates in the file, ambiguous names and existing registrations', () => {
    const plan = planImport([
      row({ line: 2, name: 'Tamar', club: 'X' }),
      row({ line: 3, name: 'tamar', club: 'x' }),
      row({ line: 4, name: 'Dana Oz' }),
    ], { ...ctx, profiles: [...ctx.profiles, { id: 'p-reg', full_name: 'Reg', full_name_he: null, club: null }] });
    expect(plan.skipped).toEqual([
      { line: 3, reason: 'duplicate' },
      { line: 4, reason: 'ambiguous' },
    ]);
    const already = planImport([row({ line: 5, name: 'Reg' })],
      { ...ctx, profiles: [{ id: 'p-reg', full_name: 'Reg', full_name_he: null, club: null }] });
    expect(already.skipped).toEqual([{ line: 5, reason: 'already registered' }]);
    expect(already.registrations).toEqual([]);
  });
});
