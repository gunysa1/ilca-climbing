// Calls to the ifsc-sync edge function from the admin pages (Rankings: run now, confirm; People: a set IFSC id).
import type { MsgKey } from '../../lib/i18n';
import { supabase } from '../../lib/supabase';

export type SyncCounts = { added?: number; updated?: number; linked?: number; pending?: number; world?: number; warnings?: string[] };

/** Another run is going (409). */
export class Busy extends Error {}

export const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));

/** "3 added · 1 corrected · … · 2 skipped" for a run or a reply. */
export function countsText(t: (k: MsgKey) => string, c: SyncCounts): string {
  return [fill(t('ifscCounts'), { added: c.added ?? 0, updated: c.updated ?? 0, linked: c.linked ?? 0, pending: c.pending ?? 0,
    world: c.world ?? 0 }), c.warnings?.length ? fill(t('ifscWarnings'), { n: c.warnings.length }) : ''].filter(Boolean).join(' · ');
}

/** Calls the ifsc-sync function and returns its counts; a non-2xx answer comes back as an error whose body holds the
 *  reason (`Busy` while another run is going). `{ athlete }` imports a just-linked athlete's waiting results and
 *  world positions. */
export async function invokeSync(body: { athlete?: number }): Promise<SyncCounts> {
  const { data, error } = await supabase.functions.invoke('ifsc-sync', { body });
  if (!error) return (data ?? {}) as SyncCounts;
  const res = (error as { context?: Response }).context;
  const j = res && typeof res.json === 'function' ? await res.json().catch(() => null) : null;
  if (j?.status === 'busy') throw new Busy();
  throw new Error(j?.error ?? error.message);
}
