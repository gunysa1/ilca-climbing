// The viewer's Supabase client: only reading (PostgREST) and live updates (Realtime), the two parts
// the view-only app uses. supabase-js also bundles sign-in and storage (~135 KB the viewer never
// runs). vite.config.ts swaps this in for lib/supabase in the viewer build; the staff app keeps
// supabase-js. Requests carry the publishable key the same way supabase-js sends it.
import { PostgrestClient } from '@supabase/postgrest-js';
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

const base = url ?? 'http://localhost:54321';
const key = anonKey ?? 'missing-anon-key';
const rest = new PostgrestClient(`${base}/rest/v1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
const realtime = new RealtimeClient(`${base.replace(/^http/, 'ws')}/realtime/v1`, {
  params: { apikey: key }, accessToken: async () => key,
});
void realtime.setAuth(key);

export const supabase = {
  from: rest.from.bind(rest),
  rpc: rest.rpc.bind(rest),
  channel: (name: string) => realtime.channel(name),
  removeChannel: (channel: RealtimeChannel) => realtime.removeChannel(channel),
};
