import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { supabase, supabaseConfigured } from '../lib/supabase';

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { session, hasRole } = useAuth();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">{t('appName')}</NavLink>
          <nav className="nav">
            <NavLink to="/" end>{t('live')}</NavLink>
            {session && <NavLink to="/me">{t('myHistory')}</NavLink>}
            {hasRole('coach') && <NavLink to="/coach">{t('coach')}</NavLink>}
            {hasRole('judge') && <NavLink to="/judge">{t('judge')}</NavLink>}
            {hasRole('admin') && <NavLink to="/admin">{t('admin')}</NavLink>}
          </nav>
          <div className="nav-end">
            <button className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>
              {lang === 'he' ? 'EN' : 'עב'}
            </button>
            {session
              ? <button className="link" onClick={() => supabase.auth.signOut()}>{t('logout')}</button>
              : <NavLink to="/login">{t('login')}</NavLink>}
          </div>
        </div>
      </header>
      <main className="page">
        {!supabaseConfigured && <p className="notice">{t('notConfigured')}</p>}
        <Outlet />
      </main>
    </>
  );
}
