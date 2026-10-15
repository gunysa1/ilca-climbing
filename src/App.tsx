import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireRole } from './components/RequireRole';
import { AuthProvider } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import { Climber } from './pages/Climber';
import { Coach } from './pages/Coach';
import { Favorites } from './pages/Favorites';
import { CompetitionPage } from './pages/CompetitionPage';
import { JudgeBoulder, JudgeHome } from './pages/Judge';
import { Live } from './pages/Live';
import { Login } from './pages/Login';
import { Me } from './pages/Me';
import { AdminCompetition } from './pages/admin/AdminCompetition';
import { AdminHome } from './pages/admin/AdminHome';
import { AdminPeople } from './pages/admin/AdminPeople';
import { AdminRankings } from './pages/admin/AdminRankings';
import { AdminRound } from './pages/admin/AdminRound';
import { RoundResults } from './pages/RoundResults';
import { Search } from './pages/Search';
import { Rankings } from './pages/Rankings';

export function App() {
  return (
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              {/* public */}
              <Route index element={<Live />} />
              <Route path="competition/:id" element={<CompetitionPage />} />
              <Route path="round/:id" element={<RoundResults />} />
              <Route path="climber/:id" element={<Climber />} />
              <Route path="favorites" element={<Favorites />} />
              <Route path="search" element={<Search />} />
              <Route path="rankings" element={<Rankings />} />
              <Route path="login" element={<Login />} />
              {/* signed-in roles */}
              <Route path="me" element={<RequireRole><Me /></RequireRole>} />
              <Route path="coach" element={<RequireRole role="coach"><Coach /></RequireRole>} />
              <Route path="judge" element={<RequireRole role="judge"><JudgeHome /></RequireRole>} />
              <Route path="judge/:roundId/:boulderId" element={<RequireRole role="judge"><JudgeBoulder /></RequireRole>} />
              <Route path="admin" element={<RequireRole role="admin"><AdminHome /></RequireRole>} />
              <Route path="admin/competition/:id" element={<RequireRole role="admin"><AdminCompetition /></RequireRole>} />
              <Route path="admin/round/:id" element={<RequireRole role="admin"><AdminRound /></RequireRole>} />
              <Route path="admin/people" element={<RequireRole role="admin"><AdminPeople /></RequireRole>} />
              <Route path="admin/rankings" element={<RequireRole role="admin"><AdminRankings /></RequireRole>} />
              <Route path="*" element={<Live />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  );
}
