import { BrowserRouter, Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { RequireRole } from '../../components/RequireRole';
import { AuthProvider, useAuth } from '../../lib/auth';
import { I18nProvider, useI18n } from '../../lib/i18n';
import { supabase, supabaseConfigured } from '../../lib/supabase';
import { Climber } from '../../pages/Climber';
import { Coach } from '../../pages/Coach';
import { CompetitionPage } from '../../pages/CompetitionPage';
import { JudgeBoulder, JudgeHome } from '../../pages/Judge';
import { Login } from '../../pages/Login';
import { Rankings } from '../../pages/Rankings';
import { RoundResults } from '../../pages/RoundResults';
import { Search } from '../../pages/Search';
import { AdminCompetition } from '../../pages/admin/AdminCompetition';
import { AdminHome } from '../../pages/admin/AdminHome';
import { AdminPeople } from '../../pages/admin/AdminPeople';
import { AdminRankings } from '../../pages/admin/AdminRankings';
import { AdminRound } from '../../pages/admin/AdminRound';

/** The staff app: judges, coaches and admins. Sign-in first. */
export function StaffApp() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<StaffLayout />}>
              <Route path="login" element={<Login />} />
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
        <Outlet />
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
