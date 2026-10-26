import { useState } from 'react';
import { QUALIFICATIONS, SHIFTS } from '../data/constants.js';
import { Avatar, Icon } from './ui.jsx';
import { todayStr } from '../utils/dates.js';
import { resizeImage } from '../utils/image.js';

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

  const onPhoto = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) setPhoto(await resizeImage(file));
  };

  const submit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    delete d.photoFile;
    const custom = {};
    customFields.forEach((f) => { custom[f.id] = d[`cf_${f.id}`] || ''; delete d[`cf_${f.id}`]; });
    onSubmit({ ...d, traineeId: d.traineeId.trim().toUpperCase(), name: d.name.trim(), aadhar: d.aadhar || '', photo, custom });
  };

  return (
    <form onSubmit={submit}>
      <div className="form-section">
        <div className="form-section-title">Personal Details</div>
        <div className="form-grid">
          <F label="Trainee ID *"><input className="input" name="traineeId" placeholder="e.g. TRN-02031" required /></F>
          <F label="Trainee Name *"><input className="input" name="name" required /></F>
          <F label="Mobile No. *"><input className="input" name="mobile" inputMode="numeric" pattern="[0-9]{10}" title="10-digit mobile number" required /></F>
          <F label="E-mail ID"><input className="input" type="email" name="email" /></F>
          <F label="Date of Birth *"><input className="input" type="date" name="dob" max={todayStr()} required /></F>
          <F label="Gender *"><select className="input" name="gender"><option>Male</option><option>Female</option><option>Other</option></select></F>
          <F label="Qualification"><select className="input" name="qualification">{QUALIFICATIONS.map((q) => <option key={q}>{q}</option>)}</select></F>
          <F label="Aadhar No."><input className="input" name="aadhar" inputMode="numeric" placeholder="XXXX-XXXX-XXXX" /></F>
          <F label="Food Preference"><select className="input" name="food"><option>VEG</option><option>NON-VEG</option></select></F>
          <F label="Photo">
            <div className="photo-upload-row">
              <Avatar trainee={{ name: '?', photo }} size="md" />
              <input className="input" type="file" name="photoFile" accept="image/*" onChange={onPhoto} />
            </div>
          </F>
        </div>
      </div>
      <div className="form-section">
        <div className="form-section-title">Address</div>
        <div className="form-grid">
          <F label="Address Line 1" span><input className="input" name="address1" /></F>
          <F label="District"><input className="input" name="district" /></F>
          <F label="State"><input className="input" name="state" /></F>
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
          <F label="Default Shift *"><select className="input" name="defaultShift">{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select></F>
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
