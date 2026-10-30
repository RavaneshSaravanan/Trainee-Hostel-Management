import express from 'express';
import { auth } from '../middleware/auth.js';
import { Attendance } from '../models/Attendance.js';
import { Trainee } from '../models/Trainee.js';
import { bumpRev } from '../models/Meta.js';
import { todayStr } from '../utils/validity.js';

const router = express.Router();

const INELIGIBLE_STATUSES = ['PENDING REVIEW', 'PENDING_APPROVAL', 'REJECTED', 'RESIGNED', 'PERMANENT VACATE', 'INACTIVE'];

// ---------------- 1. High-Speed Scan / Manual Attendance Submission ----------------
router.post('/attendance/scan', auth, async (req, res) => {
  try {
    const {
      qrOrId = '',
      shift = 'A',
      date = todayStr(),
      method = 'QR_SCAN',
    } = req.body || {};

    let cleanInput = String(qrOrId).trim();
    // Parse URL if scanned from an ID card QR code (#/verify/:id)
    const urlMatch = cleanInput.match(/#\/verify\/([A-Za-z0-9_-]+)/);
    if (urlMatch) {
      cleanInput = urlMatch[1];
    }
    cleanInput = cleanInput.toUpperCase();
    if (!cleanInput) {
      return res.status(400).json({ error: 'Please scan a QR or enter a Trainee ID.' });
    }

    const cleanShift = String(shift).trim().toUpperCase() || 'A';
    const cleanDate = String(date).trim() || todayStr();

    // Find trainee by Trainee ID, QR ID, or Hostel ID
    const trainee = await Trainee.findOne({
      $or: [
        { traineeId: cleanInput },
        { qrId: cleanInput },
        { hostelId: cleanInput },
      ],
    }).lean();

    if (!trainee) {
      return res.status(404).json({
        ok: false,
        error: `Invalid QR or Trainee ID: "${cleanInput}". No matching trainee found.`,
      });
    }

    // Check Trainee Eligibility (must not be pending, rejected, resigned, or vacated)
    if (INELIGIBLE_STATUSES.includes(trainee.hostelStatus) || trainee.approvalStatus === 'REJECTED') {
      return res.status(403).json({
        ok: false,
        trainee: {
          traineeId: trainee.traineeId,
          name: trainee.name,
          photo: trainee.photo || '',
          hostelStatus: trainee.hostelStatus,
        },
        error: `Attendance Denied: ${trainee.name} (${trainee.traineeId}) is currently marked as ${trainee.hostelStatus}.`,
      });
    }

    // Check duplicate: strictly ONE attendance record for the same trainee, shift, and date
    const existingSameShift = await Attendance.findOne({
      traineeId: trainee.traineeId,
      date: cleanDate,
      shift: cleanShift,
    }).lean();

    if (existingSameShift) {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: `Already Scanned: ${trainee.name} is already marked for ${cleanShift} Shift on ${cleanDate}.`,
        trainee: {
          traineeId: trainee.traineeId,
          name: trainee.name,
          photo: trainee.photo || '',
          hostel: trainee.hostel || '',
          roomNo: trainee.roomNo || '',
          defaultShift: trainee.defaultShift || 'G',
        },
        existingRecord: existingSameShift,
      });
    }

    // Check if trainee has another shift on the same date (policy: flag or reject)
    const existingOtherShift = await Attendance.findOne({
      traineeId: trainee.traineeId,
      date: cleanDate,
    }).lean();

    if (existingOtherShift && cleanShift !== '12HRS') {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: `Attendance Conflict: ${trainee.name} is already marked for ${existingOtherShift.shift} Shift today.`,
        trainee: {
          traineeId: trainee.traineeId,
          name: trainee.name,
          photo: trainee.photo || '',
        },
      });
    }

    // Record new attendance
    const newRecord = await Attendance.create({
      traineeId: trainee.traineeId,
      date: cleanDate,
      shift: cleanShift,
      status: cleanShift,
      method: method === 'MANUAL_ID' ? 'MANUAL_ID' : 'QR_SCAN',
      scannedAt: new Date(),
      markedBy: req.user ? `${req.user.name} (${req.user.roleId})` : 'System',
    });

    await bumpRev();

    return res.json({
      ok: true,
      message: `✓ Attendance Recorded: ${trainee.name} marked for ${cleanShift} Shift`,
      record: newRecord,
      trainee: {
        traineeId: trainee.traineeId,
        name: trainee.name,
        photo: trainee.photo || '',
        hostel: trainee.hostel || 'Not Allocated',
        roomNo: trainee.roomNo || '—',
        defaultShift: trainee.defaultShift || 'G',
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: 'Already Scanned: Duplicate attendance record prevented by database constraint.',
      });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 2. Real-Time Session Statistics for Active Shift & Date ----------------
router.get('/attendance/session', auth, async (req, res) => {
  try {
    const { shift = 'A', date = todayStr() } = req.query || {};
    const cleanShift = String(shift).trim().toUpperCase();
    const cleanDate = String(date).trim();

    const [shiftRecords, allTodayRecords, totalActiveTrainees] = await Promise.all([
      Attendance.find({ date: cleanDate, shift: cleanShift }).sort({ scannedAt: -1 }).lean(),
      Attendance.find({ date: cleanDate }).lean(),
      Trainee.countDocuments({ hostelStatus: 'ACTIVE' }),
    ]);

    // Attach trainee names & photos to recent 30 scans
    const recentIds = shiftRecords.slice(0, 30).map((r) => r.traineeId);
    const trainees = await Trainee.find({ traineeId: { $in: recentIds } }, 'traineeId name photo hostel roomNo defaultShift').lean();
    const traineeMap = {};
    for (const t of trainees) traineeMap[t.traineeId] = t;

    const recentScans = shiftRecords.slice(0, 30).map((r) => ({
      ...r,
      trainee: traineeMap[r.traineeId] || { name: r.traineeId },
    }));

    return res.json({
      date: cleanDate,
      shift: cleanShift,
      shiftCount: shiftRecords.length,
      totalTodayCount: allTodayRecords.length,
      totalActiveTrainees,
      recentScans,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
