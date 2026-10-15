// Invite and password-reset links land with the session (or an error) in the URL hash, on whatever
// page Supabase redirected to: show the choose-a-password page. The hash stays for supabase-js.
const hash = new URLSearchParams(window.location.hash.slice(1));
if ((/^(invite|recovery)$/.test(hash.get('type') ?? '') || hash.has('error_code')) && window.location.pathname !== '/set-password') {
  window.history.replaceState(null, '', '/set-password' + window.location.hash);
}
export {};
