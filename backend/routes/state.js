import express from 'express';
import { auth } from '../middleware/auth.js';
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

// GET /api/rev
router.get('/rev', async (req, res) => {
  try {
    const rev = await getRev();
    return res.json({ rev });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

// PUT /api/state (auth)
router.put('/state', auth, async (req, res) => {
  try {
    const { db, config, roles } = req.body || {};
    const isSuper = req.user.roleId === SUPER_ROLE;

    if (db && typeof db === 'object') {
      if (Array.isArray(db.hostels) && db.hostels.length > 0) {
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
          db.trainees.filter((t) => t && t.traineeId).map((t) => ({
            updateOne: {
              filter: { traineeId: t.traineeId },
              update: { $set: sanitizeForSet(t) },
              upsert: true,
            },
          }))
        );
      }

      if (Array.isArray(db.attendance) && db.attendance.length > 0) {
        await Attendance.bulkWrite(
          db.attendance.filter((a) => a && a.traineeId && a.date).map((a) => ({
            updateOne: {
              filter: { traineeId: a.traineeId, date: a.date },
              update: { $set: sanitizeForSet(a) },
              upsert: true,
            },
          }))
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
    return res.status(500).json({ error: err.message });
  }
});

export default router;
