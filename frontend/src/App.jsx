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
import TraineeReview from './pages/TraineeReview.jsx';
import ValidityReport from './pages/ValidityReport.jsx';
import TraineeCardVerify from './pages/TraineeCardVerify.jsx';
import ModernLoader from './components/ModernLoader.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import { api } from './utils/api.js';

// ROUTES: view name -> page component. Add a page by adding a line here, in data/defaults.js (PAGES) and it shows in the sidebar.
const ROUTES = {
  dashboard: Dashboard,
  trainees: Trainees,
  'trainee-new': NewTrainee,
  'trainee-profile': TraineeProfile,
  review: TraineeReview,
  attendance: Attendance,
  leave: Leave,
  'outing-vacate': OutingVacate,
  resignation: Resignation,
  remarks: Remarks,
  validity: ValidityReport,
  reports: Reports,
  settings: Settings,
  console: Console,
};


function ForcePasswordChangeModal({ onComplete }) {
  const { notify } = useStore();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 4) {
      setError('New password must be at least 4 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api('/api/users/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      notify('✓ Password changed successfully.');
      onComplete();
    } catch (err) {
      setError(err.message || 'Failed to update password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <form className="modal" onSubmit={handleSubmit} style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <div className="modal-title">🔒 Password Change Required</div>
        </div>
        <div className="modal-body">
          <div className="notice" style={{ margin: '0 0 16px' }}>
            Your account administrator requires you to set a new personal password before continuing.
          </div>
          {error && <div className="notice" style={{ color: 'var(--red)', margin: '0 0 12px' }}>{error}</div>}
          <label className="field-label">Current Password</label>
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            autoFocus
          />
          <label className="field-label" style={{ marginTop: 12 }}>New Password (min. 4 characters)</label>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={4}
          />
          <label className="field-label" style={{ marginTop: 12 }}>Confirm New Password</label>
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>
        <div className="modal-foot">
          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Updating Password…' : 'Update Password & Continue'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const { session, route, toast, booting, can, config } = useStore();
  const [hash, setHash] = useState(window.location.hash);
  const [mustChange, setMustChange] = useState(Boolean(session?.mustChangePassword));
  useEffect(() => {
    const h = () => setHash(window.location.hash);
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  // Public self-registration page (the QR for new trainees opens this) — no login.
  // Public secure password reset page (#/reset-password?token=...) — no login.
  if (hash.startsWith('#/reset-password')) {
    const query = hash.includes('?') ? hash.split('?')[1] : '';
    const params = new URLSearchParams(query);
    const token = params.get('token') || '';
    return <ResetPassword token={token} onComplete={() => { window.location.hash = '#/'; }} />;
  }
  if (hash.startsWith('#/register')) return <Register />;

  // Public ID card QR verification page (phone camera / normal QR reader) — no login.
  if (hash.startsWith('#/verify/')) {
    const verifyTraineeId = decodeURIComponent(hash.slice('#/verify/'.length).split('?')[0].trim());
    return <TraineeCardVerify traineeId={verifyTraineeId} />;
  }

  if (booting) return <ModernLoader type="fullscreen" text="Apollo Tyres Ltd — Trainee Hostel Management" sub="Initializing application environment & secure services..." size="lg" />;

  // Direct review link handling (#/review/:traineeId)
  if (hash.startsWith('#/review/')) {
    const reviewTraineeId = decodeURIComponent(hash.slice('#/review/'.length).split('?')[0].trim());
    if (session) {
      return (
        <Layout>
          <TraineeReview traineeId={reviewTraineeId} />
        </Layout>
      );
    }
    return <Login />;
  }

  // Role permissions: if the current page is not allowed, fall back to the first allowed one.
  const allowed = session ? navItems(config, can) : [];
  const view = !session ? '' : can(route.view) ? route.view : (allowed[0] || {}).id;
  const Page = ROUTES[view] || Dashboard;
  return (
    <>
      {mustChange && <ForcePasswordChangeModal onComplete={() => setMustChange(false)} />}
      {session ? (
        view ? <Layout><Page key={route.params.id || view} /></Layout> : <div className="boot">Your role has no pages assigned. Ask the Super Admin.</div>
      ) : (
        <Login />
      )}
      <div id="toast" className={toast ? 'show' : ''}>{toast}</div>
    </>
  );
}
