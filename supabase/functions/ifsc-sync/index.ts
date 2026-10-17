// Daily IFSC sync (pg_cron with the x-sync-secret header) or a manual run by an admin (staff app).
// Body {} runs the full sync; { athlete } imports the waiting results of an athlete an admin just linked.
// Every call is logged in ifsc_sync_runs (running → ok with counts, or failed with the error); one run at a time
// (409 busy while another runs; a run still running after 15 minutes is marked failed).
import { json, cors, requireAdmin, serviceClient } from '../_shared/admin.ts';
import { parseSyncBody, sameSecret } from '../_shared/pure.ts';
import { runSync, type Ifsc } from './sync.ts';
import { finishRun, startRun, supabaseStore } from './store.ts';

const BASE = 'https://ifsc.results.info';

/** IFSC API over fetch: one request at a time, a short pause between them, 30 s per request. */
function ifscFetcher(): Ifsc {
  let last = 0;
  return {
    async get(path) {
      const wait = last + 300 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const res = await fetch(BASE + path, {
        headers: { referer: `${BASE}/`, accept: 'application/json', 'user-agent': 'ilca-climbing-sync/1.0' },
        signal: AbortSignal.timeout(30000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`IFSC ${path}: HTTP ${res.status}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`IFSC ${path}: not JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})`);
      }
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const db = serviceClient();
  if (!sameSecret(req.headers.get('x-sync-secret'), Deno.env.get('IFSC_SYNC_SECRET'))) {
    const caller = await requireAdmin(req, db);
    if ('response' in caller) return json({ error: 'unauthorized' }, 401);
  }

  const input = parseSyncBody(await req.text().catch(() => ''));
  if ('error' in input) return json(input, 400);

  let run: number | null;
  try {
    run = await startRun(db);
  } catch (e) {
    return json({ status: 'failed', error: `run log: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) }, 500);
  }
  if (run === null) return json({ status: 'busy' }, 409);
  const id = run;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const summary = await runSync(ifscFetcher(), supabaseStore(db), today, { onlyAthlete: input.athlete });
    await finishRun(db, id, { status: 'ok', ...summary });
    return json({ status: 'ok', ...summary });
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await finishRun(db, id, { status: 'failed', error });
    return json({ status: 'failed', error }, 500);
  }
});
