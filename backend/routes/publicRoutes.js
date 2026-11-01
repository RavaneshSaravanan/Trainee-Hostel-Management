import express from 'express';
import rateLimit from 'express-rate-limit';
import { Config } from '../models/Config.js';
import { Trainee } from '../models/Trainee.js';
import { bumpRev } from '../models/Meta.js';
import { DEFAULT_CONFIG, withDefaults } from '../defaults.js';
import { nextId, todayStr } from '../utils/dates.js';
import { addThreeCalendarMonths } from '../utils/validity.js';
import { sendApprovalRequestEmail } from '../services/emailService.js';
import { uploadTraineePhoto, getPhotoStreamFromDrive, parsePhotoData } from '../services/googleDriveService.js';

const router = express.Router();

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many registration requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

async function getConfig() {
  const configDoc = await Config.findOne({ key: 'main' }).lean();
  return withDefaults(configDoc || DEFAULT_CONFIG);
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
    return res.status(500).json({ error: err.message });
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
    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }, { hostelId: cleanId }],
    }).lean();

    if (!trainee) {
      return res.status(404).json({ error: 'Trainee not found or invalid QR code.' });
    }

    const config = await getConfig();

    // Permitted public details only - NEVER expose aadhar, sensitive contacts, or tokens
    return res.json({
      ok: true,
      appName: config.appName,
      appSub: config.appSub,
      logo: config.logo,
      trainee: {
        traineeId: trainee.traineeId,
        hostelId: trainee.hostelId,
        name: trainee.name,
        photo: trainee.photo || '',
        gender: trainee.gender,
        qualification: trainee.qualification || 'Trainee',
        mobile: trainee.mobile || '—',
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

router.post('/public/register', registerLimiter, async (req, res) => {
  try {
    const config = await getConfig();
    if (!config.registrationOpen) {
      return res.status(403).json({ error: 'Registration is closed right now.' });
    }

    const d = req.body || {};
    const name = String(d.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: 'Trainee name is required.' });
    }

    // 1. Mobile Number Validation: Exactly 10 digits, numbers only
    const rawMobile = String(d.mobile || '').trim();
    if (!/^\d{10}$/.test(rawMobile)) {
      return res.status(400).json({
        error: 'Mobile number must be exactly 10 digits (numbers only, no alphabets or special characters).',
      });
    }

    // 2. Trainee ID: Optional on initial registration. If provided, must not duplicate
    const traineeId = String(d.traineeId || '').trim().toUpperCase();
    if (traineeId) {
      const exists = await Trainee.findOne({ traineeId });
      if (exists) {
        return res.status(409).json({ error: `Trainee ID "${traineeId}" is already registered. Please enter a different ID or leave empty.` });
      }
    }

    // 3. Aadhaar Number Validation: Exactly 12 digits, numbers only
    const rawAadhar = String(d.aadhar || '').trim();
    let cleanAadhar = '';
    if (rawAadhar) {
      cleanAadhar = rawAadhar.replace(/\D/g, '');
      if (cleanAadhar.length !== 12) {
        return res.status(400).json({ error: 'Aadhaar card number must be exactly 12 digits (numbers only).' });
      }

      // Check duplicate Aadhaar
      const aadharPattern = new RegExp('^\\D*' + cleanAadhar.split('').join('\\D*') + '\\D*$');
      const existingAadhar = await Trainee.findOne({ aadhar: { $regex: aadharPattern } });
      if (existingAadhar) {
        return res.status(409).json({
          error: `This Aadhaar card number is already registered with another trainee (${existingAadhar.traineeId || existingAadhar.qrId}). Duplicate Aadhaar is not allowed.`,
        });
      }
    }

    // 4. Email Address Validation: Must end with @gmail.com
    const rawEmail = String(d.email || '').trim().toLowerCase();
    if (rawEmail) {
      if (!/^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(rawEmail)) {
        return res.status(400).json({
          error: 'Email address must be a valid @gmail.com address (other email domains are rejected).',
        });
      }
    }

    const clean = {};
    for (const k of [
      'name', 'mobile', 'email', 'dob', 'gender', 'qualification', 'aadhar', 'food',
      'photo', 'address1', 'state', 'guardianName', 'guardianContact',
      'joiningDate',
    ]) {
      clean[k] = typeof d[k] === 'string' ? d[k].slice(0, k === 'photo' ? 400000 : 200) : '';
    }
    clean.name = name;
    clean.mobile = rawMobile;
    clean.email = rawEmail;
    if (cleanAadhar) clean.aadhar = cleanAadhar;

    const trainees = await Trainee.find({}, 'hostelId qrId').lean();
    const hostelId = nextId('HST', trainees.map((t) => t.hostelId), 4);
    
    // Auto-generate guaranteed unique QR ID
    let qrId = nextId('QR', trainees.map((t) => t.qrId), 5);
    let counter = 1;
    while (await Trainee.exists({ qrId })) {
      qrId = `QR-${String(trainees.length + counter).padStart(5, '0')}`;
      counter++;
    }

    const joiningDate = clean.joiningDate || todayStr();
    const freeStayExpiryDate = addThreeCalendarMonths(joiningDate);

    // Upload photograph to Google Drive if provided
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

    // Notify configured approval authorities by email
    const approvers = config.approvalConfig?.approvers || [];
    for (const approver of approvers) {
      sendApprovalRequestEmail({ approver, trainee: newTrainee }).catch((err) =>
        console.warn('Approver email alert failed:', err.message)
      );
    }

    await bumpRev();
    return res.json({ ok: true, hostelId, traineeId: finalTraineeId, qrId });
  } catch (err) {
    if (err.code === 11000) {
      if (err.keyPattern?.aadhar) {
        return res.status(409).json({ error: 'This Aadhar card number is already registered with another trainee.' });
      }
      return res.status(409).json({ error: 'This Trainee ID is already registered.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

export default router;
