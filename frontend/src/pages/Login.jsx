import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Icon, Modal } from '../components/ui.jsx';
import { api } from '../utils/api.js';

export default function Login() {
  const { login, config } = useStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Forgot password state
  const [showForgot, setShowForgot] = useState(false);
  const [forgotId, setForgotId] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotErr, setForgotErr] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!forgotId.trim()) return;
    setForgotBusy(true);
    setForgotErr('');
    setForgotMsg('');
    try {
      const res = await api('/api/auth/forgot-password', {
        method: 'POST',
        body: { identifier: forgotId.trim() },
        auth: false,
      });
      setForgotMsg(res.message || 'If an account exists, a reset link has been dispatched to your email.');
    } catch (err) {
      setForgotErr(err.message || 'Failed to dispatch reset email. Please try again.');
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">
            {config.logo ? <img src={config.logo} alt="" className="brand-logo" /> : <Icon name="home" size={26} />}
          </div>
          <div>
            <div className="brand-title">{config.appName}</div>
            <div className="brand-sub">{config.appSub}</div>
          </div>
        </div>

        <p className="login-desc">Sign in to manage trainee stays, allocations and daily attendance across all hostels.</p>

        <form onSubmit={handleLogin}>
          <label className="field-label">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoCapitalize="none"
            autoComplete="username"
            required
            autoFocus
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
            <label className="field-label" style={{ margin: 0 }}>Password</label>
            <button
              type="button"
              className="btn-link"
              style={{ fontSize: 12, color: 'var(--purple-600)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={() => {
                setShowForgot(true);
                setForgotId(username);
                setForgotMsg('');
                setForgotErr('');
              }}
            >
              Forgot password?
            </button>
          </div>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            style={{ marginTop: 6 }}
          />

          {error && <div className="notice" style={{ marginTop: 14, color: 'var(--red)' }}>{error}</div>}

          <button className="btn btn-primary btn-block" style={{ marginTop: 22 }} type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      {/* Forgot Password Modal */}
      {showForgot && (
        <Modal title="Reset Your Password" onClose={() => setShowForgot(false)}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Enter your registered username or email address. We will dispatch a secure, single-use password reset link via Resend.
          </p>

          {forgotMsg ? (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16, textAlign: 'center', color: '#166534', fontSize: 13.5 }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>✉️</div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Check Your Inbox</div>
              <div>{forgotMsg}</div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: 16 }}
                onClick={() => setShowForgot(false)}
              >
                Return to Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleForgotSubmit}>
              <label className="field-label">Username or Email Address *</label>
              <input
                className="input"
                type="text"
                value={forgotId}
                onChange={(e) => setForgotId(e.target.value)}
                placeholder="e.g. admin or yourname@example.com"
                required
                autoFocus
                disabled={forgotBusy}
              />

              {forgotErr && (
                <div style={{ color: '#dc2626', fontSize: 12.5, marginTop: 8 }}>
                  {forgotErr}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setShowForgot(false)}
                  disabled={forgotBusy}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={forgotBusy || !forgotId.trim()}
                >
                  {forgotBusy ? 'Sending Reset Link…' : 'Send Reset Link'}
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
