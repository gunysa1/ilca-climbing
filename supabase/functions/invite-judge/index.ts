// Invite a judge from the staff app (admins only). Runs with the service role, which never reaches
// the browser. mode "email": Supabase Auth emails the invite (needs SMTP set up in the project);
// mode "link": returns a one-time invite link for the admin to share. An existing account (already
// signed up) just gets the judge role.
import { json, cors, requireAdmin, serviceClient } from '../_shared/admin.ts';
import { parseInvite } from './request.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const admin = serviceClient();
  const caller = await requireAdmin(req, admin);
  if ('response' in caller) return caller.response;

  const input = parseInvite(await req.json().catch(() => null));
  if ('error' in input) return json(input, 400);

  const addJudge = (userId: string) =>
    admin.from('user_roles').upsert({ user_id: userId, role: 'judge' }, { onConflict: 'user_id,role', ignoreDuplicates: true });

  const { data: found, error: lookupError } = await admin.rpc('account_by_email', { p_email: input.email });
  if (lookupError) return json({ error: lookupError.message }, 500);
  const existing = (found ?? [])[0] as { user_id: string; confirmed: boolean } | undefined;
  if (existing?.confirmed) {
    const { error } = await addJudge(existing.user_id);
    return error ? json({ error: error.message }, 500) : json({ status: 'existing' });
  }

  const options = { data: { full_name: input.full_name }, redirectTo: input.redirect_to };
  if (input.mode === 'email') {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, options);
    if (error || !data.user) return json({ error: 'email_failed', message: error?.message ?? 'no user' }, 502);
    const { error: roleError } = await addJudge(data.user.id);
    return roleError ? json({ error: roleError.message }, 500) : json({ status: 'emailed' });
  }
  const { data, error } = await admin.auth.admin.generateLink({ type: 'invite', email: input.email, options });
  if (error || !data.user) return json({ error: error?.message ?? 'no user' }, 500);
  const { error: roleError } = await addJudge(data.user.id);
  return roleError ? json({ error: roleError.message }, 500) : json({ status: 'link', link: data.properties.action_link });
});
