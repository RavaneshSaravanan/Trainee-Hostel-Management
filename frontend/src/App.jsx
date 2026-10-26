import { useEffect, useState } from 'react';
import { useStore } from './store.jsx';
import Layout, { navItems } from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Trainees from './pages/Trainees.jsx';
import NewTrainee from './pages/NewTrainee.jsx';
import TraineeProfile from './pages/TraineeProfile.jsx';
import Attendance from './pages/Attendance.jsx';
import { Leave, OutingVacate, Resignation, Remarks } from './pages/Records.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';
import Console from './pages/Console.jsx';

// ROUTES: view name -> page component. Add a page by adding a line here, in data/defaults.js (PAGES) and it shows in the sidebar.
const ROUTES = {
  dashboard: Dashboard,
  trainees: Trainees,
  'trainee-new': NewTrainee,
  'trainee-profile': TraineeProfile,
  attendance: Attendance,
  leave: Leave,
  'outing-vacate': OutingVacate,
  resignation: Resignation,
  remarks: Remarks,
  reports: Reports,
  settings: Settings,
  console: Console,
};

export default function App() {
  const { session, route, toast, booting, can, config } = useStore();
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  // Public self-registration page (the QR for new trainees opens this) — no login.
  if (hash.startsWith('#/register')) return <Register />;
  if (booting) return <div className="boot">Loading…</div>;

  // Role permissions: if the current page is not allowed, fall back to the first allowed one.
  const allowed = session ? navItems(config, can) : [];
  const view = !session ? '' : can(route.view) ? route.view : (allowed[0] || {}).id;
  const Page = ROUTES[view] || Dashboard;
  return (
    <>
      {session ? (
        view ? <Layout><Page key={route.params.id || view} /></Layout> : <div className="boot">Your role has no pages assigned. Ask the Super Admin.</div>
      ) : (
        <Login />
      )}
      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </>
  );
}
