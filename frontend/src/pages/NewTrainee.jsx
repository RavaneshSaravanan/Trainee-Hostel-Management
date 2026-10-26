import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { Card, Icon } from '../components/ui.jsx';
import RegistrationForm from '../components/RegistrationForm.jsx';

export const registerLink = () => `${window.location.origin}${window.location.pathname}#/register`;

// Shown at the top of "New Trainee": trainees scan this with their own phone and fill their details.
function RegisterQrCard() {
  const { config, notify } = useStore();
  const box = useRef(null);
  const link = registerLink();
  const download = () => {
    const a = document.createElement('a');
    a.href = box.current.querySelector('canvas').toDataURL('image/png');
    a.download = 'trainee-registration-qr.png';
    a.click();
  };
  const copy = async () => { try { await navigator.clipboard.writeText(link); notify('Link copied.'); } catch { notify(link); } };
  return (
    <div className="card reg-qr-card">
      <div className="reg-qr-inner">
        <div className="qr-canvas" ref={box}><QRCodeCanvas value={link} size={150} fgColor="#1F2430" bgColor="#ffffff" includeMargin /></div>
        <div className="reg-qr-text">
          <div className="card-title"><Icon name="qr" size={17} /> Trainee self-registration QR</div>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Show or print this QR. A trainee scans it with their phone, fills their own details, and the record appears here as pending review.
            {!config.registrationOpen && <strong style={{ color: 'var(--red)' }}> Registration is currently CLOSED (Super Admin can open it in Admin Console).</strong>}
          </p>
          <div className="qr-link">{link}</div>
          <div className="qr-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn btn-ghost btn-sm" onClick={download}><Icon name="download" size={14} /> Download QR</button>
            <button className="btn btn-ghost btn-sm" onClick={copy}><Icon name="copy" size={14} /> Copy link</button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Icon name="print" size={14} /> Print</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewTrainee() {
  const { addTrainee, navigate, notify, config } = useStore();
  const [done, setDone] = useState(null);

  const submit = (d) => {
    const res = addTrainee({ ...d, joiningDate: d.joiningDate });
    if (!res.ok) { notify(res.error); return; }
    setDone({ hostelId: res.hostelId, traineeId: d.traineeId, qrId: res.qrId });
  };

  if (done) {
    return (
      <div className="card form-card">
        <div className="card-body qr-card-body">
          <div className="kpi-icon" style={{ width: 52, height: 52, borderRadius: 16 }}><Icon name="check" size={26} /></div>
          <h2 style={{ marginTop: 14 }}>Registration submitted successfully.</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            Hostel ID: <strong>{done.hostelId}</strong> · Trainee ID: <strong>{done.traineeId}</strong> · QR ID: <strong>{done.qrId}</strong>
          </p>
          <p className="muted" style={{ marginTop: 4 }}>Status: PENDING REVIEW. The QR is already generated; a hostel and room are allocated on approval.</p>
          <div className="qr-actions">
            <button className="btn btn-ghost" onClick={() => setDone(null)}>Register another</button>
            <button className="btn btn-primary" onClick={() => navigate('trainees', { tab: 'pending' })}>Go to Pending Review</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <RegisterQrCard />
      <div className="card form-card">
        <div className="card-head">
          <div className="card-title">New Trainee Registration</div>
          <div className="card-sub">Or fill it yourself here — the trainee does not need a login.</div>
        </div>
        <RegistrationForm customFields={config.customFields} onSubmit={submit} note="A QR is generated automatically. Hostel and room are allocated later." />
      </div>
    </>
  );
}
