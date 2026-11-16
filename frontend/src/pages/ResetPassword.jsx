import { useState, useEffect } from 'react';
import { api } from '../utils/api.js';
import { Icon } from '../components/ui.jsx';
import ModernLoader from '../components/ModernLoader.jsx';

export default function ResetPassword({ token }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('No reset token provided in URL.');
      setLoading(false);
      return;
    }

    api(`/api/auth/verify-reset-token/${encodeURIComponent(token)}`, { auth: false })
      .then((res) => {
        setUser(res.user);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message || 'This reset link is invalid or has expired.');
        setLoading(false);
      });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 4) {
      setError('Password must be at least 4 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await api('/api/auth/reset-password-with-token', {
        method: 'POST',
        body: { token, newPassword: password },
        auth: false,
      });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to reset password.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="login-screen">
        <ModernLoader text="Verifying Security Credentials" sub="Validating authorized password reset token..." size="md" />
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--purple-100)', color: 'var(--purple-700)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
            <Icon name="lock" size={22} />
          </div>
          <div className="login-title">Reset Your Password</div>
          <div className="login-sub">Apollo Tyres Ltd — Trainee Hostel Operations</div>
        </div>

        {error && (
          <div className="alert-banner bad" style={{ marginBottom: 16 }}>
            <Icon name="alert" size={16} />
            <div className="alert-text">{error}</div>
          </div>
        )}

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#dcfce7', color: '#15803d', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Icon name="check" size={26} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d', marginBottom: 6 }}>
              Password Reset Successfully!
            </div>
            <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
              Your account password has been updated securely. You can now log in using your new credentials.
            </p>
            <a href="#/" className="btn btn-primary btn-block">
              Go to Login
            </a>
          </div>
        ) : user ? (
          <form onSubmit={handleSubmit}>
            <div style={{ background: 'var(--purple-50)', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--purple-200)', marginBottom: 16, fontSize: 13 }}>
              Setting new password for <strong>{user.name}</strong> (@{user.username})
            </div>

            <label className="field-label">New Password</label>
            <input
              className="input"
              type="password"
              placeholder="Enter new password (min. 4 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={4}
              autoFocus
            />

            <label className="field-label" style={{ marginTop: 12 }}>Confirm New Password</label>
            <input
              className="input"
              type="password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={4}
            />

            <button
              type="submit"
              className="btn btn-primary btn-block"
              style={{ marginTop: 20, minHeight: 42 }}
              disabled={submitting}
            >
              {submitting ? <ModernLoader type="button" text="Updating Password…" /> : 'Set New Password'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <a href="#/" className="link" style={{ fontSize: 12.5 }}>
                Return to Login
              </a>
            </div>
          </form>
        ) : (
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <a href="#/" className="btn btn-ghost btn-block">
              Return to Login
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
