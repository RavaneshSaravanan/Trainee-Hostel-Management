import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { api } from '../utils/api.js';
import { applyTheme } from '../utils/theme.js';
import { DEFAULT_CONFIG, withDefaults } from '../data/defaults.js';
import { Icon } from '../components/ui.jsx';
import RegistrationForm from '../components/RegistrationForm.jsx';

// PUBLIC page opened when a trainee scans the registration QR (#/register). No login needed.
export default function Register() {
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [state, setState] = useState('loading'); // loading | form | done | error
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/public', { auth: false })
      .then((p) => { const c = withDefaults(p); setCfg(c); applyTheme(c.theme); setState('form'); })
      .catch((e) => { setMsg(e.message); setState('error'); });
  }, []);

  const submit = async (d) => {
    setBusy(true); setMsg('');
    try { setDone(await api('/api/public/register', { method: 'POST', body: d, auth: false })); setState('done'); }
    catch (e) { setMsg(e.message); }
    setBusy(false);
  };

  return (
    <div className="public-wrap">
      <div className="card public-card">
        <div className="login-brand" style={{ padding: '18px 20px 0' }}>
          <div className="brand-mark">{cfg.logo ? <img src={cfg.logo} alt="" className="brand-logo" /> : <Icon name="home" size={26} />}</div>
          <div><div className="brand-title">{cfg.appName}</div><div className="brand-sub">Trainee registration</div></div>
        </div>
        {state === 'loading' && <div className="empty-state">Loading…</div>}
        {state === 'error' && <div className="empty-state">{msg}</div>}
        {state === 'form' && !cfg.registrationOpen && <div className="empty-state">Registration is closed right now. Please contact the hostel warden.</div>}
        {state === 'form' && cfg.registrationOpen && (
          <>
            {msg && <div className="notice" style={{ margin: '12px 20px 0' }}>{msg}</div>}
            <RegistrationForm customFields={cfg.customFields} onSubmit={submit} busy={busy} note="Your details are reviewed by the hostel warden." />
          </>
        )}
        {state === 'done' && done && (
          <div className="card-body qr-card-body">
            <div className="kpi-icon" style={{ width: 52, height: 52, borderRadius: 16 }}><Icon name="check" size={26} /></div>
            <h2 style={{ marginTop: 14 }}>Registered successfully</h2>
            <p className="muted" style={{ marginTop: 8 }}>Trainee ID <strong>{done.traineeId}</strong> · Hostel ID <strong>{done.hostelId}</strong></p>
            <p className="muted" style={{ margin: '4px 0 14px' }}>This is your attendance QR — take a screenshot and keep it. A room is allocated after approval.</p>
            <div className="qr-canvas"><QRCodeCanvas value={done.qrId} size={180} fgColor="#1F2430" bgColor="#ffffff" includeMargin /></div>
            <div className="qr-id">{done.qrId}</div>
          </div>
        )}
      </div>
    </div>
  );
}
