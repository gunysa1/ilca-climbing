import { describe, expect, it } from 'vitest';
import type { MsgKey } from './i18n';
import { categoryConflictText, type CategoryMergeConflict } from './mergeCategories';

// The message key with every placeholder, so the filled values show.
const t = (k: MsgKey) => `${k}|{category}|{name}|{bib}|{keep}|{drop}`;
const c = (x: Partial<CategoryMergeConflict> & { kind: string }): CategoryMergeConflict => ({ text: 'server text', ...x });

describe('categoryConflictText', () => {
  it('kinds without names', () => {
    expect(categoryConflictText(c({ kind: 'same' }), t, 'he')).toMatch(/^mergeCatsConflictSame\|/);
    expect(categoryConflictText(c({ kind: 'unknown' }), t, 'he')).toMatch(/^mergeCatsConflictUnknown\|/);
    expect(categoryConflictText(c({ kind: 'other_competition' }), t, 'en')).toMatch(/^mergeCatsConflictOther\|/);
  });
  it('results: the category in the user language (Hebrew name when there is one)', () => {
    const r = c({ kind: 'results', category: 'U15 Boys', category_he: 'בנים U15' });
    expect(categoryConflictText(r, t, 'he')).toBe('mergeCatsConflictResults|בנים U15||||');
    expect(categoryConflictText(r, t, 'en')).toBe('mergeCatsConflictResults|U15 Boys||||');
    expect(categoryConflictText(c({ kind: 'results', category: 'Open', category_he: null }), t, 'he')).toBe('mergeCatsConflictResults|Open||||');
  });
  it('a climber in both, a bib in both', () => {
    expect(categoryConflictText(c({ kind: 'both_registered', name: 'Noa', name_he: 'נועה' }), t, 'he')).toBe('mergeCatsConflictBoth||נועה|||');
    expect(categoryConflictText(c({ kind: 'same_bib', bib: 7, keep_name: 'Noa', keep_name_he: 'נועה', drop_name: 'Tamar', drop_name_he: null }), t, 'he'))
      .toBe('mergeCatsConflictBib|||7|נועה|Tamar');
  });
  it('an unknown kind keeps the server text', () => {
    expect(categoryConflictText(c({ kind: 'new_kind' }), t, 'he')).toBe('server text');
  });
});
