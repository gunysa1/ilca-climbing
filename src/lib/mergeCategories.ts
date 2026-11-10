// The report of SQL merge_categories() (migration 051) and its conflicts as plain he/en text. The server sends an
// English `text` with each conflict; known kinds are shown from the app's own strings, unknown ones keep that text.
import { localized, type Lang, type MsgKey } from './i18n';
import type { Category } from './types';

export interface CategoryMergeConflict {
  kind: string;
  text: string;
  category?: string; category_he?: string | null;
  name?: string; name_he?: string | null;
  bib?: number;
  keep_name?: string; keep_name_he?: string | null;
  drop_name?: string; drop_name_he?: string | null;
}

export interface CategoryMergeReport {
  keep: { id: string; name: string; name_he: string | null; gender: Category['gender'] } | null;
  drop: { id: string; name: string; name_he: string | null; gender: Category['gender']; rounds: number } | null;
  moving: { climber_id: string; full_name: string; full_name_he: string | null; bib: number | null; age_class: string | null }[];
  conflicts: CategoryMergeConflict[];
  applied: boolean;
}

const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

/** One conflict in the user's language. */
export function categoryConflictText(c: CategoryMergeConflict, t: (k: MsgKey) => string, lang: Lang): string {
  switch (c.kind) {
    case 'same': return t('mergeCatsConflictSame');
    case 'unknown': return t('mergeCatsConflictUnknown');
    case 'other_competition': return t('mergeCatsConflictOther');
    case 'results': return fill(t('mergeCatsConflictResults'), { category: localized(lang, c.category ?? '', c.category_he) });
    case 'both_registered': return fill(t('mergeCatsConflictBoth'), { name: localized(lang, c.name ?? '', c.name_he) });
    case 'same_bib': return fill(t('mergeCatsConflictBib'), {
      bib: c.bib ?? '', keep: localized(lang, c.keep_name ?? '', c.keep_name_he), drop: localized(lang, c.drop_name ?? '', c.drop_name_he) });
    default: return c.text;
  }
}
