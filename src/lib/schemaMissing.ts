// A new staff build can reach a database that does not have this release's migrations yet (the site deploys on
// push, `db push` follows). Features that need a new table or function hide themselves then instead of showing an
// error. Pure.

/** PostgREST / Postgres error codes for "no such function / table" (schema cache or catalog). */
const MISSING = new Set(['PGRST202', 'PGRST205', '42883', '42P01']);

export const isMissingInDb = (e: { code?: string } | null | undefined) => !!e?.code && MISSING.has(e.code);
