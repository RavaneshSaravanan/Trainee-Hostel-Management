import express from 'express';
import { auth } from '../middleware/auth.js';
import { Attendance } from '../models/Attendance.js';
import { Trainee } from '../models/Trainee.js';
import { bumpRev } from '../models/Meta.js';
import { todayStr } from '../utils/validity.js';

const router = express.Router();

const INELIGIBLE_STATUSES = ['PENDING REVIEW', 'PENDING_APPROVAL', 'REJECTED', 'RESIGNED', 'PERMANENT VACATE', 'INACTIVE'];
const formatShift = (s) => (s === 'WO' ? 'Week Off' : s === 'L' ? 'Leave' : `${s} Shift`);

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

    // Build trainee match filter
    const traineeFilter = [];
    if (trainee.qrId) traineeFilter.push({ qrId: trainee.qrId });
    if (trainee.traineeId) traineeFilter.push({ traineeId: trainee.traineeId });

    // Check duplicate: strictly ONE attendance record for the same trainee, shift, and date
    const existingSameShift = await Attendance.findOne({
      $or: traineeFilter.length > 0 ? traineeFilter : [{ traineeId: trainee.traineeId }],
      date: cleanDate,
      shift: cleanShift,
    }).lean();

    if (existingSameShift) {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: `Already Scanned: ${trainee.name} is already marked for ${formatShift(cleanShift)} on ${cleanDate}.`,
        trainee: {
          traineeId: trainee.traineeId,
          qrId: trainee.qrId,
          name: trainee.name,
          photo: trainee.photo || '',
          hostel: trainee.hostel || '',
          roomNo: trainee.roomNo || '',
        },
        existingRecord: existingSameShift,
      });
    }

    // Check if trainee has another shift on the same date (policy: flag or reject)
    const existingOtherShift = await Attendance.findOne({
      $or: traineeFilter.length > 0 ? traineeFilter : [{ traineeId: trainee.traineeId }],
      date: cleanDate,
    }).lean();

    if (existingOtherShift && cleanShift !== '12HRS') {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: `Attendance Conflict: ${trainee.name} is already marked for ${formatShift(existingOtherShift.shift)} today.`,
        trainee: {
          traineeId: trainee.traineeId,
          qrId: trainee.qrId,
          name: trainee.name,
          photo: trainee.photo || '',
        },
      });
    }

    // Record new attendance
    const newRecord = await Attendance.create({
      traineeId: trainee.traineeId || '',
      qrId: trainee.qrId || '',
      hostel: trainee.hostel || '',
      hostelId: trainee.hostelId || '',
      roomNo: trainee.roomNo || '',
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
      message: `✓ Attendance Recorded: ${trainee.name} marked for ${formatShift(cleanShift)}`,
      record: newRecord,
      trainee: {
        traineeId: trainee.traineeId,
        qrId: trainee.qrId,
        name: trainee.name,
        photo: trainee.photo || '',
        hostel: trainee.hostel || 'Not Allocated',
        roomNo: trainee.roomNo || '—',
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
    const trainees = await Trainee.find({ traineeId: { $in: recentIds } }, 'traineeId name photo hostel roomNo').lean();
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

// ---------------- 3. Hostel-Wise Daily Scan Completion Tracker ----------------
router.get('/attendance/hostel-tracker', auth, async (req, res) => {
  try {
    const { hostel = '', hostelId = '', date = todayStr() } = req.query || {};
    const cleanHostel = String(hostel).trim();
    const cleanHostelId = String(hostelId).trim();
    const cleanDate = String(date).trim() || todayStr();

    if (!cleanHostel && !cleanHostelId) {
      return res.status(400).json({ error: 'Hostel name or Hostel ID is required.' });
    }

    // 1. Living Member Count: Trainees active with room in that hostel (includes temporary outing/leave)
    const orConds = [];
    if (cleanHostel) orConds.push({ hostel: cleanHostel });
    if (cleanHostelId) orConds.push({ hostelId: cleanHostelId });

    const livingQuery = {
      $or: orConds,
      hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
      roomNo: { $exists: true, $ne: '' },
    };

    const livingTrainees = await Trainee.find(
      livingQuery,
      'traineeId qrId name hostel hostelId roomNo hostelStatus'
    )
      .sort({ roomNo: 1, name: 1 })
      .lean();

    // 2. Fetch all attendance records for this date
    const attendanceRecords = await Attendance.find({ date: cleanDate }).lean();

    const scannedMap = new Map();
    for (const att of attendanceRecords) {
      if (att.qrId) scannedMap.set(att.qrId, att);
      if (att.traineeId) scannedMap.set(att.traineeId, att);
    }

    // 3. Separate scanned vs not-yet-scanned
    const scannedTrainees = [];
    const notScannedList = [];

    livingTrainees.forEach((t) => {
      const record = (t.qrId && scannedMap.get(t.qrId)) || (t.traineeId && scannedMap.get(t.traineeId));
      if (record) {
        scannedTrainees.push({
          trainee: t,
          attendance: record,
        });
      } else {
        notScannedList.push({
          sNo: notScannedList.length + 1,
          traineeName: t.name,
          traineeId: t.traineeId || '—',
          qrId: t.qrId || '—',
          hostelName: t.hostel,
          roomNumber: t.roomNo || '—',
          department: t.qualification || '—',
          attendanceStatus: 'Not Yet Scanned',
        });
      }
    });

    const totalLiving = livingTrainees.length;
    const scannedCount = scannedTrainees.length;
    const notScannedCount = notScannedList.length;
    const completionPct = totalLiving === 0 ? 100 : Math.round((scannedCount / totalLiving) * 100);
    const isCompleted = totalLiving > 0 && scannedCount === totalLiving;

    return res.json({
      ok: true,
      hostel: cleanHostel || cleanHostelId,
      date: cleanDate,
      totalLiving,
      scannedCount,
      notScannedCount,
      completionPct,
      isCompleted,
      completionStatus: isCompleted ? 'Hostel Daily Attendance Completed' : 'In Progress',
      notScannedList,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 4. Hostel-Wise Daily Scan Submission ----------------
router.post('/attendance/hostel-scan', auth, async (req, res) => {
  try {
    const {
      qrOrId = '',
      hostel = '',
      hostelId = '',
      shift = 'A',
      date = todayStr(),
      method = 'QR_SCAN',
    } = req.body || {};

    let cleanInput = String(qrOrId).trim();
    const urlMatch = cleanInput.match(/#\/verify\/([A-Za-z0-9_-]+)/);
    if (urlMatch) cleanInput = urlMatch[1];
    cleanInput = cleanInput.toUpperCase();
    if (!cleanInput) {
      return res.status(400).json({ error: 'Please scan a QR or enter a Trainee ID.' });
    }

    const cleanHostel = String(hostel).trim();
    const cleanHostelId = String(hostelId).trim();
    const cleanShift = String(shift).trim().toUpperCase() || 'A';
    const cleanDate = String(date).trim() || todayStr();

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

    // Check Trainee Eligibility
    if (INELIGIBLE_STATUSES.includes(trainee.hostelStatus) || trainee.approvalStatus === 'REJECTED') {
      return res.status(403).json({
        ok: false,
        trainee: {
          traineeId: trainee.traineeId,
          qrId: trainee.qrId,
          name: trainee.name,
          photo: trainee.photo || '',
          hostelStatus: trainee.hostelStatus,
        },
        error: `Attendance Denied: ${trainee.name} is currently marked as ${trainee.hostelStatus}.`,
      });
    }

    // Cross-Hostel Scan Guard: Block cross-hostel scans
    const matchesHostel =
      (cleanHostel && trainee.hostel && trainee.hostel.toLowerCase() === cleanHostel.toLowerCase()) ||
      (cleanHostelId && trainee.hostelId && trainee.hostelId.toLowerCase() === cleanHostelId.toLowerCase());

    if (!matchesHostel) {
      return res.status(400).json({
        ok: false,
        hostelMismatch: true,
        error: `Hostel Mismatch: Trainee "${trainee.name}" (${trainee.traineeId || trainee.qrId}) is assigned to "${trainee.hostel || 'Unallocated'}", not "${cleanHostel || cleanHostelId}". Attendance rejected.`,
        trainee: {
          traineeId: trainee.traineeId,
          qrId: trainee.qrId,
          name: trainee.name,
          hostel: trainee.hostel,
          roomNo: trainee.roomNo,
        },
      });
    }

    // Check duplicate
    const traineeFilter = [];
    if (trainee.qrId) traineeFilter.push({ qrId: trainee.qrId });
    if (trainee.traineeId) traineeFilter.push({ traineeId: trainee.traineeId });

    const existingSameShift = await Attendance.findOne({
      $or: traineeFilter.length > 0 ? traineeFilter : [{ traineeId: trainee.traineeId }],
      date: cleanDate,
      shift: cleanShift,
    }).lean();

    if (existingSameShift) {
      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: `Already Scanned: ${trainee.name} is already marked for ${formatShift(cleanShift)} on ${cleanDate}.`,
        trainee: {
          traineeId: trainee.traineeId,
          qrId: trainee.qrId,
          name: trainee.name,
          photo: trainee.photo || '',
          hostel: trainee.hostel || '',
          roomNo: trainee.roomNo || '',
        },
        existingRecord: existingSameShift,
      });
    }

    // Record new attendance
    const newRecord = await Attendance.create({
      traineeId: trainee.traineeId || '',
      qrId: trainee.qrId || '',
      hostel: trainee.hostel || cleanHostel,
      hostelId: trainee.hostelId || cleanHostelId,
      roomNo: trainee.roomNo || '',
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
      message: `✓ Attendance Recorded: ${trainee.name} marked for ${formatShift(cleanShift)}`,
      record: newRecord,
      trainee: {
        traineeId: trainee.traineeId,
        qrId: trainee.qrId,
        name: trainee.name,
        photo: trainee.photo || '',
        hostel: trainee.hostel || cleanHostel,
        roomNo: trainee.roomNo || '—',
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

export default router;
