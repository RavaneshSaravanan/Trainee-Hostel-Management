import { useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import { Icon } from '../components/ui.jsx';

export default function Login() {
  const { login, config } = useStore();

  // Mode: 'login' | 'forgot'
  const [mode, setMode] = useState('login');

  // Login form state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Forgot password form state
  const [forgotStep, setForgotStep] = useState(1); // 1 = enter identifier, 2 = enter OTP & new password
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [destination, setDestination] = useState('');
  const [devOtp, setDevOtp] = useState('');

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleSendOtp = async (e) => {
    e.preventDefault();
    if (!identifier.trim()) {
      setError('Please enter your username, email, or mobile number.');
      return;
    }
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api('/api/auth/forgot-password/send-otp', {
        method: 'POST',
        body: { identifier: identifier.trim() },
        auth: false,
      });
      setDestination(res.destination || '');
      setDevOtp(res.devOtp || '');
      setSuccessMsg(res.message || 'OTP sent successfully.');
      setForgotStep(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtpAndReset = async (e) => {
    e.preventDefault();
    if (!otp.trim()) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }
    if (!newPassword || newPassword.length < 4) {
      setError('New password must be at least 4 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }

    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api('/api/auth/forgot-password/verify-otp', {
        method: 'POST',
        body: {
          identifier: identifier.trim(),
          otp: otp.trim(),
          newPassword,
        },
        auth: false,
      });
      setSuccessMsg(res.message || 'Password reset successfully! Please sign in.');
      setMode('login');
      setUsername(identifier.trim());
      setPassword('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
      setForgotStep(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
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

        {mode === 'login' ? (
          <>
            <p className="login-desc">Sign in to manage trainee stays, allocations and daily attendance across all hostels.</p>
            {successMsg && (
              <div className="notice" style={{ marginBottom: 14, color: 'var(--green, #16a34a)', background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                {successMsg}
              </div>
            )}
            <form onSubmit={handleLogin}>
              <label className="field-label">Username</label>
              <input
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                autoComplete="username"
                required
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
                <label className="field-label" style={{ margin: 0 }}>Password</label>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    color: 'var(--primary, #7c3aed)',
                    cursor: 'pointer',
                    fontSize: 13,
                    textDecoration: 'underline',
                  }}
                  onClick={() => {
                    setMode('forgot');
                    setForgotStep(1);
                    setIdentifier(username);
                    setError('');
                    setSuccessMsg('');
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
          </>
        ) : (
          /* Forgot Password View */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Reset Password</h3>
              <button
                type="button"
                className="btn btn-ghost btn-xs"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                ← Back to Sign in
              </button>
            </div>

            {forgotStep === 1 ? (
              <form onSubmit={handleSendOtp}>
                <p className="login-desc" style={{ marginBottom: 16 }}>
                  Enter your Username, registered Email ID, or Mobile number. We will send an OTP verification code to reset your password.
                </p>

                <label className="field-label">Username, Email, or Mobile</label>
                <input
                  className="input"
                  placeholder="e.g. superadmin, user@example.com, or 9876543210"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoCapitalize="none"
                  autoFocus
                  required
                />

                {error && <div className="notice" style={{ marginTop: 14, color: 'var(--red)' }}>{error}</div>}

                <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} type="submit" disabled={busy}>
                  {busy ? 'Sending OTP…' : 'Send Verification OTP'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyOtpAndReset}>
                <p className="login-desc" style={{ marginBottom: 12 }}>
                  Verification code sent to <strong>{destination || identifier}</strong>.
                </p>

                {devOtp && (
                  <div
                    style={{
                      background: '#f3e8ff',
                      color: '#6b21a8',
                      border: '1px dashed #c084fc',
                      borderRadius: 8,
                      padding: '8px 12px',
                      fontSize: 13,
                      marginBottom: 14,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>Verification OTP: <strong>{devOtp}</strong></span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      style={{ padding: '2px 8px' }}
                      onClick={() => setOtp(devOtp)}
                    >
                      Use code
                    </button>
                  </div>
                )}

                <label className="field-label">6-Digit OTP Code</label>
                <input
                  className="input"
                  placeholder="Enter 6-digit code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  maxLength={6}
                  required
                  autoFocus
                />

                <label className="field-label" style={{ marginTop: 12 }}>New Password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="At least 4 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={4}
                  required
                />

                <label className="field-label" style={{ marginTop: 12 }}>Confirm New Password</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={4}
                  required
                />

                {error && <div className="notice" style={{ marginTop: 14, color: 'var(--red)' }}>{error}</div>}

                <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} type="submit" disabled={busy}>
                  {busy ? 'Resetting Password…' : 'Reset Password & Sign in'}
                </button>

                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <button
                    type="button"
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--primary, #7c3aed)',
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                    onClick={handleSendOtp}
                    disabled={busy}
                  >
                    Didn't receive code? Resend OTP
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
