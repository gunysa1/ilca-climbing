// Invite and password-reset links land with the session (or an error) in the URL hash, on whatever
// page Supabase redirected to: show the choose-a-password page. The hash stays for supabase-js.
// Not on /invite: its hash is the not-yet-used Supabase link (which itself contains type=invite).
const hash = new URLSearchParams(window.location.hash.slice(1));
const path = window.location.pathname;
if (path !== '/invite' && path !== '/set-password'
    && ((hash.has('access_token') && /^(invite|recovery)$/.test(hash.get('type') ?? '')) || hash.has('error_code'))) {
  window.history.replaceState(null, '', '/set-password' + window.location.hash);
}
export {};
