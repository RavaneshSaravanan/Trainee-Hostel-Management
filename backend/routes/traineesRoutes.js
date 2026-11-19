import express from 'express';
import mongoose from 'mongoose';
import { Trainee } from '../models/Trainee.js';
import { Role } from '../models/Role.js';
import { Attendance } from '../models/Attendance.js';
import { Leave } from '../models/Leave.js';
import { OutingVacate } from '../models/OutingVacate.js';
import { Resignation } from '../models/Resignation.js';
import { Remark } from '../models/Remark.js';
import { RoomHistory } from '../models/RoomHistory.js';
import { ApprovalLog } from '../models/ApprovalLog.js';
import { EmailLog } from '../models/EmailLog.js';
import { auth } from '../middleware/auth.js';
import { bumpRev } from '../models/Meta.js';
import { SUPER_ROLE, DEFAULT_ROLES } from '../defaults.js';
import {
  isValidMobile,
  isValidEmail,
  isValidGuardianContact,
  isValidAadhaar,
  isValidDob,
} from '../utils/validators.js';
import {
  encryptAadhaar,
  maskAadhaar,
  hashAadhaar,
} from '../utils/encryption.js';
import { addThreeCalendarMonths } from '../utils/validity.js';

const router = express.Router();

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeTraineeOutput(t) {
  if (!t) return null;
  const doc = typeof t.toObject === 'function' ? t.toObject() : { ...t };
  delete doc.aadharEncrypted;
  delete doc.aadharHash;
  delete doc.passwordHash;
  // Always ensure masked Aadhaar is returned for display
  if (doc.aadharMasked) {
    doc.aadhar = doc.aadharMasked;
  } else if (doc.aadhar && !doc.aadhar.includes('X') && !doc.aadhar.includes('•')) {
    doc.aadhar = maskAadhaar(doc.aadhar);
  }
  return doc;
}

// Helper: check if a user role can edit trainees
async function canEditTrainees(user) {
  if (!user) return false;
  if (user.roleId === SUPER_ROLE) return true;
  if (user.roleId === 'warden') return true;

  try {
    let role = await Role.findOne({ id: user.roleId }).lean();
    if (!role) {
      role = DEFAULT_ROLES.find((r) => r.id === user.roleId);
    }
    return Boolean(role && Array.isArray(role.pages) && role.pages.includes('trainees'));
  } catch {
    return false;
  }
}

// ---------------- GET /api/trainees/:id ----------------
router.get('/trainees/:id', auth, async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    if (!cleanId) {
      return res.status(400).json({ error: 'Trainee ID is required.' });
    }

    const filter = mongoose.Types.ObjectId.isValid(cleanId)
      ? { $or: [{ _id: cleanId }, { traineeId: cleanId }, { qrId: cleanId }] }
      : { $or: [{ traineeId: cleanId }, { qrId: cleanId }, { hostelId: cleanId }] };

    const trainee = await Trainee.findOne(filter).lean();
    if (!trainee) {
      return res.status(404).json({ error: 'This trainee record could not be found.' });
    }

    return res.json({ ok: true, trainee: sanitizeTraineeOutput(trainee) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch trainee details.' });
  }
});

// ---------------- PUT /api/trainees/:id ----------------
router.put('/trainees/:id', auth, async (req, res) => {
  try {
    const cleanId = String(req.params.id || '').trim();
    if (!cleanId) {
      return res.status(400).json({ error: 'Trainee identifier is required.' });
    }

    // 1. Role permission check
    const allowed = await canEditTrainees(req.user);
    if (!allowed) {
      return res.status(403).json({ error: 'You do not have permission to update trainee profiles.' });
    }

    // 2. Find trainee record
    const filter = mongoose.Types.ObjectId.isValid(cleanId)
      ? { $or: [{ _id: cleanId }, { traineeId: cleanId }, { qrId: cleanId }] }
      : { $or: [{ traineeId: cleanId }, { qrId: cleanId }, { hostelId: cleanId }] };

    const trainee = await Trainee.findOne(filter);
    if (!trainee) {
      return res.status(404).json({ error: 'This trainee record could not be found.' });
    }

    // 3. Warden hostel-scoping check
    if (req.user.roleId === 'warden' && Array.isArray(req.user.assignedHostels) && req.user.assignedHostels.length > 0) {
      if (trainee.hostel && !req.user.assignedHostels.includes(trainee.hostel)) {
        return res.status(403).json({
          error: `You do not have permission to update trainees residing in hostel "${trainee.hostel}".`,
        });
      }
    }

    const errors = {};
    const body = req.body || {};

    // 4. Validate fields
    // Trainee ID (Optional, but must be unique if provided)
    let cleanTraineeId = undefined;
    if (body.traineeId !== undefined) {
      cleanTraineeId = String(body.traineeId || '').trim();
      if (cleanTraineeId) {
        const dupTraineeId = await Trainee.findOne({
          traineeId: { $regex: new RegExp(`^${escapeRegex(cleanTraineeId)}$`, 'i') },
          _id: { $ne: trainee._id },
        }).lean();
        if (dupTraineeId) {
          errors.traineeId = 'This Trainee ID is already assigned to another trainee.';
        }
      }
    }

    // Name
    if (body.name !== undefined) {
      const cleanName = String(body.name || '').trim();
      if (!cleanName || cleanName.length < 2) {
        errors.name = 'Trainee name is required (at least 2 characters).';
      }
    }

    // Mobile
    let cleanMobile = '';
    if (body.mobile !== undefined) {
      cleanMobile = String(body.mobile || '').replace(/\D/g, '');
      if (!cleanMobile) {
        errors.mobile = 'Mobile number is required.';
      } else if (!isValidMobile(cleanMobile)) {
        errors.mobile = 'Mobile number must contain exactly 10 digits and start with 6, 7, 8 or 9.';
      } else {
        const dupMobile = await Trainee.findOne({
          mobile: cleanMobile,
          _id: { $ne: trainee._id },
        }).lean();
        if (dupMobile) {
          errors.mobile = `Mobile number is already registered for ${dupMobile.name} (${dupMobile.traineeId || dupMobile.qrId}).`;
        }
      }
    }

    // Email
    let cleanEmail = '';
    if (body.email !== undefined) {
      cleanEmail = String(body.email || '').trim().toLowerCase();
      if (cleanEmail) {
        if (!isValidEmail(cleanEmail)) {
          errors.email = 'Invalid email address.';
        } else if (!cleanEmail.endsWith('@gmail.com')) {
          errors.email = 'Email address must be a valid @gmail.com address.';
        }
      }
    }

    // Date of Birth
    let cleanDob = '';
    if (body.dob !== undefined) {
      cleanDob = String(body.dob || '').trim().split('T')[0];
      if (cleanDob && !isValidDob(cleanDob)) {
        errors.dob = 'Date of Birth cannot be in the future.';
      }
    }

    // Joining Date
    let cleanJoiningDate = '';
    if (body.joiningDate !== undefined) {
      cleanJoiningDate = String(body.joiningDate || '').trim().split('T')[0];
      if (!cleanJoiningDate) {
        errors.joiningDate = 'Joining date is required.';
      } else if (isNaN(new Date(cleanJoiningDate).getTime())) {
        errors.joiningDate = 'Invalid joining date format.';
      }
    }

    // Guardian Contact
    let cleanGuardianContact = '';
    if (body.guardianContact !== undefined) {
      cleanGuardianContact = String(body.guardianContact || '').replace(/\D/g, '');
      if (cleanGuardianContact && !isValidGuardianContact(cleanGuardianContact)) {
        errors.guardianContact = 'Guardian Contact No. must contain exactly 10 digits.';
      }
    }

    // Aadhaar Number Handling
    const changeAadhaar = Boolean(body.changeAadhaar);
    let newAadhaarDigits = '';
    if (changeAadhaar) {
      const rawAadhaar = String(body.aadhar || '').replace(/\D/g, '');
      if (!rawAadhaar) {
        errors.aadhar = 'Please enter a 12-digit Aadhaar number, or cancel Aadhaar change.';
      } else if (rawAadhaar.length !== 12) {
        errors.aadhar = 'Aadhaar number must contain exactly 12 digits.';
      } else if (!isValidAadhaar(rawAadhaar, true)) {
        errors.aadhar = 'Please enter a valid 12-digit Aadhaar number with valid checksum.';
      } else {
        const aHash = hashAadhaar(rawAadhaar);
        const dupAadhaar = await Trainee.findOne({
          aadharHash: aHash,
          _id: { $ne: trainee._id },
        }).lean();
        if (dupAadhaar) {
          errors.aadhar = `Aadhaar number is already registered for ${dupAadhaar.name} (${dupAadhaar.traineeId || dupAadhaar.qrId}). Duplicate Aadhaar is not allowed.`;
        } else {
          newAadhaarDigits = rawAadhaar;
        }
      }
    }

    // Return validation errors if any
    if (Object.keys(errors).length > 0) {
      const firstMsg = Object.values(errors)[0] || 'Some fields contain invalid information.';
      return res.status(400).json({
        error: firstMsg,
        errors,
      });
    }

    // 5. Apply valid updates
    const updatedFieldsList = [];
    const oldTraineeId = trainee.traineeId || '';
    let traineeIdChanged = false;

    if (cleanTraineeId !== undefined && cleanTraineeId !== oldTraineeId) {
      trainee.traineeId = cleanTraineeId;
      updatedFieldsList.push('traineeId');
      traineeIdChanged = true;
    }

    if (body.name !== undefined) {
      trainee.name = String(body.name).trim();
      updatedFieldsList.push('name');
    }
    if (cleanMobile) {
      trainee.mobile = cleanMobile;
      updatedFieldsList.push('mobile');
    }
    if (body.email !== undefined) {
      trainee.email = cleanEmail;
      updatedFieldsList.push('email');
    }
    if (body.dob !== undefined) {
      trainee.dob = cleanDob;
      updatedFieldsList.push('dob');
    }
    if (body.gender !== undefined) {
      trainee.gender = String(body.gender).trim().toUpperCase();
      updatedFieldsList.push('gender');
    }
    if (body.qualification !== undefined) {
      trainee.qualification = String(body.qualification).trim();
      updatedFieldsList.push('qualification');
    }
    if (body.food !== undefined) {
      trainee.food = String(body.food).trim().toUpperCase();
      updatedFieldsList.push('food');
    }
    if (body.address1 !== undefined) {
      trainee.address1 = String(body.address1).trim();
      updatedFieldsList.push('address1');
    }
    if (body.state !== undefined) {
      trainee.state = String(body.state).trim();
      updatedFieldsList.push('state');
    }
    if (body.guardianName !== undefined) {
      trainee.guardianName = String(body.guardianName).trim();
      updatedFieldsList.push('guardianName');
    }
    if (body.guardianContact !== undefined) {
      trainee.guardianContact = cleanGuardianContact;
      updatedFieldsList.push('guardianContact');
    }
    if (body.employmentStatus !== undefined) {
      trainee.employmentStatus = String(body.employmentStatus).trim().toUpperCase();
      updatedFieldsList.push('employmentStatus');
    }
    if (body.remarks !== undefined) {
      trainee.remarks = String(body.remarks).trim();
      updatedFieldsList.push('remarks');
    }
    if (body.photo !== undefined && body.photo) {
      trainee.photo = String(body.photo);
      updatedFieldsList.push('photo');
    }
    if (body.custom !== undefined && typeof body.custom === 'object') {
      trainee.custom = { ...(trainee.custom || {}), ...body.custom };
      trainee.markModified('custom');
      updatedFieldsList.push('custom');
    }

    // Aadhaar update: ONLY if changeAadhaar is explicitly requested with verified 12 digits
    if (changeAadhaar && newAadhaarDigits) {
      const masked = maskAadhaar(newAadhaarDigits);
      trainee.aadharMasked = masked;
      trainee.aadhar = masked;
      trainee.aadharEncrypted = encryptAadhaar(newAadhaarDigits);
      trainee.aadharHash = hashAadhaar(newAadhaarDigits);
      updatedFieldsList.push('aadhar');
    }
    // If changeAadhaar is false, existing aadhar, aadharMasked, aadharEncrypted, aadharHash are preserved 100%!

    // Recalculate 3-month free stay if joining date changed
    if (cleanJoiningDate && cleanJoiningDate !== trainee.joiningDate) {
      trainee.joiningDate = cleanJoiningDate;
      trainee.freeStayExpiryDate = addThreeCalendarMonths(cleanJoiningDate);
      updatedFieldsList.push('joiningDate', 'freeStayExpiryDate');
    }

    // Evaluate missing fields resolution
    const requiredCheck = ['name', 'mobile', 'dob', 'gender', 'joiningDate', 'guardianName', 'guardianContact'];
    const stillMissing = requiredCheck.filter((f) => !trainee[f] || String(trainee[f]).trim() === '');
    trainee.missingFields = stillMissing;
    if (stillMissing.length === 0 && trainee.roomNo) {
      trainee.completionStatus = 'COMPLETE';
      if (trainee.hostelStatus === 'PENDING REVIEW') {
        trainee.hostelStatus = 'ACTIVE';
      }
    }

    // 6. Audit trail
    if (updatedFieldsList.length > 0) {
      trainee.auditHistory.push({
        action: 'PROFILE_UPDATE',
        updatedBy: req.user.username || req.user.id,
        updatedByName: req.user.name,
        updatedFields: updatedFieldsList,
        timestamp: new Date(),
        notes: `Profile updated by ${req.user.name} (${req.user.roleId})`,
      });
    }

    await trainee.save();

    // Cascade update related records across modules if traineeId was modified
    if (traineeIdChanged) {
      try {
        const filterWithQr = oldTraineeId
          ? { $or: [{ traineeId: oldTraineeId }, { qrId: trainee.qrId }] }
          : { qrId: trainee.qrId };

        await Promise.all([
          Attendance.updateMany(filterWithQr, { $set: { traineeId: cleanTraineeId } }),
          Leave.updateMany(filterWithQr, { $set: { traineeId: cleanTraineeId } }),
          OutingVacate.updateMany(filterWithQr, { $set: { traineeId: cleanTraineeId } }),
          ...(oldTraineeId
            ? [
                Resignation.updateMany({ traineeId: oldTraineeId }, { $set: { traineeId: cleanTraineeId } }),
                Remark.updateMany({ traineeId: oldTraineeId }, { $set: { traineeId: cleanTraineeId } }),
                RoomHistory.updateMany({ traineeId: oldTraineeId }, { $set: { traineeId: cleanTraineeId } }),
                ApprovalLog.updateMany({ traineeId: oldTraineeId }, { $set: { traineeId: cleanTraineeId } }),
                EmailLog.updateMany({ traineeId: oldTraineeId }, { $set: { traineeId: cleanTraineeId } }),
              ]
            : []),
        ]);
      } catch (cascadeErr) {
        console.error('[PUT /api/trainees/:id] Cascade update error:', cascadeErr);
      }
    }

    await bumpRev();

    return res.json({
      ok: true,
      message: 'Trainee profile updated successfully.',
      trainee: sanitizeTraineeOutput(trainee),
    });
  } catch (err) {
    console.error('[PUT /api/trainees/:id Error]:', err);
    if (err.name === 'ValidationError') {
      const errs = {};
      for (const k of Object.keys(err.errors || {})) {
        errs[k] = err.errors[k].message;
      }
      return res.status(400).json({
        error: 'Validation failed. Please check the entered fields.',
        errors: errs,
      });
    }
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      if (field === 'traineeId') {
        return res.status(409).json({
          error: 'This Trainee ID is already assigned to another trainee.',
          errors: { traineeId: 'This Trainee ID is already assigned to another trainee.' },
        });
      }
      return res.status(409).json({
        error: `A trainee with this ${field} already exists in the system.`,
        errors: { [field]: `Duplicate ${field} value.` },
      });
    }
    return res.status(500).json({ error: err.message || 'Server error saving trainee profile.' });
  }
});

export default router;
