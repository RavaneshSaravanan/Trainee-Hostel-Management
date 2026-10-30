import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Icon } from '../components/ui.jsx';

export default function Login() {
  const { login, config } = useStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

          <label className="field-label" style={{ marginTop: 14 }}>Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {error && <div className="notice" style={{ marginTop: 14, color: 'var(--red)' }}>{error}</div>}

          <button className="btn btn-primary btn-block" style={{ marginTop: 22 }} type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
