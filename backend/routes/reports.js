import express from 'express';
import { auth, requireReports } from '../middleware/auth.js';
import { Hostel } from '../models/Hostel.js';
import { Trainee } from '../models/Trainee.js';
import { Attendance } from '../models/Attendance.js';
import { Leave } from '../models/Leave.js';
import { OutingVacate } from '../models/OutingVacate.js';
import { Resignation } from '../models/Resignation.js';
import { DailySummary } from '../models/DailySummary.js';
import { computeSummary, dayCounts, occupantsOf, addDays, fmtDate } from '../utils/summary.js';

const router = express.Router();

const REPORT_TITLES = {
  monthly: 'Monthly Trainee Summary',
  hostel: 'Hostel-wise Summary',
  occupancy: 'Room Occupancy',
  attendance: 'Attendance Summary',
  daily: 'Daily Attendance Summary',
  leave: 'Leave Summary',
  outing: 'Outing Summary',
  tempvacate: 'Temporary Vacate Summary',
  permvacate: 'Permanent Vacate Summary',
  resignation: 'Resignation Summary',
};

router.get('/reports', auth, requireReports, async (req, res) => {
  try {
    const {
      type = 'monthly',
      from = '',
      to = '',
      hostel = '',
      shift = '',
      employmentStatus = '',
      hostelStatus = '',
    } = req.query || {};

    const [hostels, allTrainees, attendance, leaves, outingVacate, resignations, dailySummaries] = await Promise.all([
      Hostel.find({}).lean(),
      Trainee.find({}).lean(),
      Attendance.find({}).lean(),
      Leave.find({}).lean(),
      OutingVacate.find({}).lean(),
      Resignation.find({}).lean(),
      DailySummary.find({}).lean(),
    ]);

    const dailySummaryMap = {};
    for (const ds of dailySummaries) {
      if (ds && ds.date) dailySummaryMap[ds.date] = ds;
    }

    const db = {
      hostels,
      trainees: allTrainees,
      attendance,
      leaves,
      outingVacate,
      resignations,
      dailySummary: dailySummaryMap,
    };

    // Filter trainees based on query parameters
    const trainees = allTrainees.filter((t) => {
      if (hostel && t.hostel !== hostel) return false;
      if (shift && t.defaultShift !== shift) return false;
      if (employmentStatus && t.employmentStatus !== employmentStatus) return false;
      if (hostelStatus && t.hostelStatus !== hostelStatus) return false;
      return true;
    });

    const ids = new Set(trainees.map((t) => t.traineeId));
    const nameOf = (id) => (allTrainees.find((t) => t.traineeId === id) || {}).name || '';

    let headers = [];
    let rows = [];

    if (type === 'hostel') {
      headers = ['Hostel', 'Total Trainees', 'Active', 'On Leave', 'Outing', 'Temp. Vacate', 'Perm. Vacate', 'Occupancy'];
      rows = db.hostels.map((h) => {
        const list = trainees.filter((t) => t.hostel === h.name);
        const cap = h.rooms.reduce((s, r) => s + (r.capacity || 0), 0);
        const occ = h.rooms.reduce((s, r) => s + occupantsOf(db, h.name, r.no).length, 0);
        const n = (st) => list.filter((t) => t.hostelStatus === st).length;
        return [
          h.name,
          list.length,
          n('ACTIVE'),
          n('ON LEAVE'),
          n('OUTING'),
          n('TEMPORARY VACATE'),
          n('PERMANENT VACATE'),
          `${occ}/${cap}`,
        ];
      });
    } else if (type === 'occupancy') {
      headers = ['Hostel', 'Room', 'Occupied', 'Capacity', 'Utilisation'];
      rows = [];
      db.hostels
        .filter((h) => !hostel || h.name === hostel)
        .forEach((h) =>
          h.rooms.forEach((r) => {
            const occ = occupantsOf(db, h.name, r.no).length;
            const util = r.capacity ? `${Math.round((occ / r.capacity) * 100)}%` : '0%';
            rows.push([h.name, r.no, occ, r.capacity, util]);
          })
        );
    } else if (type === 'attendance') {
      headers = ['Trainee ID', 'Name', 'A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING'];
      rows = trainees.map((t) => {
        const s = computeSummary(db, t.traineeId, from, to);
        return [t.traineeId, t.name, s.A, s.B, s.C, s.G, s.H12, s.WO, s.L, s.OUT];
      });
    } else if (type === 'daily') {
      headers = ['Date', 'A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING', 'Total'];
      rows = [];
      for (let d = from, n = 0; d <= to && n < 366; d = addDays(d, 1), n++) {
        const c = dayCounts(db, d);
        if (c.total) {
          rows.push([
            fmtDate(d),
            c.final.A,
            c.final.B,
            c.final.C,
            c.final.G,
            c.final['12HRS'],
            c.final.WO,
            c.final.L,
            c.final.OUTING,
            c.total,
          ]);
        }
      }
    } else if (type === 'leave') {
      headers = ['Trainee ID', 'Name', 'Type', 'From', 'To', 'Days', 'Status'];
      rows = db.leaves
        .filter((l) => ids.has(l.traineeId) && l.toDate >= from && l.fromDate <= to)
        .map((l) => [l.traineeId, nameOf(l.traineeId), l.leaveType, fmtDate(l.fromDate), fmtDate(l.toDate), l.days, l.status]);
    } else if (['outing', 'tempvacate', 'permvacate'].includes(type)) {
      const ty = { outing: 'OUTING', tempvacate: 'TEMPORARY VACATE', permvacate: 'PERMANENT VACATE' }[type];
      headers = ['Trainee ID', 'Name', 'From', 'Expected Return', 'Reason', 'Status'];
      rows = db.outingVacate
        .filter(
          (o) =>
            ids.has(o.traineeId) &&
            o.type === ty &&
            o.fromDate <= to &&
            (o.expectedReturn || (ty === 'PERMANENT VACATE' ? '9999-12-31' : o.fromDate)) >= from
        )
        .map((o) => [
          o.traineeId,
          nameOf(o.traineeId),
          fmtDate(o.fromDate),
          o.expectedReturn ? fmtDate(o.expectedReturn) : '—',
          o.reason,
          o.status,
        ]);
    } else if (type === 'resignation') {
      headers = ['Trainee ID', 'Name', 'Resignation Date', 'Last Working Date', 'Reason', 'Status'];
      rows = db.resignations
        .filter((r) => ids.has(r.traineeId) && r.resignationDate >= from && r.resignationDate <= to)
        .map((r) => [r.traineeId, nameOf(r.traineeId), fmtDate(r.resignationDate), fmtDate(r.lastWorkingDate), r.reason, r.status]);
    } else {
      // Monthly summary default
      headers = [
        'Trainee ID',
        'Name',
        'Hostel',
        'Room',
        'Working Days',
        'Week Off',
        'Leave',
        'Outing',
        'Temp. Vacate',
        'Perm. Vacate',
        'Living Days',
        'Vacated Days',
      ];
      rows = trainees.map((t) => {
        const s = computeSummary(db, t.traineeId, from, to);
        return [
          t.traineeId,
          t.name,
          t.hostel || '—',
          t.roomNo || '—',
          s.workingDays,
          s.WO,
          s.L,
          s.OUT,
          s.tempVacateDays,
          s.permVacateDays,
          s.livingDays,
          s.vacatedDays,
        ];
      });
    }

    const title = REPORT_TITLES[type] || 'Report Summary';

    return res.json({
      ok: true,
      type,
      title,
      headers,
      rows,
      count: rows.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
