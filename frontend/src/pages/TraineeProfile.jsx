import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { QUALIFICATIONS, SHIFTS } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Table, formData } from '../components/ui.jsx';
import { CustomInput } from '../components/RegistrationForm.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import { missingDetails } from '../utils/details.js';
import { resizeImage } from '../utils/image.js';
import { ApproveModal, ChangeRoomModal } from '../components/RoomModals.jsx';
import VerticalIdCard from '../components/VerticalIdCard.jsx';
import { addDays, fmtDate, todayStr } from '../utils/dates.js';
import { computeSummary } from '../utils/summary.js';

/* ---------------- Overview ---------------- */
function Overview({ t }) {
  const { db, config, navigate } = useStore();
  const missing = missingDetails(t, config.customFields);
  const info = [
    ['Trainee ID', t.traineeId], ['Hostel ID', t.hostelId || '—'], ['Mobile', t.mobile], ['E-mail', t.email || '—'],
    ['Date of Birth', fmtDate(t.dob)], ['Gender', t.gender], ['Qualification', t.qualification], ['Aadhar No.', t.aadhar],
    ['Food', t.food], ['Joining Date', fmtDate(t.joiningDate)], ['Address', t.address1 || '—'],
    ['State', t.state || '—'], ['Guardian Name', t.guardianName || '—'], ['Guardian Contact', t.guardianContact || '—'],
    ['Default Shift', t.defaultShift], ['Employment Status', t.employmentStatus], ['Hostel Status', t.hostelStatus],
    ['Hostel', t.hostel || '—'], ['Room No.', t.roomNo || '—'], ['QR ID', t.qrId || '—'], ['QR Status', t.qrStatus],
    ['Approved By', t.approvedBy || '—'], ['Remarks', t.remarks || '—'],
    ...config.customFields.map((f) => [f.label, (t.custom || {})[f.id] || '—']),
  ];
  const history = db.roomHistory.filter((h) => h.traineeId === t.traineeId);
  return (
    <div className="grid-2">
      <Card title="Personal & Hostel Details">
        {missing.length > 0 ? (
          <div className="alert-banner bad" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={18} />
            <div className="alert-text"><strong>Details pending:</strong> {missing.join(', ')}</div>
            <button className="btn btn-danger btn-sm" onClick={() => navigate('trainee-profile', { id: t.traineeId, sub: 'edit' })}>Fill now</button>
          </div>
        ) : <div className="alert-banner good" style={{ marginBottom: 14 }}><Icon name="check" size={18} /><div className="alert-text">All details complete</div></div>}
        <div className="info-grid">
          {info.map(([k, v]) => (
            <div className="info-item" key={k}><div className="info-k">{k}</div><div className="info-v">{v}</div></div>
          ))}
        </div>
      </Card>
      <Card title="Room History" noPad>
        <Table
          headers={['Date', 'From', 'To', 'Changed By']}
          empty="No room allocation yet."
          rows={history.map((h) => [
            fmtDate(h.changeDate),
            h.prevHostel ? `${h.prevHostel} · ${h.prevRoom}` : <span className="muted">New allocation</span>,
            `${h.newHostel} · ${h.newRoom}`,
            h.changedBy,
          ])}
        />
      </Card>
    </div>
  );
}

/* ---------------- Edit ---------------- */
function Edit({ t }) {
  const { updateTrainee, notify, navigate, config } = useStore();
  const [photo, setPhoto] = useState(t.photo || '');
  const submit = (e) => {
    const d = formData(e);
    delete d.photoFile;
    const custom = { ...(t.custom || {}) };
    config.customFields.forEach((f) => { custom[f.id] = d[`cf_${f.id}`] || ''; delete d[`cf_${f.id}`]; });
    updateTrainee(t.traineeId, { ...d, photo, custom });
    notify('Trainee details updated.');
    navigate('trainee-profile', { id: t.traineeId, sub: 'overview' });
  };
  const F = (label, name, props = {}) => (
    <div><label className="field-label">{label}</label><input className="input" name={name} defaultValue={t[name] === '—' ? '' : t[name]} {...props} /></div>
  );
  const S = (label, name, options) => (
    <div><label className="field-label">{label}</label>
      <select className="input" name={name} defaultValue={t[name]}>{options.map((o) => <option key={o}>{o}</option>)}</select>
    </div>
  );
  return (
    <div className="card form-card">
      <form onSubmit={submit}>
        <div className="form-section">
          <div className="form-section-title">Personal Details</div>
          <div className="form-grid">
            {F('Trainee Name', 'name', { required: true })}
            {F('Mobile No.', 'mobile', { required: true })}
            {F('E-mail', 'email', { type: 'email' })}
            {F('Date of Birth', 'dob', { type: 'date' })}
            {S('Gender', 'gender', ['Male', 'Female', 'Other'])}
            {S('Qualification', 'qualification', QUALIFICATIONS)}
            {F('Aadhar No.', 'aadhar')}
            {S('Food Preference', 'food', ['VEG', 'NON-VEG'])}
            <div style={{ gridColumn: 'span 2' }}>
              <label className="field-label">Photo</label>
              <PhotoCapture value={photo} onChange={setPhoto} />
            </div>
          </div>
        </div>
        <div className="form-section">
          <div className="form-section-title">Address</div>
          <div className="form-grid">
            <div className="span-2"><label className="field-label">Address Line 1</label><input className="input" name="address1" defaultValue={t.address1} /></div>
            {F('State', 'state', { span: true })}
          </div>
        </div>
        <div className="form-section">
          <div className="form-section-title">Guardian</div>
          <div className="form-grid">{F('Guardian Name', 'guardianName')}{F('Guardian Contact', 'guardianContact')}</div>
        </div>
        <div className="form-section">
          <div className="form-section-title">Employment & Joining Details</div>
          <div className="form-grid">
            {F('Joining Date *', 'joiningDate', { type: 'date', required: true })}
            {S('Default Shift', 'defaultShift', SHIFTS)}
            {S('Employment Status', 'employmentStatus', ['ACTIVE', 'RESIGNED'])}
            {F('Remarks (short note)', 'remarks')}
          </div>
        </div>
        {config.customFields.length > 0 && (
          <div className="form-section">
            <div className="form-section-title">Additional Details</div>
            <div className="form-grid">
              {config.customFields.map((f) => <div key={f.id}><label className="field-label">{f.label}{f.required ? ' *' : ''}</label><CustomInput f={f} value={(t.custom || {})[f.id]} /></div>)}
            </div>
          </div>
        )}
        <div className="form-foot">
          <div className="muted">Hostel status, room and QR are managed through Approve, Change Room and Outing / Vacate actions.</div>
          <button className="btn btn-primary" type="submit"><Icon name="check" size={15} /> Save Changes</button>
        </div>
      </form>
    </div>
  );
}

/* ---------------- History page 1: Attendance & Exit ---------------- */
function Page1({ t, range, setRange }) {
  const { db, navigate } = useStore();
  const { from, to } = range;
  const id = t.traineeId;

  const att = db.attendance.filter((a) => a.traineeId === id && a.date >= from && a.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));
  const leaves = db.leaves.filter((l) => l.traineeId === id && l.toDate >= from && l.fromDate <= to);
  const ov = db.outingVacate.filter((o) => {
    if (o.traineeId !== id || o.type === 'PERMANENT VACATE') return false;
    const end = o.expectedReturn || o.fromDate;
    return o.fromDate <= to && end >= from;
  });
  const perm = db.outingVacate.filter((o) => o.traineeId === id && o.type === 'PERMANENT VACATE'); // all of it, not range-limited
  const resign = db.resignations.filter((r) => r.traineeId === id);

  return (
    <>
      <Card title="Date Range">
        <div className="date-range-form">
          <div><label className="field-label">From Date</label><input className="input" type="date" value={from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></div>
          <div><label className="field-label">To Date</label><input className="input" type="date" value={to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></div>
          <button className="btn btn-ghost" onClick={() => navigate('attendance', { traineeId: id, date: todayStr() })}><Icon name="plus" size={15} /> Add Attendance</button>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Daily Attendance" noPad>
          <Table headers={['Date', 'Status', 'Marked By', '']} rows={att.map((a) => [
            fmtDate(a.date), <Badge status={a.status} />, a.markedBy || '—',
            <button className="btn btn-ghost btn-xs" onClick={() => navigate('attendance', { traineeId: id, date: a.date })}><Icon name="edit" size={13} /> Edit</button>,
          ])} />
        </Card>
        <Card title="Leave" noPad action={<button className="btn btn-ghost btn-xs" onClick={() => navigate('leave', { traineeId: id })}>Manage</button>}>
          <Table headers={['Leave Date', 'From', 'To', 'Days', 'Reason', 'Status', 'Remarks']} rows={leaves.map((l) => [
            fmtDate(l.leaveDate), fmtDate(l.fromDate), fmtDate(l.toDate), l.days, l.reason, <Badge status={l.status} />, l.remarks || '—',
          ])} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Outing / Temporary Vacate" noPad action={<button className="btn btn-ghost btn-xs" onClick={() => navigate('outing-vacate', { traineeId: id })}>Manage</button>}>
          <Table headers={['Date', 'Type', 'From / To', 'Reason', 'Status', 'Remarks']} rows={ov.map((o) => [
            fmtDate(o.date), <Badge status={o.type} />, `${fmtDate(o.fromDate)} → ${o.expectedReturn ? fmtDate(o.expectedReturn) : '—'}`,
            o.reason, <Badge status={o.status} />, o.remarks || '—',
          ])} />
        </Card>
        <Card title="Resignation" noPad action={<button className="btn btn-ghost btn-xs" onClick={() => navigate('resignation', { traineeId: id })}>Manage</button>}>
          <Table headers={['Resignation Date', 'Last Working Date', 'Reason', 'Remarks', 'Status']} rows={resign.map((r) => [
            fmtDate(r.resignationDate), fmtDate(r.lastWorkingDate), r.reason, r.remarks || '—', <Badge status={r.status} />,
          ])} />
        </Card>
      </div>

      <Card title="Permanent Vacate" sub="Stored in OUTING_VACATE with TYPE = PERMANENT VACATE" noPad>
        <Table headers={['Date', 'Reason', 'Status', 'Remarks']} empty="Trainee has not been permanently vacated."
          rows={perm.map((o) => [fmtDate(o.fromDate), o.reason, <Badge status={o.status} />, o.remarks || '—'])} />
      </Card>
    </>
  );
}

/* ---------------- History page 2: Summary & Remarks ---------------- */
function Page2({ t, range }) {
  const { db, navigate } = useStore();
  const s = computeSummary(db, t.traineeId, range.from, range.to);
  const remarks = db.remarks.filter((r) => r.traineeId === t.traineeId).sort((a, b) => (a.date < b.date ? 1 : -1));
  const Mini = ({ label, value }) => <div className="mini-kpi"><div className="mini-kpi-value">{value}</div><div className="mini-kpi-label">{label}</div></div>;

  return (
    <>
      <Card title="Attendance Summary" sub={`${fmtDate(range.from)} – ${fmtDate(range.to)}`}>
        <div className="mini-kpi-grid">
          <Mini label="Present Days" value={s.workingDays} />
          <Mini label="Week Off Days" value={s.WO} />
          <Mini label="Leave Days" value={s.L} />
          <Mini label="Outings" value={s.OUT} />
          <Mini label="Temporary Vacated" value={s.tempVacateDays} />
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Shift Summary">
          <div className="mini-kpi-grid">
            <Mini label="A Shift" value={s.A} /><Mini label="B Shift" value={s.B} /><Mini label="C Shift" value={s.C} />
            <Mini label="G Shift" value={s.G} /><Mini label="12 Hrs" value={s.H12} />
          </div>
        </Card>
        <Card title="Living & Vacated Days">
          <div className="big-stat-row">
            <div className="big-stat">
              <div className="big-stat-value">{s.livingDays}</div>
              <div className="big-stat-label">Living Days</div>
              <div className="big-stat-formula">Working ({s.workingDays}) + Week Off ({s.WO}) + Leave ({s.L}) + Outing ({s.OUT})</div>
            </div>
            <div className="big-stat alt">
              <div className="big-stat-value">{s.vacatedDays}</div>
              <div className="big-stat-label">Vacated Days</div>
              <div className="big-stat-formula">Temporary Vacate ({s.tempVacateDays}) + Permanent Vacate ({s.permVacateDays})</div>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Remarks / Complaints" sub="Full history — not limited by the date range" noPad
        action={<button className="btn btn-ghost btn-xs" onClick={() => navigate('remarks', { traineeId: t.traineeId })}><Icon name="plus" size={14} /> Add</button>}
      >
        <Table headers={['Date', 'Type', 'Remark / Complaint', 'Action Taken', 'Status', 'Reported By']} rows={remarks.map((r) => [
          fmtDate(r.date), <Badge status={r.type} />, r.text, r.actionTaken, <Badge status={r.status} />, r.reportedBy,
        ])} />
      </Card>
    </>
  );
}

/* ---------------- QR ---------------- */
function Qr({ t }) {
  const { updateTrainee, notify } = useStore();
  const box = useRef(null);
  if (!t.qrId) {
    return <Card><div className="empty-state">A QR code is generated once this trainee is approved and allocated a room.</div></Card>;
  }
  const download = () => {
    const canvas = box.current && box.current.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `${t.traineeId}-qr.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  const toggle = () => {
    const next = t.qrStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    updateTrainee(t.traineeId, { qrStatus: next });
    notify(`QR marked ${next}.`);
  };
  return (
    <div className="card qr-card">
      <div className="card-body qr-card-body">
        {/* The QR contains ONLY the QR ID — no personal data. */}
        <div className="qr-canvas" ref={box}><QRCodeCanvas value={t.qrId} size={176} fgColor="#3B0F63" bgColor="#ffffff" /></div>
        <div className="qr-id">{t.qrId}</div>
        <div className="qr-sub">{t.name} · {t.traineeId} · <Badge status={t.qrStatus} /></div>
        <div className="qr-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => window.print()}><Icon name="print" size={15} /> Print</button>
          <button className="btn btn-ghost btn-sm" onClick={download}><Icon name="download" size={15} /> Download</button>
          <button className="btn btn-ghost btn-sm" onClick={toggle}>{t.qrStatus === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Profile shell ---------------- */
export default function TraineeProfile() {
  const { route, navigate, getTrainee, updateTrainee, deleteTrainee, isSuper, notify } = useStore();
  const t = getTrainee(route.params.id);
  const [range, setRange] = useState({ from: addDays(todayStr(), -13), to: todayStr() });
  const [approving, setApproving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showIdCard, setShowIdCard] = useState(false);

  if (!t) {
    return <div className="empty-state">Trainee not found. <a className="link" onClick={() => navigate('trainees')}>Back to Trainees</a></div>;
  }
  const sub = route.params.sub || 'overview';
  const go = (s) => navigate('trainee-profile', { id: t.traineeId, sub: s });
  const tabs = [
    ['overview', 'Overview'], ['id-card', 'ID Card'], ['edit', 'Edit Profile'],
    ['page1', 'View More · Attendance & Exit'], ['page2', 'View More · Summary & Remarks'], ['qr', 'QR Code'],
  ];

  return (
    <>
      <button className="back-link" onClick={() => navigate('trainees')}><Icon name="back" size={15} /> Back to Trainees</button>
      <div className="profile-head card">
        <Avatar trainee={t} size="lg" />
        <div className="profile-head-info">
          <div className="profile-name-row"><div className="profile-name">{t.name}</div><Badge status={t.hostelStatus} /></div>
          <div className="profile-meta">
            <span>{t.traineeId}</span><span className="dot">•</span>
            <span>Hostel ID: {t.hostelId || '—'}</span><span className="dot">•</span>
            <span>{t.hostel || 'Not allocated'}{t.roomNo ? ` · Room ${t.roomNo}` : ''}</span><span className="dot">•</span>
            <span>Shift {t.defaultShift}</span>
          </div>
          <div className="profile-chips">
            <span className="chip">Employment: {t.employmentStatus}</span>
            <span className="chip">QR: {t.qrStatus}</span>
          </div>
        </div>
        <div className="profile-head-actions">
          {t.hostelStatus === 'PENDING REVIEW' && <button className="btn btn-primary btn-sm" onClick={() => setApproving(true)}><Icon name="check" size={14} /> Approve</button>}
          {['ON LEAVE', 'OUTING', 'TEMPORARY VACATE'].includes(t.hostelStatus) && (
            <button className="btn btn-primary btn-sm" onClick={() => { updateTrainee(t.traineeId, { hostelStatus: 'ACTIVE' }); notify(`${t.name} marked as returned (ACTIVE).`); }}>
              <Icon name="check" size={14} /> Mark Returned
            </button>
          )}
          {t.roomNo && <button className="btn btn-ghost btn-sm" onClick={() => setMoving(true)}><Icon name="bed" size={14} /> Change Room</button>}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowIdCard(true)}
            title="Download & Print ID Card"
          >
            <Icon name="idCard" size={14} /> ID Card
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => go('edit')}><Icon name="edit" size={14} /> Edit Profile</button>
          <button className="btn btn-ghost btn-sm" onClick={() => go('qr')}><Icon name="qr" size={14} /> {t.qrId ? 'View QR' : 'QR'}</button>
          {isSuper && (
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                if (window.confirm(`Permanently delete trainee "${t.name}" (${t.traineeId})?\n\nThis will permanently delete the trainee record from MongoDB and free any allocated room/bed.\nThis action cannot be undone.`)) {
                  const ok = await deleteTrainee(t.traineeId);
                  if (ok) navigate('trainees');
                }
              }}
              title="Permanently Delete Trainee Record (Super Admin)"
            >
              <Icon name="trash" size={14} /> Delete
            </button>
          )}
        </div>
      </div>

      <div className="tabbar">
        {tabs.map(([id, label]) => <button key={id} className={`tab ${sub === id ? 'active' : ''}`} onClick={() => go(id)}>{label}</button>)}
      </div>

      {sub === 'edit' ? <Edit key={t.traineeId} t={t} />
        : sub === 'id-card' ? <div className="card" style={{ padding: '24px 16px' }}><VerticalIdCard trainee={t} embedded /></div>
        : sub === 'page1' ? <Page1 t={t} range={range} setRange={setRange} />
        : sub === 'page2' ? <Page2 t={t} range={range} />
        : sub === 'qr' ? <Qr t={t} />
        : <Overview t={t} />}

      {approving && <ApproveModal trainee={t} onClose={() => setApproving(false)} />}
      {moving && <ChangeRoomModal trainee={t} onClose={() => setMoving(false)} />}
      {showIdCard && <VerticalIdCard trainee={t} onClose={() => setShowIdCard(false)} />}
    </>
  );
}
