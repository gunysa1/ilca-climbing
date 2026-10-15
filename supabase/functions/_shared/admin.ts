// Shared by the admin edge functions: CORS, JSON replies and the "caller must be an admin" check.
// Runs in Deno on Supabase; the pure helpers are in ./pure.ts (unit-tested with vitest).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { bearer } from './pure.ts';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** The service-role client (never leaves Supabase). */
export const serviceClient = (): SupabaseClient => createClient(Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

/** The calling admin's user id, or the error response to return. */
export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<{ userId: string } | { response: Response }> {
  const token = bearer(req.headers.get('Authorization'));
  const { data } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  if (!data.user) return { response: json({ error: 'not signed in' }, 401) };
  const { data: isAdmin } = await admin.from('user_roles').select('role')
    .eq('user_id', data.user.id).eq('role', 'admin').maybeSingle();
  if (!isAdmin) return { response: json({ error: 'admins only' }, 403) };
  return { userId: data.user.id };
}
