import { useState, useEffect, useRef } from 'react';
import { QUALIFICATIONS } from '../data/constants.js';
import { Icon } from './ui.jsx';
import { todayStr } from '../utils/dates.js';
import PhotoCapture from './PhotoCapture.jsx';
import { api } from '../utils/api.js';
import {
  isValidEmail,
  isValidMobile,
  isValidGuardianContact,
  isValidAadhaar,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
} from '../utils/validators.js';

// Field wrapper lives OUTSIDE the form component so inputs keep their typed values between renders.
const F = ({ label, children, span }) => (
  <div className={span ? 'span-2' : ''}>
    <label className="field-label">{label}</label>
    {children}
  </div>
);

/** Custom field input (fields the Super Admin added in Admin Console). */
export function CustomInput({ f, value, onChange }) {
  const common = {
    className: 'input',
    name: `cf_${f.id}`,
    value: value || '',
    onChange: (e) => onChange && onChange(f.id, e.target.value),
    required: !!f.required,
  };
  if (f.type === 'select') {
    return (
      <select {...common}>
        <option value="">Select…</option>
        {(f.options || '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
          .map((o) => (
            <option key={o}>{o}</option>
          ))}
      </select>
    );
  }
  return <input {...common} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} />;
}

/** Shared by the in-app "New Trainee" page and the public self-registration page (QR). */
export default function RegistrationForm({
  customFields = [],
  onSubmit,
  submitText = 'Submit Registration',
  note,
  busy = false,
}) {
  const [values, setValues] = useState({
    traineeId: '',
    name: '',
    email: '',
    mobile: '',
    dob: '',
    gender: 'Male',
    qualification: QUALIFICATIONS[0] || '',
    aadhar: '',
    food: 'VEG',
    address1: '',
    state: '',
    guardianName: '',
    guardianContact: '',
    joiningDate: todayStr(),
  });

  const [photo, setPhoto] = useState('');
  const [customValues, setCustomValues] = useState({});
  const [touched, setTouched] = useState({});
  const [errors, setErrors] = useState({});

  // Trainee ID uniqueness validation state
  const [traineeIdSuccess, setTraineeIdSuccess] = useState('');
  const [traineeIdChecking, setTraineeIdChecking] = useState(false);
  const checkTimeoutRef = useRef(null);

  // Email verification state
  const [emailVerified, setEmailVerified] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpMessage, setOtpMessage] = useState('');
  const [otpError, setOtpError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 60-second cooldown timer
  useEffect(() => {
    if (otpCooldown <= 0) return;
    const interval = setInterval(() => {
      setOtpCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [otpCooldown]);

  // Check Trainee ID availability against backend (case-insensitive)
  const checkTraineeId = async (idToTest) => {
    const clean = String(idToTest || '').trim();
    if (!clean) {
      setErrors((prev) => ({ ...prev, traineeId: '' }));
      setTraineeIdSuccess('');
      return;
    }

    setTraineeIdChecking(true);
    try {
      const res = await api(`/api/public/check-trainee-id?traineeId=${encodeURIComponent(clean)}`, {
        auth: false,
      });
      if (res.available) {
        setErrors((prev) => ({ ...prev, traineeId: '' }));
        setTraineeIdSuccess(SUCCESS_MESSAGES.TRAINEE_ID_AVAILABLE);
      } else {
        setErrors((prev) => ({
          ...prev,
          traineeId: res.error || ERROR_MESSAGES.TRAINEE_ID_EXISTS,
        }));
        setTraineeIdSuccess('');
      }
    } catch {
      // In transient offline conditions, do not block unless confirmed duplicate
    } finally {
      setTraineeIdChecking(false);
    }
  };

  const validateField = (field, val, currentValues = values, isVerified = emailVerified) => {
    const value = typeof val === 'string' ? val : '';
    switch (field) {
      case 'name':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        return '';

      case 'email':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        if (!isValidEmail(value.trim())) return ERROR_MESSAGES.EMAIL_INVALID;
        if (!isVerified) return ERROR_MESSAGES.EMAIL_UNVERIFIED;
        return '';

      case 'mobile':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        if (!isValidMobile(value.trim())) return ERROR_MESSAGES.MOBILE_INVALID;
        return '';

      case 'guardianName':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        return '';

      case 'guardianContact':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        if (!isValidGuardianContact(value.trim())) return ERROR_MESSAGES.GUARDIAN_CONTACT_INVALID;
        return '';

      case 'dob':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        return '';

      case 'gender':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        return '';

      case 'joiningDate':
        if (!value.trim()) return ERROR_MESSAGES.REQUIRED;
        return '';

      case 'aadhar':
        if (value.trim()) {
          if (!isValidAadhaar(value.trim())) return ERROR_MESSAGES.AADHAAR_INVALID;
        }
        return '';

      default:
        return '';
    }
  };

  const handleChange = (field, rawValue) => {
    let val = rawValue;
    if (field === 'mobile' || field === 'guardianContact') {
      val = rawValue.replace(/\D/g, '').slice(0, 10);
    } else if (field === 'aadhar') {
      val = rawValue.replace(/\D/g, '').slice(0, 12);
    }

    const nextValues = { ...values, [field]: val };
    setValues(nextValues);

    // Trainee ID real-time availability check (debounced)
    if (field === 'traineeId') {
      setTraineeIdSuccess('');
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      const clean = val.trim();
      if (!clean) {
        setErrors((prev) => ({ ...prev, traineeId: '' }));
      } else {
        checkTimeoutRef.current = setTimeout(() => {
          checkTraineeId(clean);
        }, 350);
      }
    }

    // If email changes, invalidate OTP verification status
    if (field === 'email') {
      if (emailVerified) {
        setEmailVerified(false);
        setVerificationToken('');
        setOtpSent(false);
        setOtp('');
        setOtpMessage('');
      }
    }

    if (touched[field]) {
      const error = validateField(field, val, nextValues, field === 'email' ? false : emailVerified);
      setErrors((prev) => ({ ...prev, [field]: error }));
    }
  };

  const handleBlur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    if (field === 'traineeId') {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
      checkTraineeId(values.traineeId);
    } else {
      const error = validateField(field, values[field], values, emailVerified);
      setErrors((prev) => ({ ...prev, [field]: error }));
    }
  };

  const handleSendOtp = async () => {
    const cleanEmail = values.email.trim();
    const emailErr = !cleanEmail
      ? ERROR_MESSAGES.REQUIRED
      : !isValidEmail(cleanEmail)
      ? ERROR_MESSAGES.EMAIL_INVALID
      : '';

    if (emailErr) {
      setTouched((prev) => ({ ...prev, email: true }));
      setErrors((prev) => ({ ...prev, email: emailErr }));
      return;
    }

    setOtpSending(true);
    setOtpError('');
    setOtpMessage('');

    try {
      const res = await api('/api/public/send-otp', {
        method: 'POST',
        body: { email: cleanEmail },
        auth: false,
      });
      setOtpSent(true);
      setOtpCooldown(60);
      setOtpMessage(res.message || 'OTP sent successfully to your email.');
    } catch (err) {
      setOtpError(err.message || 'Failed to send OTP. Please try again.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length !== 4) {
      setOtpError(ERROR_MESSAGES.OTP_INVALID);
      return;
    }

    setOtpVerifying(true);
    setOtpError('');

    try {
      const res = await api('/api/public/verify-otp', {
        method: 'POST',
        body: { email: values.email.trim(), otp: cleanOtp },
        auth: false,
      });

      if (res.verificationToken) {
        setVerificationToken(res.verificationToken);
        setEmailVerified(true);
        setOtpSent(false);
        setOtp('');
        setOtpError('');
        setOtpMessage('Email verified successfully!');
        setErrors((prev) => ({ ...prev, email: '' }));
      } else {
        setOtpError(ERROR_MESSAGES.OTP_INVALID);
      }
    } catch (err) {
      setOtpError(err.message || ERROR_MESSAGES.OTP_INVALID);
    } finally {
      setOtpVerifying(false);
    }
  };

  // Check form validity for submit button
  const isFormValid =
    values.name.trim().length > 0 &&
    isValidEmail(values.email.trim()) &&
    emailVerified &&
    isValidMobile(values.mobile.trim()) &&
    values.guardianName.trim().length > 0 &&
    isValidGuardianContact(values.guardianContact.trim()) &&
    values.dob.trim().length > 0 &&
    values.gender.trim().length > 0 &&
    values.joiningDate.trim().length > 0 &&
    (!values.aadhar.trim() || isValidAadhaar(values.aadhar.trim())) &&
    !errors.traineeId &&
    !errors.name &&
    !errors.email &&
    !errors.mobile &&
    !errors.guardianName &&
    !errors.guardianContact &&
    !errors.dob &&
    !errors.gender &&
    !errors.joiningDate &&
    !errors.aadhar &&
    !traineeIdChecking &&
    !submitting &&
    !busy;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting || busy) return;

    if (errors.traineeId) return;

    // Validate all mandatory fields
    const mandatoryFields = [
      'name',
      'email',
      'mobile',
      'guardianName',
      'guardianContact',
      'dob',
      'gender',
      'joiningDate',
    ];
    const allTouched = {};
    const currentErrors = {};

    mandatoryFields.forEach((f) => {
      allTouched[f] = true;
      const err = validateField(f, values[f], values, emailVerified);
      if (err) currentErrors[f] = err;
    });

    if (values.aadhar.trim()) {
      allTouched.aadhar = true;
      const err = validateField('aadhar', values.aadhar, values, emailVerified);
      if (err) currentErrors.aadhar = err;
    }

    if (errors.traineeId) {
      currentErrors.traineeId = errors.traineeId;
    }

    setTouched((prev) => ({ ...prev, ...allTouched }));
    setErrors(currentErrors);

    if (Object.keys(currentErrors).length > 0) return;
    if (!emailVerified) {
      setErrors((prev) => ({ ...prev, email: ERROR_MESSAGES.EMAIL_UNVERIFIED }));
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        ...values,
        traineeId: values.traineeId.trim().toUpperCase(),
        name: values.name.trim(),
        email: values.email.trim().toLowerCase(),
        verificationToken,
        mobile: values.mobile.trim(),
        dob: values.dob,
        gender: values.gender,
        qualification: values.qualification,
        aadhar: values.aadhar.trim(),
        food: values.food,
        photo,
        address1: values.address1.trim(),
        state: values.state.trim(),
        guardianName: values.guardianName.trim(),
        guardianContact: values.guardianContact.trim(),
        joiningDate: values.joiningDate,
        custom: customValues,
      });
    } catch (err) {
      if (err.message && err.message.includes('Trainee ID already exists')) {
        setErrors((prev) => ({ ...prev, traineeId: ERROR_MESSAGES.TRAINEE_ID_EXISTS }));
        setTraineeIdSuccess('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const getTraineeIdClass = () => {
    if (errors.traineeId) return 'input input-error';
    if (traineeIdSuccess && values.traineeId.trim()) return 'input input-valid';
    return 'input';
  };

  const getFieldClass = (field) => {
    const isTouched = !!touched[field];
    const hasError = !!errors[field];
    if (isTouched && hasError) return 'input input-error';
    if (isTouched && !hasError && values[field]) return 'input input-valid';
    return 'input';
  };

  const getEmailClass = () => {
    const isTouched = !!touched.email;
    const hasError = !!errors.email;
    if (isTouched && hasError) return 'input input-error';
    if (emailVerified && !hasError) return 'input input-valid';
    return 'input';
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* ---------------- 1. Personal Details ---------------- */}
      <div className="form-section">
        <div className="form-section-title">Personal Details</div>
        <div className="form-grid">
          {/* Trainee ID (Optional with duplicate validation) */}
          <F label="Trainee ID (Optional)">
            <input
              className={getTraineeIdClass()}
              name="traineeId"
              value={values.traineeId}
              onChange={(e) => handleChange('traineeId', e.target.value)}
              onBlur={() => handleBlur('traineeId')}
              placeholder="e.g. TRN-02031 (leave empty to auto-generate)"
            />
            {errors.traineeId && <div className="field-error-msg">{errors.traineeId}</div>}
            {!errors.traineeId && traineeIdSuccess && values.traineeId.trim() && (
              <div className="field-valid-indicator">
                <Icon name="check" size={13} /> {traineeIdSuccess}
              </div>
            )}
          </F>

          <F label="Trainee Name *">
            <input
              className={getFieldClass('name')}
              name="name"
              value={values.name}
              onChange={(e) => handleChange('name', e.target.value)}
              onBlur={() => handleBlur('name')}
              placeholder="Full name as per official records"
              required
            />
            {touched.name && errors.name && <div className="field-error-msg">{errors.name}</div>}
          </F>

          {/* Email & OTP Verification */}
          <F label="E-mail ID * (OTP Verification Required)" span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className={getEmailClass()}
                type="email"
                name="email"
                value={values.email}
                onChange={(e) => handleChange('email', e.target.value)}
                onBlur={() => handleBlur('email')}
                placeholder="user@gmail.com"
                style={{ flex: 1 }}
                required
              />
              {emailVerified ? (
                <span className="verified-badge">
                  <Icon name="check" size={13} /> Email Verified
                </span>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleSendOtp}
                  disabled={otpSending || (otpSent && otpCooldown > 0)}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {otpSending
                    ? 'Sending…'
                    : otpSent && otpCooldown > 0
                    ? `Resend in ${otpCooldown}s`
                    : otpSent
                    ? 'Resend OTP'
                    : 'Send OTP'}
                </button>
              )}
            </div>

            {/* OTP Entry Row */}
            {otpSent && !emailVerified && (
              <div className="otp-wrap">
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-800)' }}>
                  Enter the 4-digit OTP sent to {values.email}:
                </div>
                <div className="otp-row">
                  <input
                    className="input otp-input"
                    inputMode="numeric"
                    maxLength={4}
                    value={otp}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setOtp(v);
                      if (otpError) setOtpError('');
                    }}
                    placeholder="••••"
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleVerifyOtp}
                    disabled={otpVerifying || otp.length !== 4}
                  >
                    {otpVerifying ? 'Verifying…' : 'Verify OTP'}
                  </button>
                  {otpCooldown > 0 ? (
                    <span className="otp-timer">Expires in 5 min · Resend in {otpCooldown}s</span>
                  ) : (
                    <button
                      type="button"
                      className="resend-btn"
                      onClick={handleSendOtp}
                      disabled={otpSending}
                    >
                      Resend Code
                    </button>
                  )}
                </div>
                {otpMessage && <div style={{ color: '#16a34a', fontSize: 12 }}>{otpMessage}</div>}
                {otpError && <div className="field-error-msg">{otpError}</div>}
              </div>
            )}

            {touched.email && errors.email && <div className="field-error-msg">{errors.email}</div>}
          </F>

          {/* Mobile Number Field */}
          <F label="Mobile No. * (10 Digits)">
            <input
              className={getFieldClass('mobile')}
              name="mobile"
              value={values.mobile}
              onChange={(e) => handleChange('mobile', e.target.value)}
              onBlur={() => handleBlur('mobile')}
              inputMode="numeric"
              maxLength={10}
              placeholder="e.g. 9876543210"
              required
            />
            {touched.mobile && errors.mobile && <div className="field-error-msg">{errors.mobile}</div>}
          </F>

          {/* Date of Birth Field */}
          <F label="Date of Birth *">
            <input
              className={getFieldClass('dob')}
              type="date"
              name="dob"
              max={todayStr()}
              value={values.dob}
              onChange={(e) => handleChange('dob', e.target.value)}
              onBlur={() => handleBlur('dob')}
              required
            />
            {touched.dob && errors.dob && <div className="field-error-msg">{errors.dob}</div>}
          </F>

          {/* Gender */}
          <F label="Gender *">
            <select
              className={getFieldClass('gender')}
              name="gender"
              value={values.gender}
              onChange={(e) => handleChange('gender', e.target.value)}
              onBlur={() => handleBlur('gender')}
            >
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
            {touched.gender && errors.gender && <div className="field-error-msg">{errors.gender}</div>}
          </F>

          {/* Qualification */}
          <F label="Qualification">
            <select
              className="input"
              name="qualification"
              value={values.qualification}
              onChange={(e) => handleChange('qualification', e.target.value)}
            >
              {QUALIFICATIONS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </F>

          {/* Aadhaar Number with Verhoeff Checksum */}
          <F label="Aadhaar No. (12 Digits)">
            <input
              className={getFieldClass('aadhar')}
              name="aadhar"
              value={values.aadhar}
              onChange={(e) => handleChange('aadhar', e.target.value)}
              onBlur={() => handleBlur('aadhar')}
              inputMode="numeric"
              maxLength={12}
              placeholder="12-digit Aadhaar"
            />
            {touched.aadhar && errors.aadhar && <div className="field-error-msg">{errors.aadhar}</div>}
          </F>

          {/* Food Preference */}
          <F label="Food Preference">
            <select
              className="input"
              name="food"
              value={values.food}
              onChange={(e) => handleChange('food', e.target.value)}
            >
              <option value="VEG">VEG</option>
              <option value="NON-VEG">NON-VEG</option>
            </select>
          </F>

          {/* Photo Capture */}
          <F label="Photo" span>
            <PhotoCapture value={photo} onChange={setPhoto} />
          </F>
        </div>
      </div>

      {/* ---------------- 2. Address ---------------- */}
      <div className="form-section">
        <div className="form-section-title">Address</div>
        <div className="form-grid">
          <F label="Address Line 1" span>
            <input
              className="input"
              name="address1"
              value={values.address1}
              onChange={(e) => handleChange('address1', e.target.value)}
              placeholder="Street name, landmark, locality"
            />
          </F>
          <F label="State" span>
            <input
              className="input"
              name="state"
              value={values.state}
              onChange={(e) => handleChange('state', e.target.value)}
              placeholder="State / Region"
            />
          </F>
        </div>
      </div>

      {/* ---------------- 3. Guardian Details ---------------- */}
      <div className="form-section">
        <div className="form-section-title">Guardian Details</div>
        <div className="form-grid">
          <F label="Guardian Name *">
            <input
              className={getFieldClass('guardianName')}
              name="guardianName"
              value={values.guardianName}
              onChange={(e) => handleChange('guardianName', e.target.value)}
              onBlur={() => handleBlur('guardianName')}
              placeholder="Parent or legal guardian name"
              required
            />
            {touched.guardianName && errors.guardianName && (
              <div className="field-error-msg">{errors.guardianName}</div>
            )}
          </F>

          <F label="Guardian Contact No. * (10 Digits)">
            <input
              className={getFieldClass('guardianContact')}
              name="guardianContact"
              value={values.guardianContact}
              onChange={(e) => handleChange('guardianContact', e.target.value)}
              onBlur={() => handleBlur('guardianContact')}
              inputMode="numeric"
              maxLength={10}
              placeholder="10-digit emergency contact"
              required
            />
            {touched.guardianContact && errors.guardianContact && (
              <div className="field-error-msg">{errors.guardianContact}</div>
            )}
          </F>
        </div>
      </div>

      {/* ---------------- 4. Employment ---------------- */}
      <div className="form-section">
        <div className="form-section-title">Employment</div>
        <div className="form-grid">
          <F label="Joining Date *">
            <input
              className={getFieldClass('joiningDate')}
              type="date"
              name="joiningDate"
              value={values.joiningDate}
              onChange={(e) => handleChange('joiningDate', e.target.value)}
              onBlur={() => handleBlur('joiningDate')}
              required
            />
            {touched.joiningDate && errors.joiningDate && (
              <div className="field-error-msg">{errors.joiningDate}</div>
            )}
          </F>
        </div>
      </div>

      {/* ---------------- 5. Additional Custom Fields ---------------- */}
      {customFields.length > 0 && (
        <div className="form-section">
          <div className="form-section-title">Additional Details</div>
          <div className="form-grid">
            {customFields.map((f) => (
              <F key={f.id} label={`${f.label}${f.required ? ' *' : ''}`}>
                <CustomInput
                  f={f}
                  value={customValues[f.id]}
                  onChange={(id, val) => setCustomValues((prev) => ({ ...prev, [id]: val }))}
                />
              </F>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- Foot & Submission ---------------- */}
      <div className="form-foot">
        <div className="muted">{note}</div>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!isFormValid || busy || submitting}
        >
          <Icon name="check" size={15} />{' '}
          {busy || submitting ? 'Submitting…' : submitText}
        </button>
      </div>
    </form>
  );
}
