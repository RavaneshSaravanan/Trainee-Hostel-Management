import express from 'express';
import rateLimit from 'express-rate-limit';
import { Config } from '../models/Config.js';
import { Trainee } from '../models/Trainee.js';
import { bumpRev } from '../models/Meta.js';
import { DEFAULT_CONFIG, withDefaults } from '../defaults.js';
import { nextId, todayStr } from '../utils/dates.js';

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

router.post('/public/register', registerLimiter, async (req, res) => {
  try {
    const config = await getConfig();
    if (!config.registrationOpen) {
      return res.status(403).json({ error: 'Registration is closed right now.' });
    }

    const d = req.body || {};
    const traineeId = String(d.traineeId || '').trim().toUpperCase();
    if (!traineeId || !String(d.name || '').trim() || !d.mobile) {
      return res.status(400).json({ error: 'Trainee ID, name and mobile are required.' });
    }

    const exists = await Trainee.findOne({ traineeId });
    if (exists) {
      return res.status(409).json({ error: 'This Trainee ID is already registered.' });
    }

    const clean = {};
    for (const k of [
      'name', 'mobile', 'email', 'dob', 'gender', 'qualification', 'aadhar', 'food',
      'photo', 'address1', 'district', 'state', 'guardianName', 'guardianContact',
      'joiningDate', 'defaultShift',
    ]) {
      clean[k] = typeof d[k] === 'string' ? d[k].slice(0, k === 'photo' ? 400000 : 200) : '';
    }

    const trainees = await Trainee.find({}, 'hostelId qrId').lean();
    const hostelId = nextId('HST', trainees.map((t) => t.hostelId), 4);
    const qrId = nextId('QR', trainees.map((t) => t.qrId), 5);

    await Trainee.create({
      ...clean,
      traineeId,
      hostelId,
      qrId,
      qrStatus: 'ACTIVE',
      custom: d.custom && typeof d.custom === 'object' ? d.custom : {},
      employmentStatus: 'ACTIVE',
      hostelStatus: 'PENDING REVIEW',
      hostel: '',
      roomNo: '',
      remarks: '',
      submissionDate: todayStr(),
      approvedBy: '',
      defaultShift: clean.defaultShift || 'G',
      joiningDate: clean.joiningDate || todayStr(),
    });

    await bumpRev();
    return res.json({ ok: true, hostelId, traineeId, qrId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
