// Stores the finished national ranking tables (ranking_tables) of the seasons whose cached payload changed:
// pg_cron calls it with the x-sync-secret header when ranking_tables_due() has a season (supabase/cron/
// ranking_tables.sql), or an admin calls it. Body {} builds due seasons (at most SEASONS_PER_CALL per call);
// { "all": true } makes every season due first. The reply names this code's version and what is still due.
import { json, cors, requireAdmin, serviceClient } from '../_shared/admin.ts';
import { sameSecret } from '../_shared/pure.ts';
import { RANKING_CODE_VERSION } from '../../../src/lib/rankingTables.ts';
import { buildDue, parseBuildBody } from './build.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const db = serviceClient();
  if (!sameSecret(req.headers.get('x-sync-secret'), Deno.env.get('RANKINGS_BUILD_SECRET'))) {
    const caller = await requireAdmin(req, db);
    if ('response' in caller) return json({ error: 'unauthorized' }, 401);
  }

  const input = parseBuildBody(await req.text().catch(() => ''));
  if ('error' in input) return json(input, 400);
  try {
    return json({ status: 'ok', version: RANKING_CODE_VERSION, ...(await buildDue(db, input)) });
  } catch (e) {
    return json({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }, 500);
  }
});
