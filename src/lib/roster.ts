// Roster CSV import: parse a registration sheet (same headers as the temporary app's Excel export)
// and plan which categories/profiles to create and who to register. Pure functions; the admin
// page previews the plan and then applies it. ID/passport numbers are deliberately ignored.

import type { Category } from './types';

export interface RosterRow {
  line: number; // 1-based line in the file (header = 1)
  name: string;
  club: string;
  category: string;
  gender: 'female' | 'male' | null;
  bib: number | null;
  birthDate: string | null; // ISO yyyy-mm-dd
  email: string | null;
}

export interface RosterError { line: number; message: string }

/** Split CSV text into rows of cells. Delimiter (comma, semicolon or tab) is taken from the header. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const delim = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true; // mid-cell quotes are literal (ת"ז)
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const normHeader = (v: string) => v
  .replace(/[‎‏‪-‮]/g, '')
  .replace(/['"׳״‘’ʼ`]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase();

const HEADERS: Record<Exclude<keyof RosterRow, 'line'>, string[]> = {
  name: ['שם מלא', 'שם', 'name', 'full name'],
  club: ['שם אגודה', 'אגודה', 'מועדון', 'club'],
  category: ['קטגוריה', 'category'],
  gender: ['מגדר', 'גנדר', "ג'נדר", 'gender'],
  bib: ['מספר גב', 'מספר חזה', 'bib'],
  birthDate: ['תאריך לידה', 'ת. לידה', 'ת לידה', 'birth date', 'dob'],
  email: ['אימייל', 'מייל', 'דוא"ל', 'email', 'e-mail'],
};

const FEMALE = ['f', 'w', 'female', 'woman', 'women', 'girl', 'girls', 'נקבה', 'אישה', 'אשה', 'נשים', 'בנות'];
const MALE = ['m', 'male', 'man', 'men', 'boy', 'boys', 'זכר', 'גבר', 'גברים', 'בנים'];

function parseGender(v: string): RosterRow['gender'] {
  const g = v.trim().toLowerCase();
  if (FEMALE.includes(g)) return 'female';
  if (MALE.includes(g)) return 'male';
  return null;
}

function parseDate(v: string): string | null {
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/); // dd/mm/yyyy (Israeli format)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

export function parseRoster(text: string): { rows: RosterRow[]; errors: RosterError[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], errors: [{ line: 1, message: 'empty file' }] };
  const keys = header.map(normHeader);
  const col = Object.fromEntries(Object.entries(HEADERS).map(([field, aliases]) =>
    [field, aliases.map(normHeader).map((a) => keys.indexOf(a)).find((i) => i >= 0) ?? -1])) as
    Record<keyof typeof HEADERS, number>;
  if (col.name < 0) return { rows: [], errors: [{ line: 1, message: 'no name column' }] };

  const rows: RosterRow[] = [];
  const errors: RosterError[] = [];
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (f: keyof typeof HEADERS) => (col[f] >= 0 ? (cells[col[f]] ?? '').trim() : '');
    const name = get('name').replace(/\s+/g, ' ');
    const category = get('category');
    if (!name) { errors.push({ line, message: 'missing name' }); return; }
    if (!category) { errors.push({ line, message: 'missing category' }); return; }
    const bib = Number.parseInt(get('bib'), 10);
    rows.push({
      line, name, club: get('club'), category, gender: parseGender(get('gender')),
      bib: Number.isFinite(bib) && bib > 0 ? bib : null,
      birthDate: parseDate(get('birthDate')), email: get('email') || null,
    });
  });
  return { rows, errors };
}

// ---------------------------------------------------------------------------- plan

export interface ImportContext {
  categories: Pick<Category, 'id' | 'name' | 'name_he' | 'gender'>[];
  profiles: { id: string; full_name: string; full_name_he: string | null; club: string | null }[];
  registrations: { category_id: string; climber_id: string }[];
}

export interface ImportPlan {
  newCategories: { key: string; name: string; gender: Category['gender'] }[];
  newProfiles: { key: string; row: RosterRow }[];
  /** category / climber are existing ids or keys of newCategories / newProfiles. */
  registrations: { line: number; category: string; climber: string; bib: number | null }[];
  skipped: { line: number; reason: 'duplicate' | 'ambiguous' | 'already registered' }[];
}

const norm = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export function planImport(rows: RosterRow[], ctx: ImportContext): ImportPlan {
  const plan: ImportPlan = { newCategories: [], newProfiles: [], registrations: [], skipped: [] };
  const catIds = new Map<string, string>();
  for (const c of ctx.categories) {
    catIds.set(norm(c.name), c.id);
    if (c.name_he) catIds.set(norm(c.name_he), c.id);
  }
  const registered = new Set(ctx.registrations.map((r) => `${r.category_id}|${r.climber_id}`));
  const seen = new Set<string>();

  for (const row of rows) {
    const fileKey = `${norm(row.name)}|${norm(row.club)}|${norm(row.category)}`;
    if (seen.has(fileKey)) { plan.skipped.push({ line: row.line, reason: 'duplicate' }); continue; }
    seen.add(fileKey);

    const matches = ctx.profiles.filter((p) =>
      (norm(p.full_name) === norm(row.name) || norm(p.full_name_he) === norm(row.name)) &&
      (!p.club || !row.club || norm(p.club) === norm(row.club)));
    if (matches.length > 1) { plan.skipped.push({ line: row.line, reason: 'ambiguous' }); continue; }

    let category = catIds.get(norm(row.category));
    if (!category) {
      category = `new-cat:${norm(row.category)}`;
      catIds.set(norm(row.category), category);
      plan.newCategories.push({ key: category, name: row.category, gender: row.gender ?? 'mixed' });
    } else {
      const created = plan.newCategories.find((c) => c.key === category);
      if (created && created.gender !== (row.gender ?? 'mixed')) created.gender = 'mixed';
    }

    let climber = matches[0]?.id;
    if (climber && registered.has(`${category}|${climber}`)) {
      plan.skipped.push({ line: row.line, reason: 'already registered' });
      continue;
    }
    if (!climber) {
      climber = `new-profile:${row.line}`;
      plan.newProfiles.push({ key: climber, row });
    }
    plan.registrations.push({ line: row.line, category, climber, bib: row.bib });
  }
  return plan;
}
