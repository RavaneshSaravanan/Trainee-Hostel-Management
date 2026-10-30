import express from 'express';
import { auth } from '../middleware/auth.js';
import { Trainee } from '../models/Trainee.js';
import { Hostel } from '../models/Hostel.js';
import { bumpRev } from '../models/Meta.js';
import { computeValidity, todayStr } from '../utils/validity.js';

const router = express.Router();

// ---------------- 1. Validity Report with Aggregations & Filters ----------------
router.get('/validity/report', auth, async (req, res) => {
  try {
    const {
      status = '',
      hostel = '',
      q = '',
      fromJoining = '',
      toJoining = '',
    } = req.query || {};

    const today = todayStr();

    // Query active / residing trainees
    const query = {
      hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
    };

    if (hostel) query.hostel = hostel;
    if (fromJoining || toJoining) {
      query.joiningDate = {};
      if (fromJoining) query.joiningDate.$gte = fromJoining;
      if (toJoining) query.joiningDate.$lte = toJoining;
    }

    const trainees = await Trainee.find(query).sort({ joiningDate: 1 }).lean();

    // Compute dynamic validity for each trainee
    let processed = trainees.map((t) => {
      const val = computeValidity(t.joiningDate, t.paymentStatus, today);
      return {
        _id: t._id,
        traineeId: t.traineeId,
        hostelId: t.hostelId,
        name: t.name,
        photo: t.photo || '',
        mobile: t.mobile || '—',
        email: t.email || '—',
        hostel: t.hostel || '—',
        roomNo: t.roomNo || '—',
        joiningDate: t.joiningDate || '—',
        freeStayExpiryDate: val.expiryDate || '—',
        daysRemaining: val.daysRemaining,
        validityStatus: val.status, // 'FREE' | 'EXPIRING_SOON' | 'EXPIRED_DUE' | 'PAID'
        paymentStatus: t.paymentStatus || 'FREE',
        paymentHistory: t.paymentHistory || [],
      };
    });

    // Apply text search
    if (q) {
      const lcq = q.toLowerCase().trim();
      processed = processed.filter(
        (t) =>
          t.traineeId.toLowerCase().includes(lcq) ||
          t.name.toLowerCase().includes(lcq) ||
          t.roomNo.toLowerCase().includes(lcq) ||
          t.hostel.toLowerCase().includes(lcq)
      );
    }

    // Apply status filter
    if (status) {
      processed = processed.filter((t) => t.validityStatus === status);
    }

    // KPI Counters
    const kpis = {
      totalResiding: trainees.length,
      freeStay: 0,
      expiringSoon: 0,
      expiredDue: 0,
      paid: 0,
    };

    for (const t of trainees) {
      const val = computeValidity(t.joiningDate, t.paymentStatus, today);
      if (val.status === 'PAID') kpis.paid++;
      else if (val.status === 'EXPIRED_DUE') kpis.expiredDue++;
      else if (val.status === 'EXPIRING_SOON') kpis.expiringSoon++;
      else kpis.freeStay++;
    }

    const hostels = await Hostel.find({}, 'name').lean();

    return res.json({
      today,
      kpis,
      summary: kpis,
      trainees: processed,
      hostels: hostels.map((h) => h.name),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 2. Record Payment for Trainee Free-Stay Expiry ----------------
router.post('/validity/payment', auth, async (req, res) => {
  try {
    const {
      traineeId = '',
      amount = 0,
      paymentDate = todayStr(),
      receiptNo = '',
      notes = '',
      remarks = '',
    } = req.body || {};

    const cleanId = String(traineeId).trim().toUpperCase();
    if (!cleanId) {
      return res.status(400).json({ error: 'Trainee ID is required.' });
    }

    const trainee = await Trainee.findOne({ traineeId: cleanId });
    if (!trainee) {
      return res.status(404).json({ error: 'Trainee not found.' });
    }

    const paymentRecord = {
      paymentDate: paymentDate || todayStr(),
      amount: Number(amount) || 0,
      receiptNo: String(receiptNo).trim() || `RCP-${Date.now().toString().slice(-6)}`,
      notes: String(notes || remarks).trim(),
      recordedBy: req.user ? `${req.user.name} (${req.user.roleId})` : 'System',
      recordedAt: new Date(),
    };

    trainee.paymentStatus = 'PAID';
    trainee.paymentHistory.push(paymentRecord);
    await trainee.save();

    await bumpRev();

    return res.json({
      ok: true,
      message: `Payment of ₹${paymentRecord.amount} recorded successfully for ${trainee.name}. Status updated to PAID.`,
      traineeId: cleanId,
      paymentRecord,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
