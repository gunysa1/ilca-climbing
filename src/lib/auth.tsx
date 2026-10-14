import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase, supabaseConfigured } from './supabase';
import type { AppRole } from './types';

interface Auth {
  session: Session | null;
  roles: AppRole[];
  /** The caller's profile id (equals the account id for self-signups, not for linked imported profiles). */
  profileId: string | null;
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    if (!session) { setRoles([]); setProfileId(null); setLoading(false); return; }
    setLoading(true);
    // RLS returns only the caller's own roles; profiles are public, user_id identifies ours.
    Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', session.user.id),
      supabase.from('profiles').select('id').eq('user_id', session.user.id).maybeSingle(),
    ]).then(([{ data: roleRows }, { data: profile }]) => {
      setRoles((roleRows ?? []).map((r) => r.role as AppRole));
      setProfileId(profile?.id ?? null);
      setLoading(false);
    });
  }, [session]);

  // Admins implicitly hold every role for navigation purposes.
  const hasRole = (r: AppRole) => roles.includes(r) || roles.includes('admin');
  return <Ctx.Provider value={{ session, roles, profileId, loading, hasRole }}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
