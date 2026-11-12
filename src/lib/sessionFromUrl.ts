// Which URLs may sign this device in from their hash (supabase-js detectSessionInUrl).
// Only the choose-a-password page, for an invite or password-reset link, or the error those links
// return. Anywhere else a hash session is ignored, so a crafted link cannot silently swap the account
// a judge's phone is signed in with (authLink.ts moves real invite/reset links to /set-password first).
export function acceptSessionFromUrl(url: URL, params: Record<string, string>): boolean {
  if (url.pathname !== '/set-password') return false;
  if (params.error_description || params.error_code) return true;
  return Boolean(params.access_token) && (params.type === 'invite' || params.type === 'recovery');
}
