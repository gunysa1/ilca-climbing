// Results as a CSV file (Excel): the same rows and cell texts as the round page and its PDF.
import { localized, type Lang, type MsgKey } from './i18n';
import { ascentCellText } from './printing';
import { resultKey, type LeadRow, type ResultRow, type Starter, type TotalsRow } from './roundData';
import { roundRows } from './roundRows';
import type { Boulder, Round } from './types';

export interface CsvLabels {
  rank: string; athlete: string; bib: string; club: string; ageClass: string; group: string;
  boulder: string; route: string;
  /** Heading of the totals column (scoreHeader). */
  score: string;
  dns: string; dsq: string;
}

/** RFC 4180: a field with a comma, quote or line break is quoted, quotes doubled. */
export function csvEscape(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Tables (each a list of rows) as one file: UTF-8 with BOM (Excel reads Hebrew), CRLF, a blank line between tables. */
export function resultsCsvText(tables: string[][][]): string {
  return '﻿' + tables.map((rows) => rows.map((r) => r.map(csvEscape).join(',') + '\r\n').join('')).join('\r\n');
}

/** The column words in the current language. `score` is the totals heading (roundRows.scoreHeader). */
export const csvLabels = (t: (k: MsgKey) => string, score: string): CsvLabels => ({
  rank: t('rank'), athlete: t('athlete'), bib: t('bib'), club: t('club'), ageClass: t('ageClass'), group: t('group'),
  boulder: t('boulder'), route: t('route'), score, dns: t('dns'), dsq: t('dsq'),
});

export interface RoundTableInput {
  round: Round; boulders: Boulder[]; starters: Starter[];
  results: Map<string, ResultRow>; leadResults: Map<string, LeadRow>; totals: Map<string, TotalsRow>;
  lang: Lang; labels: CsvLabels;
  /** A title row above the header (one block of a competition file). */
  title?: string;
}

/** Header and one row per starter: place (DNS / DSQ for those), bib, name, club, age class, [group], a column
 *  per boulder / route, totals. Qualification groups are ranked separately, like on the page. */
export function roundTable(i: RoundTableInput): string[][] {
  const { round, boulders, starters, labels } = i;
  const lead = round.scoring === 'lead';
  const showTime = lead && round.kind === 'final' && round.time_tiebreak !== false;
  const groups = [...new Set(starters.map((s) => s.group_label).filter((g): g is string => !!g))].sort();
  const byId = new Map(starters.map((s) => [s.climber_id, s]));
  const word = lead ? labels.route : labels.boulder;
  const header = [labels.rank, labels.bib, labels.athlete, labels.club, labels.ageClass, ...(groups.length ? [labels.group] : []),
    ...boulders.map((b) => `${word} ${b.number}`), labels.score];
  const lists = groups.length ? groups.map((g) => starters.filter((s) => s.group_label === g)) : [starters];
  const rows = lists.flatMap((list) => roundRows(round, list, boulders, i.results, i.leadResults, i.totals)).map((row) => {
    const s = byId.get(row.climber_id)!;
    return [
      row.status ? labels[row.status] : row.rank != null ? String(row.rank) : '–',
      s.bib != null ? String(s.bib) : '',
      localized(i.lang, s.profile.full_name, s.profile.full_name_he),
      s.profile.club ?? '', s.age_class ?? '',
      ...(groups.length ? [s.group_label ?? ''] : []),
      ...boulders.map((b) => {
        const key = resultKey(b.id, row.climber_id);
        return ascentCellText({ lead, status: row.status, showTime, boulder: i.results.get(key), route: i.leadResults.get(key) });
      }),
      row.score,
    ];
  });
  return [...(i.title ? [[i.title]] : []), header, ...rows];
}

/** `<part>-<part>.csv`: Hebrew kept, characters unsafe in file names (/\:*?"<>| and control characters) become "-", repeats collapse. */
export function csvFileName(parts: string[]): string {
  // eslint-disable-next-line no-control-regex
  const name = parts.filter(Boolean).join('-').replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '-').replace(/-{2,}/g, '-').trim() || 'results';
  return `${name}.csv`;
}

/** Hands `text` to the browser as a downloaded file (no server involved). */
export function downloadCsv(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
