import { lazy, Suspense } from 'react';
import { BrowserRouter, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { prefetchClimberRoute } from '../../lib/climberPage';
import { I18nProvider, useI18n } from '../../lib/i18n';
import { supabaseConfigured } from '../../lib/supabase';
import { useFavoriteAlerts } from '../../lib/useFavoriteAlerts';
import { CompetitionPage } from '../../pages/CompetitionPage';
import { Home } from '../../pages/Home';
import { Live } from '../../pages/Live';
// in the first download, like Home: a cold load of /rankings asks for its data without waiting for a page chunk
import { Rankings } from '../../pages/Rankings';
import { RoundResults } from '../../pages/RoundResults';

const loadClimber = () => import('../../pages/Climber');
const Climber = lazy(() => loadClimber().then((m) => ({ default: m.Climber })));
prefetchClimberRoute(location.pathname, loadClimber);
const Favorites = lazy(() => import('../../pages/Favorites').then((m) => ({ default: m.Favorites })));
const Calendar = lazy(() => import('../../pages/Calendar').then((m) => ({ default: m.Calendar })));
const Screen = lazy(() => import('../../pages/Screen').then((m) => ({ default: m.Screen })));
const Search = lazy(() => import('../../pages/Search').then((m) => ({ default: m.Search })));
/** The public app: view only, no sign-in (like the IFSC app). Staff work happens in the staff app. */
export function ViewerApp() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          {/* the venue screen has no top bar: outside the layout */}
          <Route path="screen/:competitionId" element={<Suspense fallback={null}><Screen /></Suspense>} />
          <Route element={<ViewerLayout />}>
            <Route index element={<Home />} />
            <Route path="competitions" element={<Live />} />
            <Route path="competition/:id" element={<CompetitionPage bigScreen />} />
            <Route path="round/:id" element={<RoundResults />} />
            <Route path="climber/:id" element={<Climber />} />
            <Route path="favorites" element={<Favorites />} />
            <Route path="search" element={<Search />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="rankings" element={<Rankings />} />
            <Route path="*" element={<Home />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}

const STAFF_URL = import.meta.env.VITE_STAFF_URL as string | undefined;

function ViewerLayout() {
  const { t, lang, setLang } = useI18n();
  useFavoriteAlerts(); // alerts for starred climbers while the app is open (off until switched on on the favorites page)
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">{t('appName')}</NavLink>
          <nav className="nav">
            <NavLink to="/competitions">{t('competitions')}</NavLink>
            <NavLink to="/rankings">{t('rankings')}</NavLink>
            <NavLink to="/favorites" aria-label={t('favorites')}>★ {t('favorites')}</NavLink>
            <NavLink to="/search" aria-label={t('search')}>🔍</NavLink>
          </nav>
          <div className="nav-end">
            <button className="link" onClick={() => setLang(lang === 'he' ? 'en' : 'he')}>{lang === 'he' ? 'EN' : 'עב'}</button>
            {STAFF_URL && <a className="muted small" href={STAFF_URL}>{t('staffApp')}</a>}
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
