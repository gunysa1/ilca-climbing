import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { RequireRole } from '../../components/RequireRole';
import { AuthProvider, useAuth } from '../../lib/auth';
import { I18nProvider, useI18n } from '../../lib/i18n';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { CompetitionPage } from '../../pages/CompetitionPage';
import { JudgeBoulder, JudgeHome } from '../../pages/Judge';
import { AcceptInvite } from '../../pages/AcceptInvite';
import { Login } from '../../pages/Login';
import { SetPassword } from '../../pages/SetPassword';
import { RoundResults } from '../../pages/RoundResults';

// Admin, coach and the less used pages load when opened; the judge pad and results load with the app.
const Climber = lazy(() => import('../../pages/Climber').then((m) => ({ default: m.Climber })));
const Coach = lazy(() => import('../../pages/Coach').then((m) => ({ default: m.Coach })));
const Rankings = lazy(() => import('../../pages/Rankings').then((m) => ({ default: m.Rankings })));
const Search = lazy(() => import('../../pages/Search').then((m) => ({ default: m.Search })));
const AdminCompetition = lazy(() => import('../../pages/admin/AdminCompetition').then((m) => ({ default: m.AdminCompetition })));
const AdminHome = lazy(() => import('../../pages/admin/AdminHome').then((m) => ({ default: m.AdminHome })));
const AdminPeople = lazy(() => import('../../pages/admin/AdminPeople').then((m) => ({ default: m.AdminPeople })));
const AdminRankings = lazy(() => import('../../pages/admin/AdminRankings').then((m) => ({ default: m.AdminRankings })));
const AdminRound = lazy(() => import('../../pages/admin/AdminRound').then((m) => ({ default: m.AdminRound })));
/** The staff app: judges, coaches and admins. Sign-in first. */
export function StaffApp() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<StaffLayout />}>
              <Route path="login" element={<Login />} />
              <Route path="set-password" element={<SetPassword />} />
              <Route path="invite" element={<AcceptInvite />} />
              <Route element={<RequireRole><Outlet /></RequireRole>}>
                <Route index element={<StaffHome />} />
                <Route path="coach" element={<RequireRole role="coach"><Coach /></RequireRole>} />
                <Route path="judge" element={<RequireRole role="judge"><JudgeHome /></RequireRole>} />
                <Route path="judge/:roundId/:boulderId" element={<RequireRole role="judge"><JudgeBoulder /></RequireRole>} />
                <Route path="admin" element={<RequireRole role="admin"><AdminHome /></RequireRole>} />
                <Route path="admin/competition/:id" element={<RequireRole role="admin"><AdminCompetition /></RequireRole>} />
                <Route path="admin/round/:id" element={<RequireRole role="admin"><AdminRound /></RequireRole>} />
                <Route path="admin/people" element={<RequireRole role="admin"><AdminPeople /></RequireRole>} />
                <Route path="admin/rankings" element={<RequireRole role="admin"><AdminRankings /></RequireRole>} />
                {/* results, for judges and coaches at work */}
                <Route path="competition/:id" element={<CompetitionPage />} />
                <Route path="round/:id" element={<RoundResults />} />
                <Route path="climber/:id" element={<Climber />} />
                <Route path="search" element={<Search />} />
                <Route path="rankings" element={<Rankings />} />
                <Route path="*" element={<StaffHome />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}

const VIEWER_URL = import.meta.env.VITE_VIEWER_URL as string | undefined;

function StaffLayout() {
  const { t, lang, setLang } = useI18n();
  const { session, hasRole } = useAuth();
  return (
    <>
      <header className="topbar staff">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">{t('staffApp')}</NavLink>
          {session && (
            <nav className="nav">
              {hasRole('judge') && <NavLink to="/judge">{t('judge')}</NavLink>}
              {hasRole('coach') && <NavLink to="/coach">{t('coach')}</NavLink>}
              {hasRole('admin') && <NavLink to="/admin">{t('admin')}</NavLink>}
              <NavLink to="/search" aria-label={t('search')}>🔍</NavLink>
            </nav>
          )}
          <div className="nav-end">
            <button className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>{lang === 'he' ? 'EN' : 'עב'}</button>
            {VIEWER_URL && <a className="muted small" href={VIEWER_URL}>{t('viewerApp')}</a>}
            {session && <button className="link" onClick={() => supabase.auth.signOut()}>{t('logout')}</button>}
          </div>
        </div>
      </header>
      <main className="page">
        {!supabaseConfigured && <p className="notice">{t('notConfigured')}</p>}
        <Suspense fallback={<p className="muted">…</p>}><Outlet /></Suspense>
      </main>
    </>
  );
}

/** One tile per role the signed-in user has. */
function StaffHome() {
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const tiles = [
    hasRole('judge') && { to: '/judge', title: t('judge'), text: t('staffJudgeText') },
    hasRole('coach') && { to: '/coach', title: t('coach'), text: t('staffCoachText') },
    hasRole('admin') && { to: '/admin', title: t('admin'), text: t('staffAdminText') },
  ].filter((x): x is { to: string; title: string; text: string } => !!x);
  return (
    <section>
      <h1>{t('staffApp')}</h1>
      <ul className="cards">
        {tiles.map((x) => (
          <li key={x.to}><Link to={x.to} className="card"><span className="card-title">{x.title}</span><span className="muted">{x.text}</span></Link></li>
        ))}
      </ul>
      {tiles.length === 0 && <p className="muted">{t('noAccess')}</p>}
    </section>
  );
}
