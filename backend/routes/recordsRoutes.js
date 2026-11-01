import express from 'express';
import { auth, requireSuper } from '../middleware/auth.js';
import { OutingVacate } from '../models/OutingVacate.js';
import { Leave } from '../models/Leave.js';
import { Resignation } from '../models/Resignation.js';
import { Trainee } from '../models/Trainee.js';
import { bumpRev } from '../models/Meta.js';
import { todayStr } from '../utils/dates.js';

const router = express.Router();

export function calculateDuration(outDate, outTime, inDate, inTime) {
  if (!outDate || !outTime || !inDate || !inTime) return '—';
  try {
    const start = new Date(`${outDate}T${outTime}`);
    const end = new Date(`${inDate}T${inTime}`);
    const diffMs = end - start;
    if (isNaN(diffMs) || diffMs < 0) return '0 mins';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    if (totalMinutes < 60) return `${totalMinutes} mins`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours < 24) {
      return mins > 0 ? `${hours} hr${hours > 1 ? 's' : ''} ${mins} min${mins > 1 ? 's' : ''}` : `${hours} hr${hours > 1 ? 's' : ''}`;
    }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days} day${days > 1 ? 's' : ''} ${remHours} hr${remHours > 1 ? 's' : ''}`;
  } catch (e) {
    return '—';
  }
}

async function getNextRecordId(model, prefix) {
  const last = await model.findOne({ id: new RegExp(`^${prefix}-`) }).sort({ createdAt: -1 }).lean();
  let max = 0;
  if (last && last.id) {
    const part = parseInt(last.id.split('-').pop(), 10);
    if (!isNaN(part)) max = part;
  }
  const next = max + 1;
  return `${prefix}-${String(next).padStart(4, '0')}`;
}

// ---------------- 1. OUTING: Departure (OUT) ----------------
router.post('/records/outing/out', auth, async (req, res) => {
  try {
    const { traineeId = '', qrOrId = '', outDate = todayStr(), outTime = '', purpose = '', reason = '', remarks = '' } = req.body || {};
    const cleanId = String(traineeId || qrOrId).trim().toUpperCase();

    if (!cleanId) return res.status(400).json({ error: 'Trainee ID or QR ID is required.' });
    if (!outDate) return res.status(400).json({ error: 'Departure date is required.' });
    if (!outTime) return res.status(400).json({ error: 'Departure time is required.' });

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }],
    });

    if (!trainee) {
      return res.status(404).json({ error: `Trainee "${cleanId}" not found.` });
    }

    // Check if trainee already has an open departure
    const openRecord = await OutingVacate.findOne({
      $or: [
        ...(trainee.traineeId ? [{ traineeId: trainee.traineeId }] : []),
        ...(trainee.qrId ? [{ qrId: trainee.qrId }] : []),
      ],
      type: 'OUTING',
      isCompleted: false,
      $or: [{ inTime: '' }, { inTime: { $exists: false } }],
    });

    if (openRecord) {
      return res.status(409).json({
        error: `Trainee "${trainee.name}" is already marked as OUT (Record ${openRecord.id} on ${openRecord.outDate} ${openRecord.outTime}). Please record their return (IN) first.`,
        openRecord,
      });
    }

    const id = await getNextRecordId(OutingVacate, 'OV');
    const record = await OutingVacate.create({
      id,
      traineeId: trainee.traineeId || '',
      qrId: trainee.qrId || '',
      traineeName: trainee.name,
      hostel: trainee.hostel || '',
      roomNo: trainee.roomNo || '',
      type: 'OUTING',
      purpose: purpose || reason || 'Outing',
      reason: reason || purpose || 'Outing',
      outDate,
      outTime,
      inDate: '',
      inTime: '',
      duration: '',
      isCompleted: false,
      date: outDate,
      fromDate: outDate,
      status: 'APPROVED',
      remarks,
      recordedBy: req.user ? `${req.user.name} (${req.user.roleId})` : 'System',
    });

    trainee.hostelStatus = 'OUTING';
    await trainee.save();
    await bumpRev();

    return res.json({
      ok: true,
      message: `Departure recorded for ${trainee.name}. Marked as OUTING.`,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 2. OUTING: Return (IN) ----------------
router.post('/records/outing/in', auth, async (req, res) => {
  try {
    const { id = '', traineeId = '', inDate = todayStr(), inTime = '', remarks = '' } = req.body || {};
    if (!inDate) return res.status(400).json({ error: 'Return date is required.' });
    if (!inTime) return res.status(400).json({ error: 'Return time is required.' });

    let record = null;
    if (id) {
      record = await OutingVacate.findOne({ id });
    } else if (traineeId) {
      const cleanId = String(traineeId).trim().toUpperCase();
      record = await OutingVacate.findOne({
        $or: [{ traineeId: cleanId }, { qrId: cleanId }],
        type: 'OUTING',
        isCompleted: false,
      }).sort({ createdAt: -1 });
    }

    if (!record) {
      return res.status(404).json({ error: 'No open outing departure record found to close.' });
    }

    if (record.isCompleted && record.inTime) {
      return res.status(400).json({ error: `Outing record ${record.id} is already completed.` });
    }

    // Validate return is not before departure
    const start = new Date(`${record.outDate || record.date}T${record.outTime || '00:00'}`);
    const end = new Date(`${inDate}T${inTime}`);
    if (end < start) {
      return res.status(400).json({ error: 'Return date and time cannot be before departure date and time.' });
    }

    const duration = calculateDuration(record.outDate || record.date, record.outTime || '00:00', inDate, inTime);

    record.inDate = inDate;
    record.inTime = inTime;
    record.duration = duration;
    record.isCompleted = true;
    record.expectedReturn = inDate;
    if (remarks) {
      record.remarks = record.remarks ? `${record.remarks}; ${remarks}` : remarks;
    }
    record.closedBy = req.user ? `${req.user.name} (${req.user.roleId})` : 'System';
    await record.save();

    // Restore trainee to ACTIVE
    await Trainee.updateOne(
      { $or: [{ traineeId: record.traineeId }, { qrId: record.qrId }] },
      { $set: { hostelStatus: 'ACTIVE' } }
    );

    await bumpRev();

    return res.json({
      ok: true,
      message: `Return recorded for ${record.traineeName}. Duration: ${duration}. Status restored to ACTIVE.`,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 3. LEAVE: Departure (OUT) ----------------
router.post('/records/leave/out', auth, async (req, res) => {
  try {
    const {
      traineeId = '',
      qrOrId = '',
      outDate = todayStr(),
      outTime = '',
      leaveType = 'Casual Leave',
      reason = '',
      remarks = '',
    } = req.body || {};
    const cleanId = String(traineeId || qrOrId).trim().toUpperCase();

    if (!cleanId) return res.status(400).json({ error: 'Trainee ID or QR ID is required.' });
    if (!outDate) return res.status(400).json({ error: 'Departure date is required.' });
    if (!outTime) return res.status(400).json({ error: 'Departure time is required.' });

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }],
    });

    if (!trainee) {
      return res.status(404).json({ error: `Trainee "${cleanId}" not found.` });
    }

    // Check open leave
    const openRecord = await Leave.findOne({
      $or: [
        ...(trainee.traineeId ? [{ traineeId: trainee.traineeId }] : []),
        ...(trainee.qrId ? [{ qrId: trainee.qrId }] : []),
      ],
      isCompleted: false,
      $or: [{ inTime: '' }, { inTime: { $exists: false } }],
    });

    if (openRecord) {
      return res.status(409).json({
        error: `Trainee "${trainee.name}" is already ON LEAVE (Record ${openRecord.id} on ${openRecord.outDate} ${openRecord.outTime}). Please record their return (IN) first.`,
        openRecord,
      });
    }

    const id = await getNextRecordId(Leave, 'LV');
    const record = await Leave.create({
      id,
      traineeId: trainee.traineeId || '',
      qrId: trainee.qrId || '',
      traineeName: trainee.name,
      hostel: trainee.hostel || '',
      roomNo: trainee.roomNo || '',
      leaveType,
      reason: reason || leaveType,
      outDate,
      outTime,
      inDate: '',
      inTime: '',
      duration: '',
      isCompleted: false,
      fromDate: outDate,
      toDate: outDate,
      days: 1,
      status: 'APPROVED',
      remarks,
      leaveDate: outDate,
      recordedBy: req.user ? `${req.user.name} (${req.user.roleId})` : 'System',
    });

    trainee.hostelStatus = 'ON LEAVE';
    await trainee.save();
    await bumpRev();

    return res.json({
      ok: true,
      message: `Leave departure recorded for ${trainee.name}. Marked as ON LEAVE.`,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 4. LEAVE: Return (IN) ----------------
router.post('/records/leave/in', auth, async (req, res) => {
  try {
    const { id = '', traineeId = '', inDate = todayStr(), inTime = '', remarks = '' } = req.body || {};
    if (!inDate) return res.status(400).json({ error: 'Return date is required.' });
    if (!inTime) return res.status(400).json({ error: 'Return time is required.' });

    let record = null;
    if (id) {
      record = await Leave.findOne({ id });
    } else if (traineeId) {
      const cleanId = String(traineeId).trim().toUpperCase();
      record = await Leave.findOne({
        $or: [{ traineeId: cleanId }, { qrId: cleanId }],
        isCompleted: false,
      }).sort({ createdAt: -1 });
    }

    if (!record) {
      return res.status(404).json({ error: 'No open leave record found to close.' });
    }

    if (record.isCompleted && record.inTime) {
      return res.status(400).json({ error: `Leave record ${record.id} is already completed.` });
    }

    const start = new Date(`${record.outDate || record.fromDate}T${record.outTime || '00:00'}`);
    const end = new Date(`${inDate}T${inTime}`);
    if (end < start) {
      return res.status(400).json({ error: 'Return date and time cannot be before departure date and time.' });
    }

    const duration = calculateDuration(record.outDate || record.fromDate, record.outTime || '00:00', inDate, inTime);
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.round((new Date(inDate) - new Date(record.outDate || record.fromDate)) / dayMs) + 1);

    record.inDate = inDate;
    record.inTime = inTime;
    record.duration = duration;
    record.toDate = inDate;
    record.days = days;
    record.isCompleted = true;
    if (remarks) {
      record.remarks = record.remarks ? `${record.remarks}; ${remarks}` : remarks;
    }
    record.closedBy = req.user ? `${req.user.name} (${req.user.roleId})` : 'System';
    await record.save();

    // Restore trainee to ACTIVE
    await Trainee.updateOne(
      { $or: [{ traineeId: record.traineeId }, { qrId: record.qrId }] },
      { $set: { hostelStatus: 'ACTIVE' } }
    );

    await bumpRev();

    return res.json({
      ok: true,
      message: `Leave return recorded for ${record.traineeName}. Duration: ${duration}. Status restored to ACTIVE.`,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 5. SUPER ADMIN ONLY: Delete Outing Record ----------------
router.delete('/records/outing/:id', auth, requireSuper, async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    const record = await OutingVacate.findOne({ id: cleanId });
    if (!record) {
      return res.status(404).json({ error: `Outing record "${cleanId}" not found.` });
    }

    // Safe deletion: If this outing was still open, restore trainee to ACTIVE
    if (!record.isCompleted || !record.inTime) {
      const trainee = await Trainee.findOne({
        $or: [
          ...(record.traineeId ? [{ traineeId: record.traineeId }] : []),
          ...(record.qrId ? [{ qrId: record.qrId }] : []),
        ],
      });
      if (trainee && ['OUTING', 'TEMPORARY VACATE'].includes(trainee.hostelStatus)) {
        trainee.hostelStatus = 'ACTIVE';
        await trainee.save();
      }
    }

    await OutingVacate.deleteOne({ id: cleanId });
    await bumpRev();

    return res.json({
      ok: true,
      message: `Outing record "${cleanId}" deleted successfully.`,
      id: cleanId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 6. SUPER ADMIN ONLY: Delete Leave Record ----------------
router.delete('/records/leave/:id', auth, requireSuper, async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    const record = await Leave.findOne({ id: cleanId });
    if (!record) {
      return res.status(404).json({ error: `Leave record "${cleanId}" not found.` });
    }

    // Safe deletion: If this leave was still open or trainee is marked ON LEAVE, restore trainee to ACTIVE
    if (!record.isCompleted || !record.inTime) {
      const trainee = await Trainee.findOne({
        $or: [
          ...(record.traineeId ? [{ traineeId: record.traineeId }] : []),
          ...(record.qrId ? [{ qrId: record.qrId }] : []),
        ],
      });
      if (trainee && trainee.hostelStatus === 'ON LEAVE') {
        trainee.hostelStatus = 'ACTIVE';
        await trainee.save();
      }
    }

    await Leave.deleteOne({ id: cleanId });
    await bumpRev();

    return res.json({
      ok: true,
      message: `Leave record "${cleanId}" deleted successfully.`,
      id: cleanId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 7. Submit Resignation Record ----------------
router.post('/records/resignation', auth, async (req, res) => {
  try {
    const { qrOrId, resignationDate = todayStr(), lastWorkingDay = '', reason = '', remarks = '' } = req.body || {};
    const cleanQuery = String(qrOrId || '').trim();
    if (!cleanQuery) return res.status(400).json({ error: 'Trainee ID or QR ID is required.' });

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanQuery }, { qrId: cleanQuery }],
    });
    if (!trainee) return res.status(404).json({ error: `Trainee "${cleanQuery}" not found.` });

    const existingResignations = await Resignation.find({}, 'id').lean();
    const id = `RSG-${String(existingResignations.length + 1).padStart(4, '0')}`;

    const record = await Resignation.create({
      id,
      traineeId: trainee.traineeId,
      traineeName: trainee.name,
      hostel: trainee.hostel || '',
      roomNo: trainee.roomNo || '',
      resignationDate,
      lastWorkingDay: lastWorkingDay || resignationDate,
      reason: reason || 'Personal Reason',
      remarks,
      recordedBy: req.user ? `${req.user.name} (${req.user.roleId})` : 'System',
    });

    trainee.employmentStatus = 'RESIGNED';
    await trainee.save();
    await bumpRev();

    return res.json({
      ok: true,
      message: `Resignation recorded for ${trainee.name}. Employment status marked as RESIGNED.`,
      record,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 8. SUPER ADMIN ONLY: Delete Resignation Record ----------------
router.delete('/records/resignation/:id', auth, requireSuper, async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    const record = await Resignation.findOne({ id: cleanId });
    if (!record) {
      return res.status(404).json({ error: `Resignation record "${cleanId}" not found.` });
    }

    // Safe deletion: Check if trainee was marked RESIGNED
    const trainee = await Trainee.findOne({
      $or: [{ traineeId: record.traineeId }, { qrId: record.traineeId }],
    });
    if (trainee && trainee.employmentStatus === 'RESIGNED') {
      const otherResignations = await Resignation.countDocuments({
        traineeId: record.traineeId,
        id: { $ne: cleanId },
      });
      if (otherResignations === 0) {
        trainee.employmentStatus = 'ACTIVE';
        await trainee.save();
      }
    }

    await Resignation.deleteOne({ id: cleanId });
    await bumpRev();

    return res.json({
      ok: true,
      message: `Resignation record "${cleanId}" deleted successfully.`,
      id: cleanId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
