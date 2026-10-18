// Admin view of `client_errors`: the rows grouped by message.
export interface ClientErrorRow {
  id: string;
  created_at: string;
  app: string;
  path: string | null;
  message: string;
  stack: string | null;
  build: string | null;
  context: unknown;
  profile: { full_name: string; full_name_he: string | null } | null;
}

export interface ErrorGroup {
  message: string;
  count: number;
  /** ISO time of the newest row. */
  lastSeen: string;
  who: { name: string; name_he: string | null }[];
  paths: string[];
  builds: string[];
  /** Stack and context of the newest row. */
  stack: string | null;
  context: unknown;
  ids: string[];
}

/** Newest group first. */
export function groupErrors(rows: ClientErrorRow[]): ErrorGroup[] {
  const by = new Map<string, ClientErrorRow[]>();
  for (const r of rows) by.set(r.message, [...(by.get(r.message) ?? []), r]);
  const uniq = <T,>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  return [...by.entries()].map(([message, rs]) => {
    const newest = rs.reduce((a, b) => (Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a));
    return {
      message,
      count: rs.length,
      lastSeen: newest.created_at,
      who: uniq(rs.flatMap((r) => (r.profile ? [{ name: r.profile.full_name, name_he: r.profile.full_name_he }] : [])), (p) => p.name),
      paths: uniq(rs.flatMap((r) => (r.path ? [r.path] : [])), (p) => p),
      builds: uniq(rs.flatMap((r) => (r.build ? [r.build] : [])), (b) => b),
      stack: newest.stack,
      context: newest.context,
      ids: rs.map((r) => r.id),
    };
  }).sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}
