import { useRef, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import { QUALIFICATIONS, SHIFTS } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Table, formData } from '../components/ui.jsx';
import { CustomInput } from '../components/RegistrationForm.jsx';
import PhotoCapture from '../components/PhotoCapture.jsx';
import { missingDetails } from '../utils/details.js';
import {
  isValidMobile,
  isValidGuardianContact,
  isValidAadhaar,
  isValidEmail,
  isValidDob,
  ERROR_MESSAGES,
} from '../utils/validators.js';
import { resizeImage } from '../utils/image.js';
import { ApproveModal, ChangeRoomModal } from '../components/RoomModals.jsx';
import VerticalIdCard from '../components/VerticalIdCard.jsx';
import { addDays, fmtDate, todayStr } from '../utils/dates.js';
import { computeSummary } from '../utils/summary.js';

function maskAadhaar(num) {
  if (!num) return '—';
  const clean = String(num).replace(/\D/g, '');
  if (clean.length === 12) {
    return `XXXX-XXXX-${clean.slice(8)}`;
  }
  return num;
}

/* ---------------- Overview ---------------- */
function Overview({ t }) {
  const { db, config, navigate } = useStore();
  const missing = missingDetails(t, config.customFields);
  const traineeKey = t.traineeId || t.qrId;
  const info = [
    ['Trainee ID', t.traineeId || '—'], ['Hostel ID', t.hostelId || '—'], ['Mobile', t.mobile], ['E-mail', t.email || '—'],
    ['Date of Birth', fmtDate(t.dob)], ['Gender', t.gender], ['Qualification', t.qualification], ['Aadhar No.', maskAadhaar(t.aadhar)],
    ['Food', t.food], ['Joining Date', fmtDate(t.joiningDate)], ['Address', t.address1 || '—'],
    ['State', t.state || '—'], ['Guardian Name', t.guardianName || '—'], ['Guardian Contact', t.guardianContact || '—'],
    ['Employment Status', t.employmentStatus], ['Hostel Status', t.hostelStatus],
    ['Hostel', t.hostel || '—'], ['Room No.', t.roomNo || '—'], ['QR ID', t.qrId || '—'], ['QR Status', t.qrStatus],
    ['Approved By', t.approvedBy || '—'],
    ['ID Card Email Status', t.idCardDelivered ? `✓ Delivered on ${fmtDate(t.idCardDeliveredAt)}` : 'Not Delivered'],
    ['Remarks', t.remarks || '—'],
    ...config.customFields.map((f) => [f.label, (t.custom || {})[f.id] || '—']),
  ];
  const history = db.roomHistory.filter((h) => h.traineeId === (t.traineeId || t.qrId));
  return (
    <div className="grid-2">
      <Card title="Personal & Hostel Details">
        {missing.length > 0 ? (
          <div className="alert-banner bad" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={18} />
            <div className="alert-text"><strong>Details pending:</strong> {missing.join(', ')}</div>
            <button className="btn btn-danger btn-sm" onClick={() => navigate('trainee-profile', { id: traineeKey, sub: 'edit' })}>Fill now</button>
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
  const { saveTraineeProfile, notify, navigate, config } = useStore();
  const [name, setName] = useState(t.name || '');
  const [mobile, setMobile] = useState(t.mobile ? String(t.mobile).replace(/\D/g, '') : '');
  const [email, setEmail] = useState(t.email || '');
  const [dob, setDob] = useState(t.dob ? String(t.dob).slice(0, 10) : '');
  const [gender, setGender] = useState(t.gender || 'Male');
  const [qualification, setQualification] = useState(t.qualification || QUALIFICATIONS[0] || '');
  const [food, setFood] = useState(t.food || 'VEG');
  const [photo, setPhoto] = useState(t.photo || '');
  const [address1, setAddress1] = useState(t.address1 || '');
  const [state, setState] = useState(t.state || '');
  const [guardianName, setGuardianName] = useState(t.guardianName || '');
  const [guardianContact, setGuardianContact] = useState(t.guardianContact ? String(t.guardianContact).replace(/\D/g, '') : '');
  const [joiningDate, setJoiningDate] = useState(t.joiningDate ? String(t.joiningDate).slice(0, 10) : '');
  const [employmentStatus, setEmploymentStatus] = useState(t.employmentStatus || 'ACTIVE');
  const [remarks, setRemarks] = useState(t.remarks || '');
  const [customValues, setCustomValues] = useState({ ...(t.custom || {}) });

  // Aadhaar handling: distinguish unchanged masked Aadhaar from newly entered 12 digits
  const existingMaskedAadhaar = t.aadharMasked || maskAadhaar(t.aadhar) || '';
  const [changeAadhaar, setChangeAadhaar] = useState(false);
  const [newAadhaar, setNewAadhaar] = useState('');

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');

  const clearFieldError = (f) => {
    if (errors[f]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[f];
        return next;
      });
    }
  };

  const validate = () => {
    const errs = {};
    const cleanName = String(name || '').trim();
    if (!cleanName || cleanName.length < 2) {
      errs.name = 'Trainee name is required (at least 2 characters).';
    }

    const cleanMobile = String(mobile || '').replace(/\D/g, '');
    if (!cleanMobile) {
      errs.mobile = 'Mobile number is required.';
    } else if (!isValidMobile(cleanMobile)) {
      errs.mobile = ERROR_MESSAGES.MOBILE_INVALID;
    }

    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail) {
      if (!isValidEmail(cleanEmail)) {
        errs.email = ERROR_MESSAGES.EMAIL_INVALID;
      } else if (!cleanEmail.endsWith('@gmail.com')) {
        errs.email = 'Email address must be a valid @gmail.com address.';
      }
    }

    if (dob) {
      const cleanDob = String(dob).split('T')[0];
      if (!isValidDob(cleanDob)) {
        errs.dob = ERROR_MESSAGES.DOB_FUTURE;
      }
    }

    if (!joiningDate) {
      errs.joiningDate = 'Joining date is required.';
    }

    if (guardianContact) {
      const cleanGC = String(guardianContact).replace(/\D/g, '');
      if (cleanGC.length !== 10) {
        errs.guardianContact = ERROR_MESSAGES.GUARDIAN_CONTACT_INVALID;
      }
    }

    // Only validate Aadhaar if the user explicitly clicked "Change Aadhaar Number"
    if (changeAadhaar) {
      const cleanA = String(newAadhaar || '').replace(/\D/g, '');
      if (!cleanA) {
        errs.aadhar = 'Please enter the 12-digit Aadhaar number, or cancel Aadhaar change.';
      } else if (cleanA.length !== 12) {
        errs.aadhar = 'Aadhaar number must contain exactly 12 digits.';
      } else if (!isValidAadhaar(cleanA)) {
        errs.aadhar = ERROR_MESSAGES.AADHAAR_INVALID;
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');

    if (!validate()) {
      setFormError('Some fields contain invalid information. Please review the highlighted errors below.');
      return;
    }

    setSaving(true);
    const targetKey = t.traineeId || t.qrId || t._id;

    const payload = {
      name: name.trim(),
      mobile: mobile.replace(/\D/g, ''),
      email: email.trim().toLowerCase(),
      dob: dob || '',
      gender: gender || 'Male',
      qualification: qualification || '',
      food: food || 'VEG',
      photo,
      address1: address1.trim(),
      state: state.trim(),
      guardianName: guardianName.trim(),
      guardianContact: guardianContact.replace(/\D/g, ''),
      joiningDate: joiningDate || '',
      employmentStatus: employmentStatus || 'ACTIVE',
      remarks: remarks.trim(),
      custom: customValues,
    };

    if (changeAadhaar && newAadhaar.trim()) {
      payload.changeAadhaar = true;
      payload.aadhar = newAadhaar.replace(/\D/g, '');
    } else {
      payload.changeAadhaar = false;
    }

    try {
      const res = await saveTraineeProfile(targetKey, payload);
      if (res && res.ok) {
        notify(res.message || 'Trainee profile updated successfully.');
        navigate('trainee-profile', { id: targetKey, sub: 'overview' });
      } else {
        throw new Error(res?.error || 'Failed to update trainee details.');
      }
    } catch (err) {
      console.error('[TraineeProfile Submit Error]:', err);
      const msg = err.message || 'Failed to save changes. Please try again.';
      setFormError(msg);
      if (err.data?.errors) {
        setErrors((prev) => ({ ...prev, ...err.data.errors }));
      }
      notify(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card form-card">
      <form onSubmit={submit} noValidate>
        {formError && (
          <div
            className="alert-banner bad"
            style={{
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 16px',
              borderRadius: 8,
              background: '#fef2f2',
              border: '1.5px solid #fecaca',
              color: '#991b1b',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <Icon name="alert" size={18} />
            <div style={{ flex: 1 }}>{formError}</div>
          </div>
        )}

        <div className="form-section">
          <div className="form-section-title">Personal Details</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Trainee Name *</label>
              <input
                className={`input ${errors.name ? 'input-error' : ''}`}
                name="name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearFieldError('name');
                }}
                required
              />
              {errors.name && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.name}</div>}
            </div>

            <div>
              <label className="field-label">Mobile No. * (10 Digits)</label>
              <input
                className={`input ${errors.mobile ? 'input-error' : ''}`}
                name="mobile"
                value={mobile}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setMobile(val);
                  clearFieldError('mobile');
                }}
                inputMode="numeric"
                maxLength={10}
                placeholder="e.g. 9876543210"
                required
              />
              {errors.mobile && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.mobile}</div>}
            </div>

            <div>
              <label className="field-label">E-mail ID (Gmail only)</label>
              <input
                className={`input ${errors.email ? 'input-error' : ''}`}
                type="email"
                name="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  clearFieldError('email');
                }}
                placeholder="example@gmail.com"
              />
              {errors.email && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.email}</div>}
            </div>

            <div>
              <label className="field-label">Date of Birth</label>
              <input
                className={`input ${errors.dob ? 'input-error' : ''}`}
                type="date"
                name="dob"
                value={dob}
                max={todayStr()}
                onChange={(e) => {
                  setDob(e.target.value);
                  clearFieldError('dob');
                }}
              />
              {errors.dob && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.dob}</div>}
            </div>

            <div>
              <label className="field-label">Gender</label>
              <select className="input" name="gender" value={gender} onChange={(e) => setGender(e.target.value)}>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="field-label">Qualification / Trade</label>
              <select className="input" name="qualification" value={qualification} onChange={(e) => setQualification(e.target.value)}>
                {QUALIFICATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            {/* Secure Aadhaar Edit Section */}
            <div style={{ gridColumn: 'span 2' }}>
              {!changeAadhaar ? (
                <div>
                  <label className="field-label">Aadhaar Card No.</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                    <div
                      style={{
                        padding: '9px 14px',
                        background: 'var(--gray-100, #f1f5f9)',
                        border: '1.5px solid var(--gray-300, #cbd5e1)',
                        borderRadius: 8,
                        fontWeight: 700,
                        letterSpacing: 1.2,
                        color: 'var(--gray-800, #1e293b)',
                        fontFamily: 'monospace',
                        fontSize: 14,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 10,
                      }}
                    >
                      <span>🔒 {existingMaskedAadhaar || 'No Aadhaar on file'}</span>
                      {existingMaskedAadhaar && (
                        <span className="chip chip-green" style={{ fontSize: 11, padding: '2px 8px' }}>
                          Verified & Encrypted
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setChangeAadhaar(true);
                        setNewAadhaar('');
                        clearFieldError('aadhar');
                      }}
                      title="Enter a new 12-digit Aadhaar number"
                      style={{ fontWeight: 600 }}
                    >
                      <Icon name="edit" size={13} /> {existingMaskedAadhaar ? 'Change Aadhaar Number' : 'Add Aadhaar Number'}
                    </button>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Full Aadhaar number is encrypted with AES-256 and never displayed in plain text. Existing Aadhaar is securely preserved.
                  </div>
                </div>
              ) : (
                <div style={{ background: '#f8fafc', border: '1.5px solid var(--purple-200, #ddd6fe)', borderRadius: 10, padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label className="field-label" style={{ fontWeight: 700, color: 'var(--purple-900, #2e1065)', margin: 0 }}>
                      Enter New 12-Digit Aadhaar No. *
                    </label>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        setChangeAadhaar(false);
                        setNewAadhaar('');
                        clearFieldError('aadhar');
                      }}
                      style={{ color: 'var(--gray-600)' }}
                    >
                      <Icon name="x" size={12} /> Cancel Aadhaar Change
                    </button>
                  </div>
                  <input
                    className={`input ${errors.aadhar ? 'input-error' : ''}`}
                    name="newAadhaar"
                    value={newAadhaar}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '').slice(0, 12);
                      setNewAadhaar(val);
                      clearFieldError('aadhar');
                    }}
                    inputMode="numeric"
                    maxLength={12}
                    placeholder="Enter complete 12-digit UID"
                    autoFocus
                  />
                  {errors.aadhar && (
                    <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>
                      {errors.aadhar}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    Enter all 12 digits. The number will be verified with the Verhoeff checksum algorithm and securely encrypted upon saving.
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="field-label">Food Preference</label>
              <select className="input" name="food" value={food} onChange={(e) => setFood(e.target.value)}>
                <option value="VEG">VEG</option>
                <option value="NON-VEG">NON-VEG</option>
              </select>
            </div>

            <div style={{ gridColumn: 'span 2' }}>
              <label className="field-label">Photo</label>
              <PhotoCapture value={photo} onChange={setPhoto} />
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-title">Address</div>
          <div className="form-grid">
            <div className="span-2">
              <label className="field-label">Address Line 1</label>
              <input
                className="input"
                name="address1"
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="House / Street address"
              />
            </div>
            <div className="span-2">
              <label className="field-label">State</label>
              <input
                className="input"
                name="state"
                value={state}
                onChange={(e) => setState(e.target.value)}
                placeholder="State of residence"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-title">Guardian</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Guardian Name</label>
              <input
                className="input"
                name="guardianName"
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="Parent or Guardian name"
              />
            </div>
            <div>
              <label className="field-label">Guardian Contact No.</label>
              <input
                className={`input ${errors.guardianContact ? 'input-error' : ''}`}
                name="guardianContact"
                value={guardianContact}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                  setGuardianContact(val);
                  clearFieldError('guardianContact');
                }}
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
              />
              {errors.guardianContact && (
                <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>
                  {errors.guardianContact}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="form-section-title">Employment & Joining Details</div>
          <div className="form-grid">
            <div>
              <label className="field-label">Joining Date *</label>
              <input
                className={`input ${errors.joiningDate ? 'input-error' : ''}`}
                type="date"
                name="joiningDate"
                value={joiningDate}
                onChange={(e) => {
                  setJoiningDate(e.target.value);
                  clearFieldError('joiningDate');
                }}
                required
              />
              {errors.joiningDate && (
                <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>
                  {errors.joiningDate}
                </div>
              )}
            </div>
            <div>
              <label className="field-label">Employment Status</label>
              <select
                className="input"
                name="employmentStatus"
                value={employmentStatus}
                onChange={(e) => setEmploymentStatus(e.target.value)}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="RESIGNED">RESIGNED</option>
              </select>
            </div>
            <div>
              <label className="field-label">Remarks (short note)</label>
              <input
                className="input"
                name="remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Optional notes or remarks"
              />
            </div>
          </div>
        </div>

        {config.customFields.length > 0 && (
          <div className="form-section">
            <div className="form-section-title">Additional Details</div>
            <div className="form-grid">
              {config.customFields.map((f) => (
                <div key={f.id}>
                  <label className="field-label">{f.label}{f.required ? ' *' : ''}</label>
                  <CustomInput
                    f={f}
                    value={customValues[f.id] || ''}
                    onChange={(val) => setCustomValues((prev) => ({ ...prev, [f.id]: val }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="form-foot">
          <div className="muted">Hostel status, room and QR are managed through Approve, Change Room and Outing / Vacate actions.</div>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={saving}
            style={{ minWidth: 140, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {saving ? (
              <>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: '#fff',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
                <span>Saving Changes…</span>
              </>
            ) : (
              <>
                <Icon name="check" size={15} />
                <span>Save Changes</span>
              </>
            )}
          </button>
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
    a.download = `${t.traineeId || t.qrId}-qr.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  const toggle = () => {
    const next = t.qrStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    updateTrainee(t.traineeId || t.qrId, { qrStatus: next });
    notify(`QR marked ${next}.`);
  };
  return (
    <div className="card qr-card">
      <div className="card-body qr-card-body">
        {/* The QR contains ONLY the QR ID — no personal data. */}
        <div className="qr-canvas" ref={box}><QRCodeCanvas value={t.qrId} size={176} fgColor="#3B0F63" bgColor="#ffffff" /></div>
        <div className="qr-id">{t.qrId}</div>
        <div className="qr-sub">{t.name} · {t.traineeId || '—'} · <Badge status={t.qrStatus} /></div>
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
  const [sendingEmail, setSendingEmail] = useState(false);

  if (!t) {
    return <div className="empty-state">Trainee not found. <a className="link" onClick={() => navigate('trainees')}>Back to Trainees</a></div>;
  }
  const traineeKey = t.traineeId || t.qrId;
  const sub = route.params.sub || 'overview';
  const go = (s) => navigate('trainee-profile', { id: traineeKey, sub: s });
  const tabs = [
    ['overview', 'Overview'], ['id-card', 'ID Card'], ['edit', 'Edit Profile'],
    ['page1', 'View More · Attendance & Exit'], ['page2', 'View More · Summary & Remarks'], ['qr', 'QR Code'],
  ];

  const handleSendEmail = async () => {
    setSendingEmail(true);
    try {
      const res = await api(`/api/trainees/${encodeURIComponent(traineeKey)}/send-id-card`, {
        method: 'POST',
        body: {
          hostel: t.hostel,
          roomNo: t.roomNo,
        },
      });
      if (res.ok) {
        notify(res.message || 'ID Card delivered to trainee email successfully.');
        updateTrainee(traineeKey, { idCardDelivered: true, idCardDeliveredAt: new Date().toISOString() });
      } else {
        notify(`Email delivery: ${res.message || res.error || 'Failed'}`);
      }
    } catch (err) {
      notify(`Email delivery failed: ${err.message}`);
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <>
      <button className="back-link" onClick={() => navigate('trainees')}><Icon name="back" size={15} /> Back to Trainees</button>
      <div className="profile-head card">
        <Avatar trainee={t} size="lg" />
        <div className="profile-head-info">
          <div className="profile-name-row"><div className="profile-name">{t.name}</div><Badge status={t.hostelStatus} /></div>
          <div className="profile-meta">
            <span>{t.traineeId || '—'}</span><span className="dot">•</span>
            <span>Hostel ID: {t.hostelId || '—'}</span><span className="dot">•</span>
            <span>{t.hostel || 'Not allocated'}{t.roomNo ? ` · Room ${t.roomNo}` : ''}</span>
          </div>
          <div className="profile-chips">
            <span className="chip">Employment: {t.employmentStatus}</span>
            <span className="chip">QR: {t.qrStatus}</span>
            {t.idCardDelivered && <span className="chip chip-green">ID Card Sent</span>}
          </div>
        </div>
        <div className="profile-head-actions">
          {t.hostelStatus === 'PENDING REVIEW' && <button className="btn btn-primary btn-sm" onClick={() => setApproving(true)}><Icon name="check" size={14} /> Approve</button>}
          {['ON LEAVE', 'OUTING', 'TEMPORARY VACATE'].includes(t.hostelStatus) && (
            <button className="btn btn-primary btn-sm" onClick={() => { updateTrainee(traineeKey, { hostelStatus: 'ACTIVE' }); notify(`${t.name} marked as returned (ACTIVE).`); }}>
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
          {t.email && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleSendEmail}
              disabled={sendingEmail}
              title="Send or resend official ID Card to registered Gmail"
            >
              <Icon name="mail" size={14} /> {sendingEmail ? 'Sending…' : t.idCardDelivered ? 'Resend ID Card' : 'Email ID Card'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => go('edit')}><Icon name="edit" size={14} /> Edit Profile</button>
          <button className="btn btn-ghost btn-sm" onClick={() => go('qr')}><Icon name="qr" size={14} /> {t.qrId ? 'View QR' : 'QR'}</button>
          {isSuper && (
            <button
              className="btn btn-danger btn-sm"
              onClick={async () => {
                if (window.confirm(`Permanently delete trainee "${t.name}" (${t.traineeId || t.qrId})?\n\nThis will permanently delete the trainee record from MongoDB and free any allocated room/bed.\nThis action cannot be undone.`)) {
                  const ok = await deleteTrainee(traineeKey);
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

      {sub === 'edit' ? <Edit key={traineeKey} t={t} />
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
