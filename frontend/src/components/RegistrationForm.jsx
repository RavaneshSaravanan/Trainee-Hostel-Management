import { useState } from 'react';
import { QUALIFICATIONS } from '../data/constants.js';
import { Avatar, Icon } from './ui.jsx';
import { todayStr } from '../utils/dates.js';
import PhotoCapture from './PhotoCapture.jsx';

// Field wrapper lives OUTSIDE the form component so inputs keep their typed values between renders.
const F = ({ label, children, span }) => (
  <div className={span ? 'span-2' : ''}><label className="field-label">{label}</label>{children}</div>
);

/** Custom field input (fields the Super Admin added in Admin Console). */
export function CustomInput({ f, value, name }) {
  const common = { className: 'input', name: name || `cf_${f.id}`, defaultValue: value || '', required: !!f.required };
  if (f.type === 'select') {
    return <select {...common}><option value="">Select…</option>{(f.options || '').split(',').map((o) => o.trim()).filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>;
  }
  return <input {...common} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} />;
}

/** Shared by the in-app "New Trainee" page and the public self-registration page (QR). */
export default function RegistrationForm({ customFields = [], onSubmit, submitText = 'Submit Registration', note, busy }) {
  const [photo, setPhoto] = useState('');
  const [mobile, setMobile] = useState('');
  const [aadhar, setAadhar] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({});

  const validate = () => {
    const errs = {};

    // 1. Mobile: exactly 10 digits, numbers only
    const cleanMobile = mobile.replace(/\D/g, '');
    if (!cleanMobile) {
      errs.mobile = 'Mobile number is required.';
    } else if (cleanMobile.length !== 10) {
      errs.mobile = 'Mobile number must be exactly 10 digits (numbers only).';
    }

    // 2. Aadhaar: exactly 12 digits if provided
    const cleanAadhar = aadhar.replace(/\D/g, '');
    if (aadhar.trim() && cleanAadhar.length !== 12) {
      errs.aadhar = 'Aadhaar number must be exactly 12 digits (numbers only).';
    }

    // 3. Email: must end with @gmail.com
    const cleanEmail = email.trim().toLowerCase();
    if (cleanEmail && !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(cleanEmail)) {
      errs.email = 'Email address must be a valid @gmail.com address.';
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const submit = (e) => {
    e.preventDefault();
    if (!validate()) return;

    const d = Object.fromEntries(new FormData(e.target));
    delete d.photoFile;
    const custom = {};
    customFields.forEach((f) => { custom[f.id] = d[`cf_${f.id}`] || ''; delete d[`cf_${f.id}`]; });
    const cleanTraineeId = String(d.traineeId || '').trim().toUpperCase();
    onSubmit({
      ...d,
      traineeId: cleanTraineeId,
      name: d.name.trim(),
      mobile: mobile.replace(/\D/g, ''),
      aadhar: aadhar.replace(/\D/g, ''),
      email: email.trim().toLowerCase(),
      photo,
      custom,
    });
  };

  return (
    <form onSubmit={submit}>
      <div className="form-section">
        <div className="form-section-title">Personal Details</div>
        <div className="form-grid">
          <F label="Trainee ID (Optional)">
            <input
              className="input"
              name="traineeId"
              placeholder="e.g. TRN-02031 (leave empty to auto-generate)"
            />
          </F>
          <F label="Trainee Name *">
            <input className="input" name="name" required />
          </F>
          <F label="Mobile No. * (10 Digits)">
            <input
              className={`input ${errors.mobile ? 'input-error' : ''}`}
              name="mobile"
              value={mobile}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 10);
                setMobile(val);
                if (errors.mobile && val.length === 10) setErrors((prev) => ({ ...prev, mobile: '' }));
              }}
              onBlur={() => {
                if (mobile && mobile.length !== 10) {
                  setErrors((prev) => ({ ...prev, mobile: 'Mobile number must be exactly 10 digits.' }));
                }
              }}
              inputMode="numeric"
              maxLength={10}
              placeholder="e.g. 9876543210"
              required
            />
            {errors.mobile && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.mobile}</div>}
          </F>
          <F label="E-mail ID (@gmail.com strictly required)">
            <input
              className={`input ${errors.email ? 'input-error' : ''}`}
              type="email"
              name="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (errors.email && /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(e.target.value.trim().toLowerCase())) {
                  setErrors((prev) => ({ ...prev, email: '' }));
                }
              }}
              onBlur={() => {
                if (email && !/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email.trim().toLowerCase())) {
                  setErrors((prev) => ({ ...prev, email: 'Email must be a valid @gmail.com address.' }));
                }
              }}
              placeholder="example@gmail.com"
            />
            {errors.email && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.email}</div>}
          </F>
          <F label="Date of Birth *"><input className="input" type="date" name="dob" max={todayStr()} required /></F>
          <F label="Gender *"><select className="input" name="gender"><option>Male</option><option>Female</option><option>Other</option></select></F>
          <F label="Qualification"><select className="input" name="qualification">{QUALIFICATIONS.map((q) => <option key={q}>{q}</option>)}</select></F>
          <F label="Aadhaar No. (12 Digits)">
            <input
              className={`input ${errors.aadhar ? 'input-error' : ''}`}
              name="aadhar"
              value={aadhar}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 12);
                setAadhar(val);
                if (errors.aadhar && val.length === 12) setErrors((prev) => ({ ...prev, aadhar: '' }));
              }}
              onBlur={() => {
                if (aadhar && aadhar.length !== 12) {
                  setErrors((prev) => ({ ...prev, aadhar: 'Aadhaar number must be exactly 12 digits.' }));
                }
              }}
              inputMode="numeric"
              maxLength={12}
              placeholder="123456789012"
            />
            {errors.aadhar && <div className="field-error" style={{ color: 'var(--red, #ef4444)', fontSize: 12, marginTop: 4 }}>{errors.aadhar}</div>}
          </F>
          <F label="Food Preference"><select className="input" name="food"><option>VEG</option><option>NON-VEG</option></select></F>
          <F label="Photo" span>
            <PhotoCapture value={photo} onChange={setPhoto} />
          </F>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">Address</div>
        <div className="form-grid">
          <F label="Address Line 1" span><input className="input" name="address1" /></F>
          <F label="State" span><input className="input" name="state" /></F>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">Guardian</div>
        <div className="form-grid">
          <F label="Guardian Name"><input className="input" name="guardianName" /></F>
          <F label="Guardian Contact No."><input className="input" name="guardianContact" inputMode="numeric" pattern="[0-9]{10}" title="10-digit number" /></F>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">Employment</div>
        <div className="form-grid">
          <F label="Joining Date *"><input className="input" type="date" name="joiningDate" defaultValue={todayStr()} required /></F>
        </div>
      </div>
      {customFields.length > 0 && (
        <div className="form-section">
          <div className="form-section-title">Additional Details</div>
          <div className="form-grid">
            {customFields.map((f) => <F key={f.id} label={`${f.label}${f.required ? ' *' : ''}`}><CustomInput f={f} /></F>)}
          </div>
        </div>
      )}
      <div className="form-foot">
        <div className="muted">{note}</div>
        <button className="btn btn-primary" type="submit" disabled={busy}><Icon name="check" size={15} /> {busy ? 'Submitting…' : submitText}</button>
      </div>
    </form>
  );
}
