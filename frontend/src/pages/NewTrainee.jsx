import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { Card, Icon } from '../components/ui.jsx';
import RegistrationForm from '../components/RegistrationForm.jsx';
import { api } from '../utils/api.js';
import VerticalIdCard from '../components/VerticalIdCard.jsx';

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
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      notify('Registration link copied.');
    } catch {
      notify(link);
    }
  };

  return (
    <div className="card reg-qr-card">
      <div className="reg-qr-inner">
        <div className="qr-canvas" ref={box}>
          <QRCodeCanvas value={link} size={150} fgColor="#1F2430" bgColor="#ffffff" includeMargin />
        </div>
        <div className="reg-qr-text">
          <div className="card-title">
            <Icon name="qr" size={17} /> Trainee self-registration QR
          </div>
          <p className="muted" style={{ margin: '6px 0 10px' }}>
            Show or print this QR. A trainee scans it with their phone, fills their own details, and the record appears here as pending review.
            {!config.registrationOpen && (
              <strong style={{ color: 'var(--red, #ef4444)' }}>
                {' '}Registration is currently CLOSED (Super Admin can open it in Admin Console).
              </strong>
            )}
          </p>
          <div className="qr-link">{link}</div>
          <div className="qr-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn btn-ghost btn-sm" onClick={download}>
              <Icon name="download" size={14} /> Download QR
            </button>
            <button className="btn btn-ghost btn-sm" onClick={copy}>
              <Icon name="copy" size={14} /> Copy link
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
              <Icon name="print" size={14} /> Print
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewTrainee() {
  const { navigate, notify, config } = useStore();
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showIdCard, setShowIdCard] = useState(false);
  const qrRef = useRef(null);

  const submit = async (d) => {
    setBusy(true);
    setErrorMsg('');
    try {
      // Connect directly to MongoDB via the backend registration endpoint
      const res = await api('/api/public/register', {
        method: 'POST',
        body: {
          ...d,
          traineeId: String(d.traineeId || '').trim().toUpperCase(),
          aadhar: String(d.aadhar || '').trim(),
          joiningDate: d.joiningDate,
        },
        auth: false,
      });

      notify(`Trainee ${d.name} (${res.traineeId}) registered successfully and saved to MongoDB.`);
      setDone({
        hostelId: res.hostelId,
        traineeId: res.traineeId,
        qrId: res.qrId,
        name: d.name,
        photo: d.photo,
        mobile: d.mobile,
        qualification: d.qualification,
        joiningDate: d.joiningDate,
        hostel: d.hostel,
        roomNo: d.roomNo,
      });
    } catch (err) {
      setErrorMsg(err.message || 'Registration failed.');
      notify(err.message || 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = () => {
    if (!qrRef.current) return;
    const a = document.createElement('a');
    a.href = qrRef.current.querySelector('canvas').toDataURL('image/png');
    a.download = `QR-${done.traineeId}.png`;
    a.click();
  };

  if (done) {
    return (
      <div className="card form-card">
        <div className="card-body qr-card-body" style={{ textAlign: 'center', padding: 28 }}>
          <div className="kpi-icon" style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto' }}>
            <Icon name="check" size={28} />
          </div>
          <h2 style={{ marginTop: 16 }}>Registration Saved to Database</h2>
          <p className="muted" style={{ marginTop: 8, fontSize: 14 }}>
            Hostel ID: <strong>{done.hostelId}</strong> · Trainee ID: <strong>{done.traineeId}</strong> · QR ID: <strong>{done.qrId}</strong>
          </p>
          <p className="muted" style={{ marginTop: 4 }}>
            Status: <span className="chip chip-orange">PENDING APPROVAL</span>. Authorized approvers have been notified by email.
          </p>

          <div className="qr-canvas" ref={qrRef} style={{ margin: '18px auto' }}>
            <QRCodeCanvas value={done.qrId} size={160} fgColor="#1F2430" bgColor="#ffffff" includeMargin />
            <div className="qr-id" style={{ marginTop: 6, fontWeight: 700 }}>{done.qrId}</div>
          </div>

          <div className="qr-actions" style={{ justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setShowIdCard(true)}>
              <Icon name="idCard" size={14} /> ID Card (Download & Print)
            </button>
            <button className="btn btn-ghost" onClick={downloadQr}>
              <Icon name="download" size={14} /> Download Attendance QR
            </button>
            <button className="btn btn-ghost" onClick={() => setDone(null)}>
              Register Another Trainee
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('review', { id: done.traineeId })}>
              <Icon name="check" size={14} /> Open Trainee Review
            </button>
          </div>
        </div>
        {showIdCard && <VerticalIdCard trainee={done} onClose={() => setShowIdCard(false)} />}
      </div>
    );
  }

  return (
    <>
      <RegisterQrCard />
      <div className="card form-card">
        <div className="card-head">
          <div className="card-title">New Trainee Registration</div>
          <div className="card-sub">
            Fill the official registration form — submitted data saves directly into MongoDB and generates an attendance QR.
          </div>
        </div>

        {errorMsg && (
          <div className="alert-banner bad" style={{ margin: '14px 20px 0' }}>
            <Icon name="alert" size={18} />
            <div className="alert-text"><strong>Submission Error:</strong> {errorMsg}</div>
          </div>
        )}

        <RegistrationForm
          customFields={config.customFields}
          onSubmit={submit}
          busy={busy}
          submitText={busy ? 'Saving to Database…' : 'Submit Registration'}
          note="Saved directly to MongoDB. A unique QR is generated and approvers are notified."
        />
      </div>
    </>
  );
}
