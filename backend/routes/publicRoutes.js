import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Config } from '../models/Config.js';
import { Trainee } from '../models/Trainee.js';
import { Otp } from '../models/Otp.js';
import { User } from '../models/User.js';
import { bumpRev } from '../models/Meta.js';
import { DEFAULT_CONFIG, withDefaults } from '../defaults.js';
import { nextId, todayStr } from '../utils/dates.js';
import { addThreeCalendarMonths } from '../utils/validity.js';
import {
  sendApprovalRequestEmail,
  sendRegistrationOtpEmail,
  sendRegistrationConfirmationEmail,
  sendApprovalRequestNotification,
  getAdminNotificationEmail,
} from '../services/emailService.js';
import { uploadTraineePhoto, getPhotoStreamFromDrive, parsePhotoData } from '../services/googleDriveService.js';
import {
  isValidEmail,
  isValidPassword,
  isValidMobile,
  isValidGuardianContact,
  isValidAadhaar,
} from '../utils/validators.js';
import {
  encryptAadhaar,
  maskAadhaar,
  hashAadhaar,
} from '../utils/encryption.js';

const router = express.Router();

function maskEmail(email) {
  if (!email || typeof email !== 'string') return '***';
  const parts = email.split('@');
  if (parts.length !== 2) return '***';
  const name = parts[0];
  const domain = parts[1];
  const visible = name.slice(0, 2);
  return `${visible}***@${domain}`;
}

const JWT_SECRET = process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Safely drop obsolete unique index on plain-text aadhar if present in Mongo Atlas
Trainee.collection.dropIndex('aadhar_1').catch(() => {});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many registration requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many OTP requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function getConfig() {
  try {
    if (mongoose.connection.readyState === 1) {
      const configDoc = await Config.findOne({ key: 'main' }).lean();
      return withDefaults(configDoc || DEFAULT_CONFIG);
    }
  } catch (err) {
    console.warn('[Public Config] Falling back to default config:', err.message);
  }
  return withDefaults(DEFAULT_CONFIG);
}

router.get('/public', async (req, res) => {
  try {
    const config = await getConfig();
    return res.json({
      appName: config.appName,
      appSub: config.appSub,
      logo: config.logo,
      theme: config.theme,
      customFields: config.customFields,
      registrationOpen: config.registrationOpen,
    });
  } catch (err) {
    console.warn('[Public Route Error] Gracefully falling back to default config:', err.message);
    return res.json({
      appName: DEFAULT_CONFIG.appName,
      appSub: DEFAULT_CONFIG.appSub,
      logo: DEFAULT_CONFIG.logo,
      theme: DEFAULT_CONFIG.theme,
      customFields: DEFAULT_CONFIG.customFields,
      registrationOpen: DEFAULT_CONFIG.registrationOpen,
    });
  }
});

// ---------------- Public Digital ID Card Verification (No Sensitive Data Exposed) ----------------
router.get('/public/verify/:traineeId', async (req, res) => {
  try {
    const rawId = String(req.params.traineeId || '').trim();
    if (!rawId) {
      return res.status(400).json({ error: 'Trainee ID is required.' });
    }

    const cleanId = rawId.toUpperCase();
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`^${escapeRegex(rawId)}$`, 'i');

    const trainee = await Trainee.findOne({
      $or: [
        { traineeId: cleanId },
        { qrId: cleanId },
        { hostelId: cleanId },
        { traineeId: rx },
        { qrId: rx },
        { hostelId: rx },
      ],
    }).lean();

    if (!trainee) {
      return res.status(404).json({ error: 'Trainee not found or invalid QR code.' });
    }

    const config = await getConfig();

    // Permitted public details only - NEVER expose aadhar number or internal password hashes
    return res.json({
      ok: true,
      appName: config.appName,
      appSub: config.appSub,
      logo: config.logo,
      trainee: {
        traineeId: trainee.traineeId || '',
        hostelId: trainee.hostelId || '',
        qrId: trainee.qrId || '',
        name: trainee.name,
        photo: trainee.photo || '',
        email: trainee.email || '—',
        mobile: trainee.mobile || '—',
        guardianName: trainee.guardianName || '—',
        guardianContact: trainee.guardianContact || '—',
        gender: trainee.gender || '—',
        dob: trainee.dob || '—',
        qualification: trainee.qualification || 'Trainee',
        hostel: trainee.hostel || 'Hostel Campus',
        roomNo: trainee.roomNo || 'Unallocated',
        joiningDate: trainee.joiningDate || '—',
        freeStayExpiryDate: trainee.freeStayExpiryDate || '—',
        hostelStatus: trainee.hostelStatus || 'ACTIVE',
        approvalStatus: trainee.approvalStatus || 'APPROVED',
        verified: trainee.approvalStatus === 'APPROVED' && trainee.hostelStatus !== 'REJECTED',
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- Safe Photo Delivery (CORS Enabled for ID Cards & Canvas) ----------------
const serveTraineePhoto = async (req, res) => {
  try {
    const rawId = String(req.params.traineeId || '').trim();
    if (!rawId) return res.status(400).send('Trainee ID is required.');

    const cleanId = rawId.toUpperCase();
    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }, { hostelId: cleanId }],
    }).lean();

    if (!trainee) return res.status(404).send('Trainee not found.');

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // 1. If photo is stored in Google Drive
    if (trainee.photoDriveId) {
      const stream = await getPhotoStreamFromDrive(trainee.photoDriveId);
      if (stream) {
        res.setHeader('Content-Type', trainee.photoDriveMimeType || 'image/jpeg');
        return stream.pipe(res);
      }
    }

    // 2. If photo is stored as base64 in MongoDB
    if (trainee.photo && trainee.photo.startsWith('data:')) {
      const parsed = parsePhotoData(trainee.photo);
      if (parsed) {
        res.setHeader('Content-Type', parsed.mimeType || 'image/jpeg');
        return res.send(parsed.buffer);
      }
    }

    return res.status(404).send('No photograph available for this trainee.');
  } catch (err) {
    return res.status(500).send(err.message);
  }
};

router.get('/public/photo/:traineeId', serveTraineePhoto);
router.get('/trainees/:traineeId/photo', serveTraineePhoto);

// ---------------- Check Trainee ID Availability ----------------
const checkTraineeIdHandler = async (req, res) => {
  try {
    const rawId = String((req.method === 'GET' ? req.query.traineeId : req.body?.traineeId) || '').trim();
    if (!rawId) {
      return res.json({ available: true, message: '' });
    }

    const cleanId = rawId.toUpperCase();
    const exists = await Trainee.findOne({
      traineeId: { $regex: new RegExp(`^${escapeRegex(cleanId)}$`, 'i') },
    }).lean();

    if (exists) {
      return res.json({
        available: false,
        error: 'Trainee ID already exists. Please enter a different Trainee ID.',
      });
    }

    return res.json({
      available: true,
      message: 'Trainee ID is available.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

router.get('/public/check-trainee-id', checkTraineeIdHandler);
router.post('/public/check-trainee-id', checkTraineeIdHandler);

// ---------------- Send Registration Email OTP ----------------
router.post('/public/send-otp', otpLimiter, async (req, res) => {
  try {
    const { email } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    // Check if email already registered with an active trainee
    const existingTrainee = await Trainee.findOne({ email: cleanEmail }).lean();
    if (existingTrainee) {
      return res.status(409).json({ error: 'This email is already registered with another trainee.' });
    }

    // Cooldown check: 60 seconds
    const recentOtp = await Otp.findOne({
      identifier: cleanEmail,
      type: 'trainee-registration',
      used: false,
      createdAt: { $gt: new Date(Date.now() - 60 * 1000) },
    }).lean();

    if (recentOtp) {
      const waitSeconds = Math.max(1, Math.ceil((new Date(recentOtp.createdAt).getTime() + 60 * 1000 - Date.now()) / 1000));
      return res.status(429).json({ error: `Please wait ${waitSeconds} seconds before requesting a new OTP.` });
    }

    // Generate cryptographically secure 4-digit numeric OTP (1000 - 9999)
    const otpCode = String(crypto.randomInt(1000, 10000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Hash OTP before storing for security
    const hashedOtp = await bcrypt.hash(otpCode, 10);

    // Invalidate prior unused registration OTPs for this email
    await Otp.updateMany(
      { identifier: cleanEmail, type: 'trainee-registration', used: false },
      { $set: { used: true } }
    );

    // Save new OTP
    const newOtpDoc = await Otp.create({
      userId: 'anonymous',
      identifier: cleanEmail,
      otp: hashedOtp,
      type: 'trainee-registration',
      expiresAt,
    });

    console.log(`[OTP Generated] 4-digit code created for ${maskEmail(cleanEmail)} (expires in 5 min)`);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`\n---------------------------------------------------------`);
      console.log(`[LOCAL DEV OTP CODE] Email: ${cleanEmail} | OTP: ${otpCode}`);
      console.log(`---------------------------------------------------------\n`);
    }

    // Dispatch email
    const emailResult = await sendRegistrationOtpEmail({ email: cleanEmail, otp: otpCode });

    if (!emailResult || !emailResult.ok) {
      // Invalidate the created OTP so the user is not locked out by cooldown
      await Otp.deleteOne({ _id: newOtpDoc._id });

      const isUnconfigured = emailResult?.status === 'DEV_SIMULATED' && process.env.NODE_ENV === 'production';
      const errMsg = isUnconfigured
        ? 'Email service is not configured on the server. Please contact hostel administration.'
        : (emailResult?.error || 'Failed to deliver verification email. Please check your email address and try again.');

      console.error(`[OTP Dispatch Failed] Could not deliver to ${maskEmail(cleanEmail)}: ${emailResult?.error || 'Unknown dispatch error'}`);
      return res.status(400).json({
        ok: false,
        error: errMsg,
        code: 'OTP_DELIVERY_FAILED',
      });
    }

    console.log(`[OTP Dispatch Success] Delivered to ${maskEmail(cleanEmail)}`);
    return res.json({ ok: true, message: 'OTP sent successfully to your email.' });
  } catch (err) {
    console.error('[OTP Route Error]', err.message);
    return res.status(500).json({ error: err.message || 'Failed to send OTP.' });
  }
});

// ---------------- Verify Registration Email OTP ----------------
router.post('/public/verify-otp', otpLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanOtp = String(otp || '').trim();

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }

    if (!cleanOtp || !/^\d{4}$/.test(cleanOtp)) {
      return res.status(400).json({ error: 'Invalid OTP. Please enter a 4-digit code.' });
    }

    const otpDoc = await Otp.findOne({
      identifier: cleanEmail,
      type: 'trainee-registration',
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      console.warn(`[OTP Verification Failed] No active OTP found for ${maskEmail(cleanEmail)} (expired or used)`);
      return res.status(400).json({ error: 'Verification code has expired or is invalid. Please request a new code.' });
    }

    // Attempt limit check (max 5)
    if (otpDoc.attempts >= 5) {
      otpDoc.used = true;
      await otpDoc.save();
      console.warn(`[OTP Blocked] Max attempts exceeded for ${maskEmail(cleanEmail)}`);
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    // Support both hashed (bcrypt) and legacy plain text OTPs
    let isMatch = false;
    if (otpDoc.otp && (otpDoc.otp.startsWith('$2a') || otpDoc.otp.startsWith('$2b'))) {
      isMatch = await bcrypt.compare(cleanOtp, otpDoc.otp);
    } else {
      isMatch = (otpDoc.otp === cleanOtp);
    }

    if (!isMatch) {
      otpDoc.attempts += 1;
      if (otpDoc.attempts >= 5) {
        otpDoc.used = true;
      }
      await otpDoc.save();
      const remaining = Math.max(0, 5 - otpDoc.attempts);
      console.warn(`[OTP Failed] Incorrect code for ${maskEmail(cleanEmail)} (${remaining} attempts left)`);
      return res.status(400).json({
        error: remaining > 0
          ? `Incorrect OTP. You have ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Too many failed attempts. Please request a new OTP.',
      });
    }

    // Successful verification: mark used to prevent reuse
    otpDoc.used = true;
    await otpDoc.save();

    // Issue cryptographic verification token valid for 15 minutes
    const verificationToken = jwt.sign(
      { email: cleanEmail, verified: true, purpose: 'trainee-registration' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    console.log(`[OTP Verification Success] Email verified for ${maskEmail(cleanEmail)}`);

    return res.json({
      ok: true,
      message: 'Email verified successfully.',
      verificationToken,
    });
  } catch (err) {
    console.error('[OTP Verification Error]', err.message);
    return res.status(500).json({ error: err.message || 'Verification failed.' });
  }
});

router.post('/public/register', registerLimiter, async (req, res) => {
  try {
    const config = await getConfig();
    if (!config.registrationOpen) {
      return res.status(403).json({ error: 'Registration is closed right now.' });
    }

    const d = req.body || {};

    // 1. Mandatory Name Validation
    const name = String(d.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'This field is required.', field: 'name' });
    }

    // 2. Mandatory Email & OTP Verification Validation
    const email = String(d.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'This field is required.', field: 'email' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.', field: 'email' });
    }

    // Verification token check (strict cryptographic verification)
    const verificationToken = String(d.verificationToken || '').trim();
    if (!verificationToken) {
      return res.status(400).json({ error: 'Please verify your email before registration.', field: 'email' });
    }

    try {
      const decoded = jwt.verify(verificationToken, JWT_SECRET);
      if (!decoded.verified || decoded.email !== email || decoded.purpose !== 'trainee-registration') {
        return res.status(400).json({ error: 'Please verify your email before registration.', field: 'email' });
      }
    } catch {
      return res.status(400).json({ error: 'Please verify your email before registration.', field: 'email' });
    }

    // Check duplicate email
    const existingEmail = await Trainee.findOne({ email }).lean();
    if (existingEmail) {
      return res.status(409).json({ error: 'This email is already registered with another trainee.', field: 'email' });
    }

    // Optional password hashing if provided
    const password = String(d.password || '');
    const passwordHash = password ? await bcrypt.hash(password, 10) : '';

    // 4. Mandatory Mobile Number Validation
    const mobile = String(d.mobile || '').trim();
    if (!mobile) {
      return res.status(400).json({ error: 'This field is required.', field: 'mobile' });
    }
    if (!isValidMobile(mobile)) {
      return res.status(400).json({ error: 'Mobile number must contain exactly 10 valid digits.', field: 'mobile' });
    }

    // 5. Mandatory Date of Birth
    const dob = String(d.dob || '').trim();
    if (!dob) {
      return res.status(400).json({ error: 'This field is required.', field: 'dob' });
    }

    // 6. Mandatory Gender
    const gender = String(d.gender || '').trim();
    if (!gender) {
      return res.status(400).json({ error: 'This field is required.', field: 'gender' });
    }

    // 7. Mandatory Guardian Contact
    const guardianContact = String(d.guardianContact || '').trim();
    if (!guardianContact) {
      return res.status(400).json({ error: 'This field is required.', field: 'guardianContact' });
    }
    if (!isValidGuardianContact(guardianContact)) {
      return res.status(400).json({ error: 'Guardian Contact No. must contain exactly 10 digits.', field: 'guardianContact' });
    }

    // 8. Mandatory Guardian Name
    const guardianName = String(d.guardianName || '').trim();
    if (!guardianName) {
      return res.status(400).json({ error: 'This field is required.', field: 'guardianName' });
    }

    // 9. Mandatory Joining Date
    const rawJoiningDate = String(d.joiningDate || '').trim();
    const joiningDate = rawJoiningDate || todayStr();

    // 10. Aadhaar Number Validation, Verhoeff Checksum & Secure Masked + Encrypted Storage
    const rawAadhar = String(d.aadhar || '').replace(/\s+/g, '');
    let aadharMasked = '';
    let aadharEncrypted = '';
    let aadharHash = '';

    if (rawAadhar) {
      if (!isValidAadhaar(rawAadhar)) {
        return res.status(400).json({ error: 'Please enter a valid 12-digit Aadhaar number.', field: 'aadhar' });
      }

      aadharHash = hashAadhaar(rawAadhar);
      aadharEncrypted = encryptAadhaar(rawAadhar);
      aadharMasked = maskAadhaar(rawAadhar);

      // Check duplicate Aadhaar using hash and legacy raw value
      const existingAadhar = await Trainee.findOne({
        $or: [
          { aadharHash },
          { aadhar: rawAadhar },
        ],
      }).lean();

      if (existingAadhar) {
        return res.status(409).json({
          error: `This Aadhaar card number is already registered with another trainee (${existingAadhar.traineeId || existingAadhar.qrId}). Duplicate Aadhaar is not allowed.`,
        });
      }
    }

    // 11. Trainee ID (Optional; if supplied must not duplicate, case-insensitive)
    const rawTraineeId = String(d.traineeId || '').trim();
    let traineeId = '';
    if (rawTraineeId) {
      traineeId = rawTraineeId.toUpperCase();
      const exists = await Trainee.findOne({
        traineeId: { $regex: new RegExp(`^${escapeRegex(traineeId)}$`, 'i') },
      }).lean();
      if (exists) {
        return res.status(409).json({
          error: 'Trainee ID already exists. Please enter a different Trainee ID.',
          field: 'traineeId',
        });
      }
    }

    // Clean & prepare remaining fields
    const clean = {};
    for (const k of [
      'qualification', 'food', 'photo', 'address1', 'state',
    ]) {
      clean[k] = typeof d[k] === 'string' ? d[k].trim().slice(0, k === 'photo' ? 400000 : 200) : '';
    }

    clean.name = name;
    clean.email = email;
    clean.mobile = mobile;
    clean.dob = dob;
    clean.gender = gender;
    clean.guardianName = guardianName;
    clean.guardianContact = guardianContact;
    clean.joiningDate = joiningDate;
    clean.passwordHash = passwordHash;

    // Secure Aadhaar handling: Plain text is NEVER stored in database
    clean.aadhar = aadharMasked;
    clean.aadharMasked = aadharMasked;
    clean.aadharEncrypted = aadharEncrypted;
    clean.aadharHash = aadharHash;

    const trainees = await Trainee.find({}, 'hostelId qrId').lean();
    const hostelId = nextId('HST', trainees.map((t) => t.hostelId), 4);

    let qrId = nextId('QR', trainees.map((t) => t.qrId), 5);
    let counter = 1;
    while (await Trainee.exists({ qrId })) {
      qrId = `QR-${String(trainees.length + counter).padStart(5, '0')}`;
      counter++;
    }

    const freeStayExpiryDate = addThreeCalendarMonths(joiningDate);

    // Google Drive photo handling
    let photoDriveId = '';
    let photoDriveUrl = '';
    let photoDriveMimeType = 'image/jpeg';
    let photoDriveSize = 0;
    let finalPhoto = clean.photo || '';

    const photoIdentifier = traineeId || qrId;
    if (clean.photo) {
      try {
        const uploadResult = await uploadTraineePhoto({
          traineeId: photoIdentifier,
          photoInput: clean.photo,
        });
        if (uploadResult?.uploadedToDrive && uploadResult.fileId) {
          photoDriveId = uploadResult.fileId;
          photoDriveUrl = uploadResult.driveUrl;
          photoDriveMimeType = uploadResult.mimeType;
          photoDriveSize = uploadResult.size;
          finalPhoto = `/api/public/photo/${encodeURIComponent(photoIdentifier)}`;
        }
      } catch (uploadErr) {
        console.warn(`[Google Drive Photo Warning] ${photoIdentifier}: ${uploadErr.message}`);
      }
    }

    const finalTraineeId = traineeId || qrId;

    const newTrainee = await Trainee.create({
      ...clean,
      photo: finalPhoto,
      photoDriveId,
      photoDriveUrl,
      photoDriveMimeType,
      photoDriveSize,
      photoDriveUpdatedAt: photoDriveId ? new Date() : undefined,
      traineeId: finalTraineeId,
      hostelId,
      qrId,
      qrStatus: 'ACTIVE',
      custom: d.custom && typeof d.custom === 'object' ? d.custom : {},
      employmentStatus: 'ACTIVE',
      hostelStatus: 'PENDING REVIEW',
      approvalStatus: 'PENDING_APPROVAL',
      hostel: '',
      roomNo: '',
      remarks: '',
      submissionDate: todayStr(),
      approvedBy: '',
      joiningDate,
      freeStayExpiryDate,
      paymentStatus: 'FREE',
    });

    // 1. Dispatch Email 2: Trainee Registration Confirmation
    sendRegistrationConfirmationEmail({ trainee: newTrainee }).catch((err) =>
      console.warn('[Registration Confirmation Dispatch Error]', err.message)
    );

    // 2. Dispatch Email 3: Admin AND Warden Approval Request Notification (BOTH recipients)
    sendApprovalRequestNotification({ trainee: newTrainee }).catch((err) =>
      console.warn('[Admin/Warden Approval Notification Dispatch Error]', err.message)
    );

    await bumpRev();
    return res.json({ ok: true, hostelId, traineeId: finalTraineeId, qrId });
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.traineeId) {
        return res.status(409).json({
          error: 'Trainee ID already exists. Please enter a different Trainee ID.',
          field: 'traineeId',
        });
      }
      if (err.keyPattern?.aadharHash || err.keyPattern?.aadhar) {
        return res.status(409).json({
          error: 'This Aadhar card number is already registered with another trainee.',
          field: 'aadhar',
        });
      }
      return res.status(409).json({
        error: 'Trainee ID already exists. Please enter a different Trainee ID.',
        field: 'traineeId',
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

export default router;
