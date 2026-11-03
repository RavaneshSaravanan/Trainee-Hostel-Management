import express from 'express';
import { auth, requireSuper } from '../middleware/auth.js';
import { Hostel } from '../models/Hostel.js';
import { Trainee } from '../models/Trainee.js';
import { Attendance } from '../models/Attendance.js';
import { Leave } from '../models/Leave.js';
import { OutingVacate } from '../models/OutingVacate.js';
import { Resignation } from '../models/Resignation.js';
import { Remark } from '../models/Remark.js';
import { RoomHistory } from '../models/RoomHistory.js';
import { DailySummary } from '../models/DailySummary.js';
import { Config } from '../models/Config.js';
import { Role } from '../models/Role.js';
import { User } from '../models/User.js';
import { getRev, bumpRev } from '../models/Meta.js';
import { DEFAULT_CONFIG, DEFAULT_ROLES, SUPER_ROLE, withDefaults } from '../defaults.js';
import { addThreeCalendarMonths } from '../utils/validity.js';
import { fmtDate } from '../utils/dates.js';
import { sendTraineeWelcomeEmail, sendTraineeIdCardEmail } from '../services/emailService.js';
import { validateCapacityReduction } from '../services/roomService.js';

const router = express.Router();

function sanitizeForSet(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const { _id, __v, createdAt, updatedAt, ...clean } = obj;
  return clean;
}

export async function buildStateForUser(user) {
  const rev = await getRev();

  const [
    hostels,
    trainees,
    attendance,
    leaves,
    outingVacate,
    resignations,
    remarks,
    roomHistory,
    dailySummaries,
    configDoc,
    roleDocs,
  ] = await Promise.all([
    Hostel.find({}, { _id: 0, __v: 0 }).lean(),
    Trainee.find({}, { _id: 0, __v: 0 }).lean(),
    Attendance.find({}, { _id: 0, __v: 0 }).lean(),
    Leave.find({}, { _id: 0, __v: 0 }).lean(),
    OutingVacate.find({}, { _id: 0, __v: 0 }).lean(),
    Resignation.find({}, { _id: 0, __v: 0 }).lean(),
    Remark.find({}, { _id: 0, __v: 0 }).lean(),
    RoomHistory.find({}, { _id: 0, __v: 0 }).lean(),
    DailySummary.find({}, { _id: 0, __v: 0 }).lean(),
    Config.findOne({ key: 'main' }, { _id: 0, __v: 0, key: 0 }).lean(),
    Role.find({}, { _id: 0, __v: 0 }).lean(),
  ]);

  const dailySummary = {};
  for (const ds of dailySummaries) {
    if (ds && ds.date) {
      dailySummary[ds.date] = ds;
    }
  }

  let roles = roleDocs;
  if (!roles || roles.length === 0) {
    roles = DEFAULT_ROLES;
  } else if (!roles.some((r) => r.id === SUPER_ROLE)) {
    roles = [DEFAULT_ROLES[0], ...roles];
  }

  const isSuper = user && user.roleId === SUPER_ROLE;
  let users = [];
  if (isSuper) {
    const userDocs = await User.find({}, { passwordHash: 0, _id: 0, __v: 0 }).lean();
    users = userDocs.map((u) => ({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email || '',
      mobile: u.mobile || '',
      roleId: u.roleId,
      active: u.active,
    }));
  }

  return {
    rev,
    db: {
      hostels,
      trainees,
      attendance,
      leaves,
      outingVacate,
      resignations,
      remarks,
      roomHistory,
      dailySummary,
    },
    config: withDefaults(configDoc || DEFAULT_CONFIG),
    roles,
    users,
  };
}

// GET /api/rev (Revision polling + safe reviews summary)
router.get(['/rev', '/reviews/summary'], async (req, res) => {
  try {
    const rev = await getRev();
    let count = 0;
    let reviews = [];
    try {
      reviews = await Trainee.find({
        $or: [
          { approvalStatus: 'PENDING_APPROVAL' },
          { hostelStatus: 'PENDING REVIEW' },
          { hostelStatus: 'PENDING APPROVAL' },
        ],
      })
        .select('traineeId name email mobile hostel roomNo approvalStatus hostelStatus createdAt')
        .lean();
      count = reviews.length;
    } catch {
      // Gracefully ignore query if Trainee collection is momentarily busy
    }

    return res.json({
      ok: true,
      rev: typeof rev === 'number' ? rev : 1,
      reviews: reviews || [],
      count: count || 0,
    });
  } catch (err) {
    // Never fail rev polling: return safe default revision 1
    return res.json({ ok: true, rev: 1, reviews: [], count: 0 });
  }
});

// GET /api/state (auth)
router.get('/state', auth, async (req, res) => {
  try {
    const state = await buildStateForUser(req.user);
    return res.json(state);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/trainees/export (auth: downloads all genuine MongoDB trainee records)
router.get('/trainees/export', auth, async (req, res) => {
  try {
    const trainees = await Trainee.find({}).sort({ createdAt: -1 }).lean();

    const headers = [
      'Trainee ID',
      'Full Name',
      'Phone Number',
      'Email',
      'Date of Birth',
      'Gender',
      'Qualification',
      'Food Preference',
      'Address',
      'State',
      'Guardian Name',
      'Guardian Contact',
      'Joining Date',
      'Free Stay Expiry Date',
      'Employment Status',
      'Hostel Status',
      'Approval Status',
      'Hostel Name',
      'Room Number',
      'QR ID',
      'Payment Status',
      'Approved By',
      'Submission Date',
    ];

    const rows = trainees.map((t) => [
      t.traineeId || '',
      t.name || '',
      t.mobile || '',
      t.email || '',
      fmtDate(t.dob),
      t.gender || '',
      t.qualification || '',
      t.food || '',
      t.address1 || '',
      t.state || '',
      t.guardianName || '',
      t.guardianContact || '',
      fmtDate(t.joiningDate),
      fmtDate(t.freeStayExpiryDate),
      t.employmentStatus || '',
      t.hostelStatus || '',
      t.approvalStatus || '',
      t.hostel || '',
      t.roomNo || '',
      t.qrId || '',
      t.paymentStatus || 'FREE',
      t.approvedBy || '',
      fmtDate(t.submissionDate),
    ]);

    const format = req.query.format || 'json';
    if (format === 'csv') {
      const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
      const csv = [headers, ...rows].map((r) => r.map(q).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="all-trainees-${new Date().toISOString().slice(0, 10)}.csv"`
      );
      return res.send(csv);
    }

    return res.json({
      ok: true,
      headers,
      rows,
      count: trainees.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/hostels/:hostelId (Super Admin only: safe deletion with active occupancy check)
router.delete('/hostels/:hostelId', auth, requireSuper, async (req, res) => {
  try {
    const rawId = req.params.hostelId || '';
    const cleanId = String(rawId).trim();

    const hostel = await Hostel.findOne({
      $or: [{ id: cleanId }, { name: cleanId }],
    });

    if (!hostel) {
      return res.status(404).json({ error: `Hostel "${cleanId}" not found.` });
    }

    // Check if any active trainees are assigned to this hostel
    const activeOccupants = await Trainee.find({
      $or: [{ hostel: hostel.name }, { hostelId: hostel.id }],
      hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
      roomNo: { $exists: true, $ne: '' },
    }).lean();

    if (activeOccupants.length > 0) {
      const sampleNames = activeOccupants
        .slice(0, 5)
        .map((t) => `${t.name} (Room ${t.roomNo})`)
        .join(', ');
      return res.status(400).json({
        error: `Cannot delete hostel "${hostel.name}". There are ${activeOccupants.length} active trainee(s) currently residing here: ${sampleNames}${activeOccupants.length > 5 ? '...' : ''}. Please reassign them to another hostel before deleting.`,
        activeCount: activeOccupants.length,
      });
    }

    // Delete hostel record from MongoDB
    await Hostel.deleteOne({ id: hostel.id });
    await bumpRev();

    return res.json({
      ok: true,
      message: `Hostel "${hostel.name}" was successfully deleted.`,
      hostelId: hostel.id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/hostels/:hostelId/rooms/:roomNo (Super Admin only: safe room deletion with active occupancy check)
router.delete('/hostels/:hostelId/rooms/:roomNo', auth, requireSuper, async (req, res) => {
  try {
    const rawHostelId = req.params.hostelId || '';
    const rawRoomNo = req.params.roomNo || '';
    const cleanHostelId = String(rawHostelId).trim();
    const cleanRoomNo = String(rawRoomNo).trim();

    const hostel = await Hostel.findOne({
      $or: [{ id: cleanHostelId }, { name: cleanHostelId }],
    });

    if (!hostel) {
      return res.status(404).json({ error: `Hostel "${cleanHostelId}" not found.` });
    }

    const roomExists = (hostel.rooms || []).some((r) => String(r.no) === cleanRoomNo);
    if (!roomExists) {
      return res.status(404).json({ error: `Room "${cleanRoomNo}" not found in hostel "${hostel.name}".` });
    }

    // Check if any active trainees are assigned to this room
    const activeOccupants = await Trainee.find({
      $or: [{ hostel: hostel.name }, { hostelId: hostel.id }],
      roomNo: cleanRoomNo,
      hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
    }).lean();

    if (activeOccupants.length > 0) {
      const sampleNames = activeOccupants
        .slice(0, 5)
        .map((t) => `${t.name} (${t.traineeId || t.qrId})`)
        .join(', ');
      return res.status(400).json({
        error: `Cannot delete Room "${cleanRoomNo}". There are ${activeOccupants.length} active trainee(s) currently residing here: ${sampleNames}${activeOccupants.length > 5 ? '...' : ''}. Please reassign them to another room before deleting.`,
        activeCount: activeOccupants.length,
      });
    }

    // Atomically pull room from hostel.rooms array
    await Hostel.updateOne({ _id: hostel._id }, { $pull: { rooms: { no: cleanRoomNo } } });
    await bumpRev();

    return res.json({
      ok: true,
      message: `Room "${cleanRoomNo}" in hostel "${hostel.name}" was successfully deleted.`,
      hostelId: hostel.id,
      roomNo: cleanRoomNo,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/state (auth)
router.put('/state', auth, async (req, res) => {
  try {
    const { db, config, roles } = req.body || {};
    const isSuper = req.user.roleId === SUPER_ROLE;

    if (db && typeof db === 'object') {
      if (Array.isArray(db.hostels) && db.hostels.length > 0) {
        // Enforce capacity rule: cannot reduce room capacity below current active occupancy
        for (const h of db.hostels) {
          if (h && Array.isArray(h.rooms)) {
            for (const r of h.rooms) {
              if (r && r.no && r.capacity !== undefined) {
                if (typeof validateCapacityReduction === 'function') {
                  await validateCapacityReduction(h.id || h.name, r.no, r.capacity);
                }
              }
            }
          }
        }
        await Hostel.bulkWrite(
          db.hostels.filter((h) => h && h.id).map((h) => ({
            updateOne: {
              filter: { id: h.id },
              update: { $set: sanitizeForSet(h) },
              upsert: true,
            },
          }))
        );
      }

      if (Array.isArray(db.trainees) && db.trainees.length > 0) {
        await Trainee.bulkWrite(
          db.trainees.filter((t) => t && (t.traineeId || t.qrId)).map((t) => {
            const data = sanitizeForSet(t);
            if (data.joiningDate && !data.freeStayExpiryDate) {
              data.freeStayExpiryDate = addThreeCalendarMonths(data.joiningDate);
            }
            const filter = t.traineeId ? { traineeId: t.traineeId } : { qrId: t.qrId };
            return {
              updateOne: {
                filter,
                update: { $set: data },
                upsert: true,
              },
            };
          })
        );

        // State sync completed cleanly without redundant email triggers
      }

      if (Array.isArray(db.attendance) && db.attendance.length > 0) {
        await Attendance.bulkWrite(
          db.attendance.filter((a) => a && (a.traineeId || a.qrId) && a.date).map((a) => {
            const filter = a.traineeId
              ? { traineeId: a.traineeId, date: a.date }
              : { qrId: a.qrId, date: a.date };
            return {
              updateOne: {
                filter,
                update: { $set: sanitizeForSet(a) },
                upsert: true,
              },
            };
          })
        );
      }

      if (Array.isArray(db.leaves) && db.leaves.length > 0) {
        await Leave.bulkWrite(
          db.leaves.filter((l) => l && l.id).map((l) => ({
            updateOne: {
              filter: { id: l.id },
              update: { $set: sanitizeForSet(l) },
              upsert: true,
            },
          }))
        );
      }

      if (Array.isArray(db.outingVacate) && db.outingVacate.length > 0) {
        await OutingVacate.bulkWrite(
          db.outingVacate.filter((o) => o && o.id).map((o) => ({
            updateOne: {
              filter: { id: o.id },
              update: { $set: sanitizeForSet(o) },
              upsert: true,
            },
          }))
        );
      }

      if (Array.isArray(db.resignations) && db.resignations.length > 0) {
        await Resignation.bulkWrite(
          db.resignations.filter((r) => r && r.id).map((r) => ({
            updateOne: {
              filter: { id: r.id },
              update: { $set: sanitizeForSet(r) },
              upsert: true,
            },
          }))
        );
      }

      if (Array.isArray(db.remarks) && db.remarks.length > 0) {
        await Remark.bulkWrite(
          db.remarks.filter((rm) => rm && rm.id).map((rm) => ({
            updateOne: {
              filter: { id: rm.id },
              update: { $set: sanitizeForSet(rm) },
              upsert: true,
            },
          }))
        );
      }

      if (Array.isArray(db.roomHistory) && db.roomHistory.length > 0) {
        await RoomHistory.bulkWrite(
          db.roomHistory.filter((rh) => rh && rh.traineeId).map((rh) => ({
            updateOne: {
              filter: {
                traineeId: rh.traineeId,
                changeDate: rh.changeDate,
                newHostel: rh.newHostel,
                newRoom: rh.newRoom,
                prevHostel: rh.prevHostel || '',
                prevRoom: rh.prevRoom || '',
              },
              update: { $set: sanitizeForSet(rh) },
              upsert: true,
            },
          }))
        );
      }

      if (db.dailySummary && typeof db.dailySummary === 'object') {
        const dsList = Array.isArray(db.dailySummary)
          ? db.dailySummary
          : Object.entries(db.dailySummary).map(([date, val]) => ({ date, ...val }));

        const validDs = dsList.filter((ds) => ds && ds.date);
        if (validDs.length > 0) {
          await DailySummary.bulkWrite(
            validDs.map((ds) => ({
              updateOne: {
                filter: { date: ds.date },
                update: { $set: sanitizeForSet(ds) },
                upsert: true,
              },
            }))
          );
        }
      }
    }

    if (isSuper && config && typeof config === 'object') {
      const mergedConfig = withDefaults(config);
      await Config.findOneAndUpdate(
        { key: 'main' },
        { $set: sanitizeForSet(mergedConfig) },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    if (isSuper && Array.isArray(roles) && roles.length > 0) {
      let roleList = [...roles];
      if (!roleList.some((r) => r.id === SUPER_ROLE)) {
        roleList = [DEFAULT_ROLES[0], ...roleList];
      }
      await Role.bulkWrite(
        roleList.filter((r) => r && r.id).map((r) => ({
          updateOne: {
            filter: { id: r.id },
            update: { $set: sanitizeForSet(r) },
            upsert: true,
          },
        }))
      );
    }

    await bumpRev();
    const updatedState = await buildStateForUser(req.user);
    return res.json(updatedState);
  } catch (err) {
    console.error('Error in PUT /api/state:', err?.message || err);
    const status = err.status || err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
    return res.status(status).json({
      error: err.message || 'Failed to save application state',
      code: err.code || (status === 400 ? 'VALIDATION_ERROR' : status === 409 ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR'),
    });
  }
});

export default router;
