// Delete an account from the staff app (admins only, after a confirmation in the app). The login is
// removed in Supabase Auth (its roles go with it); the climber profile and its results always stay.
// The account's own profile is removed only when it has no climbing data (delete_account_profile).
import { json, cors, requireAdmin, serviceClient } from '../_shared/admin.ts';
import { deleteRefusal } from '../_shared/pure.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const admin = serviceClient();
  const caller = await requireAdmin(req, admin);
  if ('response' in caller) return caller.response;

  const body = await req.json().catch(() => null) as { user_id?: unknown } | null;
  const target = body?.user_id;
  const [{ data: roles }, { count: adminCount }] = await Promise.all([
    admin.from('user_roles').select('role').eq('user_id', typeof target === 'string' ? target : '00000000-0000-0000-0000-000000000000'),
    admin.from('user_roles').select('user_id', { count: 'exact', head: true }).eq('role', 'admin'),
  ]);
  const refusal = deleteRefusal(caller.userId, target, (roles ?? []).map((r) => r.role as string), adminCount ?? 0);
  if (refusal) return json({ error: refusal }, 400);
  const userId = target as string;

  const { data: profile } = await admin.from('profiles').select('id').eq('user_id', userId).maybeSingle();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return json({ error: error.message }, 500);
  let profileRemoved = false;
  if (profile) {
    const { data } = await admin.rpc('delete_account_profile', { p_profile: profile.id });
    profileRemoved = data === true;
  }
  return json({ status: 'deleted', profile_removed: profileRemoved });
});
