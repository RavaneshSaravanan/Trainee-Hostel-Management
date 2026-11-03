import express from 'express';
import { auth, requireSuper } from '../middleware/auth.js';
import { Config } from '../models/Config.js';
import { User } from '../models/User.js';
import { Trainee } from '../models/Trainee.js';
import { ApprovalLog } from '../models/ApprovalLog.js';
import { EmailLog } from '../models/EmailLog.js';
import { bumpRev } from '../models/Meta.js';
import {
  allocateTraineeToRoom,
  getRoomOccupancy,
  getAllRoomsOccupancy,
  validateCapacityReduction,
} from '../services/roomService.js';
import {
  sendDecisionNotificationEmail,
  sendTraineeIdCardEmail,
  sendTraineeWelcomeEmail,
  sendEmail,
  getAppUrl,
  replaceDynamicPlaceholders,
} from '../services/emailService.js';
import { computeValidity } from '../utils/validity.js';
import { migrateExistingPhotosToDrive } from '../services/googleDriveService.js';
import {
  DEFAULT_ORG_BRANDING,
  DEFAULT_IDCARD_TEMPLATE,
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_EMAIL_RECIPIENTS,
} from '../defaults.js';

const router = express.Router();

// Helper to check if a user is an authorized approver or Super Admin
async function isAuthorizedApprover(userId) {
  const user = await User.findOne({ id: userId });
  if (!user || !user.active) return false;
  if (user.roleId === 'superadmin') return true;

  const cfg = await Config.findOne({ key: 'main' }).lean();
  const approvers = cfg?.approvalConfig?.approvers || [];
  return approvers.some((a) => a.userId === userId);
}

// ---------------- 1. Get Approval Configuration (Super Admin & Warden read-only) ----------------
router.get('/approval/config', auth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    const approvalConfig = cfg?.approvalConfig || {
      approvers: [],
      policy: 'ANY_ONE',
    };
    return res.json({ approvalConfig, isSuper: req.user.roleId === 'superadmin' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 2. Save Approval Configuration (Strictly Super Admin Only) ----------------
router.post('/approval/config', auth, requireSuper, async (req, res) => {
  try {
    const { approverIds = [], policy = 'ANY_ONE' } = req.body || {};

    if (!Array.isArray(approverIds)) {
      return res.status(400).json({ error: 'Approvers must be provided as a list.' });
    }

    // Must be exactly 2 or 3 approvers
    if (approverIds.length < 2 || approverIds.length > 3) {
      return res.status(400).json({
        error: 'Exactly 2 or 3 eligible approver members must be authorized.',
      });
    }

    // Prevent duplicates
    const uniqueIds = Array.from(new Set(approverIds));
    if (uniqueIds.length !== approverIds.length) {
      return res.status(400).json({ error: 'Duplicate approvers are not allowed.' });
    }

    // Validate active eligible users
    const validUsers = await User.find({
      id: { $in: uniqueIds },
      active: true,
    }).lean();

    if (validUsers.length !== approverIds.length) {
      return res.status(400).json({
        error: 'One or more selected users are invalid, inactive, or not found.',
      });
    }

    const approvers = validUsers.map((u) => ({
      userId: u.id,
      name: u.name,
      username: u.username,
      email: u.email || '',
      roleId: u.roleId,
    }));

    const approvalConfig = {
      approvers,
      policy: ['ANY_ONE', 'MAJORITY', 'ALL'].includes(policy) ? policy : 'ANY_ONE',
      configuredAt: new Date(),
      configuredBy: `${req.user.name} (${req.user.username})`,
    };

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { approvalConfig } },
      { upsert: true }
    );

    await ApprovalLog.create({
      traineeId: 'SYSTEM',
      action: 'CONFIG_UPDATED',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.roleId,
      metadata: { approversCount: approvers.length, policy },
    });

    await bumpRev();
    return res.json({ ok: true, approvalConfig });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 3. Get Trainees Pending Approval (Authorized Approvers) ----------------
router.get('/approval/pending', auth, async (req, res) => {
  try {
    const authorized = await isAuthorizedApprover(req.user.id);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied: You are not an authorized approval authority.' });
    }

    const pending = await Trainee.find({
      $or: [
        { approvalStatus: 'PENDING_APPROVAL' },
        { hostelStatus: 'PENDING REVIEW' },
        { hostelStatus: 'PENDING APPROVAL' },
      ],
    }).sort({ createdAt: -1 }).lean();

    return res.json({ pending });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 4. Review Trainee Details by ID (Authorized Approvers) ----------------
router.get('/approval/review/:traineeId', auth, async (req, res) => {
  try {
    const authorized = await isAuthorizedApprover(req.user.id);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to review trainees.' });
    }

    const traineeId = String(req.params.traineeId || '').trim().toUpperCase();
    const trainee = await Trainee.findOne({ traineeId }).lean();
    if (!trainee) {
      return res.status(404).json({ error: 'Trainee not found.' });
    }

    const logs = await ApprovalLog.find({ traineeId }).sort({ createdAt: -1 }).lean();
    const cfg = await Config.findOne({ key: 'main' }).lean();

    return res.json({
      trainee,
      auditTrail: logs,
      approvalPolicy: cfg?.approvalConfig?.policy || 'ANY_ONE',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 5. Execute Approval or Rejection Decision ----------------
router.post('/approval/decision', auth, async (req, res) => {
  try {
    const authorized = await isAuthorizedApprover(req.user.id);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied: You are not authorized to approve or reject trainees.' });
    }

    const { traineeId = '', decision = '', rejectionReason = '' } = req.body || {};
    const cleanId = String(traineeId).trim().toUpperCase();
    const normDecision = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : String(decision).toUpperCase();

    if (!['APPROVED', 'REJECTED'].includes(normDecision)) {
      return res.status(400).json({ error: 'Decision must be either APPROVED or REJECTED.' });
    }

    if (normDecision === 'REJECTED' && !String(rejectionReason).trim()) {
      return res.status(400).json({ error: 'A specific rejection reason is mandatory when rejecting a trainee.' });
    }

    const trainee = await Trainee.findOne({ traineeId: cleanId });
    if (!trainee) {
      return res.status(404).json({ error: 'Trainee not found.' });
    }

    if (trainee.approvalStatus === 'APPROVED' && trainee.hostelStatus === 'ACTIVE') {
      return res.status(400).json({ error: 'Trainee is already approved and active.' });
    }

    const cfg = await Config.findOne({ key: 'main' }).lean();
    const policy = cfg?.approvalConfig?.policy || 'ANY_ONE';
    const totalApprovers = cfg?.approvalConfig?.approvers?.length || 2;

    // Check if this approver already voted
    const priorVote = (trainee.approvals || []).find((a) => a.approverId === req.user.id);
    if (priorVote) {
      return res.status(409).json({
        error: `You have already submitted a ${priorVote.decision} decision for this trainee.`,
      });
    }

    // Append approver vote
    const newApproval = {
      approverId: req.user.id,
      approverName: req.user.name,
      decision: normDecision,
      rejectionReason: String(rejectionReason).trim(),
      timestamp: new Date(),
    };

    trainee.approvals.push(newApproval);

    // Apply Approval Policy to determine final resolution
    let finalStatus = trainee.approvalStatus;

    if (normDecision === 'REJECTED') {
      // Rejection immediately marks rejected or overrides
      finalStatus = 'REJECTED';
      trainee.approvalStatus = 'REJECTED';
      trainee.hostelStatus = 'REJECTED';
      trainee.rejectionReason = String(rejectionReason).trim();
      trainee.qrStatus = 'INACTIVE';
    } else {
      // APPROVED vote
      const approvedCount = trainee.approvals.filter((a) => a.decision === 'APPROVED').length;

      let satisfied = false;
      if (policy === 'ANY_ONE') {
        satisfied = approvedCount >= 1;
      } else if (policy === 'MAJORITY') {
        const threshold = Math.ceil(totalApprovers / 2);
        satisfied = approvedCount >= threshold;
      } else if (policy === 'ALL') {
        satisfied = approvedCount >= totalApprovers;
      }

      if (satisfied) {
        finalStatus = 'APPROVED';
        trainee.approvalStatus = 'APPROVED';
        // When approved, status moves to PENDING_ALLOCATION or APPROVED so room allocation can occur
        trainee.hostelStatus = 'APPROVED';
        trainee.approvedBy = req.user.name;

        // Automatically calculate Free-Stay Validity (3 calendar months from joining date)
        if (trainee.joiningDate) {
          const val = computeValidity(trainee.joiningDate, trainee.paymentStatus || 'FREE');
          trainee.freeStayExpiryDate = val.expiryDate;
          trainee.paymentStatus = val.status;
        }

        if (req.body?.hostel && req.body?.roomNo) {
          const allocRes = await allocateTraineeToRoom({
            traineeId: cleanId,
            hostelNameOrId: req.body.hostel,
            roomNo: req.body.roomNo,
            actorName: req.user.name,
          });
          trainee.hostel = allocRes.trainee.hostel;
          trainee.hostelId = allocRes.trainee.hostelId;
          trainee.roomNo = allocRes.trainee.roomNo;
          trainee.hostelStatus = allocRes.trainee.hostelStatus;
          trainee.qrStatus = allocRes.trainee.qrStatus;
          if (allocRes.emailResult) emailResult = allocRes.emailResult;
          if (allocRes.idCardResult) idCardResult = allocRes.idCardResult;
        }
      }
    }

    await trainee.save();

    // Record in Audit Trail
    await ApprovalLog.create({
      traineeId: cleanId,
      action: normDecision,
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.roleId,
      rejectionReason: String(rejectionReason).trim(),
      metadata: { finalStatus, policy, totalApprovals: trainee.approvals.length },
    });

    // Send email notification to trainee if email provided and a definitive decision is recorded in MongoDB
    let emailResult = null;
    if (['APPROVED', 'REJECTED'].includes(finalStatus) && trainee.email) {
      try {
        emailResult = await sendDecisionNotificationEmail({
          trainee,
          decision: finalStatus,
          rejectionReason: String(rejectionReason).trim(),
          actorName: req.user.name,
        });
        trainee.approvalEmailSent = emailResult?.ok === true;
        trainee.approvalEmailSentAt = emailResult?.ok ? new Date() : undefined;
        trainee.approvalEmailError = emailResult?.ok ? '' : (emailResult?.error || 'Email dispatch failed');
      } catch (err) {
        console.error('[Decision Notification Error]', err.message);
        trainee.approvalEmailSent = false;
        trainee.approvalEmailError = err.message;
        emailResult = { ok: false, error: err.message };
      }
      await trainee.save();
    }

    // Deliver official ID card via email once trainee is approved and has allocated room
    let idCardResult = null;
    const hasRoomAllocated = !!((trainee.hostel || trainee.hostelId) && (trainee.roomNo || trainee.room));
    if (finalStatus === 'APPROVED' && trainee.email && hasRoomAllocated) {
      try {
        idCardResult = await sendTraineeIdCardEmail({ trainee, force: true, isUpdated: true });
      } catch (err) {
        console.warn('[ID Card Email Error]', err.message);
        idCardResult = { ok: false, error: err.message };
      }
    }

    await bumpRev();

    return res.json({
      ok: true,
      message: `Trainee ${cleanId} marked ${decision}${finalStatus === 'APPROVED' ? ' (Approved and ready for room allocation)' : ''}.`,
      trainee,
      emailResult,
      idCardResult,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 5. Migrate Existing Photographs to Google Drive (Super Admin Only) ----------------
router.post('/approval/migrate-photos', auth, requireSuper, async (req, res) => {
  try {
    const result = await migrateExistingPhotosToDrive(Trainee);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 6. Organization Branding Endpoints (Super Admin) ----------------
router.get('/admin/branding', auth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    return res.json({ orgBranding: { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/branding', auth, requireSuper, async (req, res) => {
  try {
    const { orgName, logo, tagline, address } = req.body || {};
    const orgBranding = {
      orgName: orgName !== undefined ? String(orgName).trim() : 'APOLLO TYRES LTD',
      logo: logo !== undefined ? String(logo) : '',
      tagline: tagline !== undefined ? String(tagline).trim() : 'Hostel Administration & Trainee Operations',
      address: address !== undefined ? String(address).trim() : '',
    };
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { orgBranding } },
      { upsert: true }
    );
    await bumpRev();
    return res.json({ ok: true, orgBranding });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 7. ID Card Template Endpoints (Super Admin) ----------------
router.get('/admin/id-card-template', auth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    return res.json({ idCardTemplate: { ...DEFAULT_IDCARD_TEMPLATE, ...(cfg?.idCardTemplate || {}) } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/id-card-template', auth, requireSuper, async (req, res) => {
  try {
    const template = { ...DEFAULT_IDCARD_TEMPLATE, ...(req.body || {}) };
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { idCardTemplate: template } },
      { upsert: true }
    );
    await bumpRev();
    return res.json({ ok: true, idCardTemplate: template });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 8. Approval Email Template Endpoints (Super Admin) ----------------
router.get('/admin/email-template', auth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    return res.json({ emailTemplate: { ...DEFAULT_EMAIL_TEMPLATE, ...(cfg?.emailTemplate || {}) } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/email-template', auth, requireSuper, async (req, res) => {
  try {
    const template = { ...DEFAULT_EMAIL_TEMPLATE, ...(req.body || {}) };
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { emailTemplate: template } },
      { upsert: true }
    );
    await bumpRev();
    return res.json({ ok: true, emailTemplate: template });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/email-template/test', auth, requireSuper, async (req, res) => {
  try {
    const { to, template } = req.body || {};
    const recipient = String(to || req.user.email || '').trim();
    if (!recipient) {
      return res.status(400).json({ error: 'Please provide a recipient email address for testing.' });
    }

    const cfg = await Config.findOne({ key: 'main' }).lean();
    const tpl = { ...DEFAULT_EMAIL_TEMPLATE, ...(template || cfg?.emailTemplate || {}) };
    const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };

    const orgName = branding.orgName || 'APOLLO TYRES LTD';
    const orgLogo = branding.logo || '';
    const sampleTraineeName = 'John Doe';
    const sampleTraineeId = 'TR-TEST-001';
    const sampleJoiningDate = new Date().toISOString().slice(0, 10);
    const sampleDept = 'Trainee Operations';
    const sampleLink = `${getAppUrl()}/#/review/TR-TEST-001`;

    const replaceTokens = (str = '') =>
      String(str)
        .replace(/\{\{traineeName\}\}/g, sampleTraineeName)
        .replace(/\{\{traineeId\}\}/g, sampleTraineeId)
        .replace(/\{\{joiningDate\}\}/g, sampleJoiningDate)
        .replace(/\{\{department\}\}/g, sampleDept)
        .replace(/\{\{approvalLink\}\}/g, sampleLink)
        .replace(/\{\{organizationName\}\}/g, orgName)
        .replace(/\{\{organizationLogo\}\}/g, orgLogo)
        .replace(/\{\{approverName\}\}/g, req.user.name || 'Approver');

    const subject = `[TEST] ${replaceTokens(tpl.subject)}`;
    const heading = replaceTokens(tpl.heading);
    const subheading = replaceTokens(tpl.subheading);
    const bodyText = replaceTokens(tpl.bodyText);
    const footerText = replaceTokens(tpl.footerText);
    const headerBg = tpl.headerBg || '#2E1065';
    const accentColor = tpl.accentColor || '#7C3AED';
    const fontFamily = tpl.fontFamily || 'Arial, sans-serif';

    const text = `
[TEST PREVIEW]
Dear ${req.user.name || 'Approver'},

${bodyText}

Trainee Details:
- Name: ${sampleTraineeName}
- Trainee ID: ${sampleTraineeId}
- Department: ${sampleDept}
- Joining Date: ${sampleJoiningDate}
- Organization: ${orgName}

Link: ${sampleLink}

${footerText}
`;

    const html = `
<div style="font-family: ${fontFamily}; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
  <div style="background: #eab308; color: #000; padding: 6px 12px; font-size: 11px; font-weight: bold; border-radius: 4px; text-align: center; margin-bottom: 12px;">
    DEMO TEST PREVIEW EMAIL · SENT FROM ADMIN CONSOLE
  </div>
  <div style="background: ${headerBg}; color: #ffffff; padding: 18px 22px; border-radius: 8px 8px 0 0; margin: 0 -24px 20px -24px; display: flex; align-items: center; justify-content: space-between;">
    <div>
      <h2 style="margin: 0; font-size: 20px; color: #ffffff;">${heading}</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #ddd6fe;">${subheading}</p>
    </div>
    ${orgLogo ? `<img src="${orgLogo}" alt="${orgName}" style="max-height: 42px; max-width: 130px; object-fit: contain; margin-left: 12px;" />` : ''}
  </div>

  <p style="font-size: 15px; color: #1e293b;">Dear <strong>${req.user.name || 'Approver'}</strong>,</p>
  <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-line; margin: 12px 0;">${bodyText}</div>
  
  <div style="background: #f8fafc; border-left: 4px solid ${accentColor}; padding: 14px 18px; margin: 18px 0; border-radius: 6px;">
    <p style="margin: 4px 0;"><strong>Full Name:</strong> ${sampleTraineeName}</p>
    <p style="margin: 4px 0;"><strong>Trainee ID:</strong> <span style="font-family: monospace; font-weight: bold; color: ${accentColor};">${sampleTraineeId}</span></p>
    <p style="margin: 4px 0;"><strong>Department:</strong> ${sampleDept}</p>
    <p style="margin: 4px 0;"><strong>Joining Date:</strong> ${sampleJoiningDate}</p>
  </div>

  <div style="margin: 28px 0; text-align: center;">
    <a href="${sampleLink}" style="background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">
      Open Trainee Review & Decisions →
    </a>
  </div>

  <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 24px;">
    ${footerText}
  </p>
</div>
`;

    const dispatch = await sendEmail({
      to: recipient,
      subject,
      text,
      html,
      type: 'EMAIL_TEMPLATE_TEST',
      metadata: { tester: req.user.username },
    });

    return res.json({ ok: true, recipient, dispatch });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 9. Trainee Permanent Deletion (Strictly Super Admin Only) ----------------
router.delete('/trainees/:traineeId', auth, requireSuper, async (req, res) => {
  try {
    const rawId = req.params.traineeId || '';
    const traineeId = String(rawId).trim().toUpperCase();

    const trainee = await Trainee.findOne({ traineeId });
    if (!trainee) {
      return res.status(404).json({ error: `Trainee with ID "${traineeId}" not found.` });
    }

    const { hostel, roomNo, name } = trainee;

    // Permanently remove trainee document from MongoDB
    await Trainee.deleteOne({ traineeId });

    // Record audit trail in ApprovalLog
    await ApprovalLog.create({
      traineeId,
      action: 'DELETED',
      actorId: req.user.id,
      actorName: req.user.name,
      actorRole: req.user.roleId,
      metadata: {
        note: `Trainee ${name} (${traineeId}) permanently deleted by Super Admin. Freed bed in Hostel: ${hostel || 'None'}, Room: ${roomNo || 'None'}.`,
        freedHostel: hostel || '',
        freedRoom: roomNo || '',
      },
    });

    await bumpRev();

    return res.json({
      ok: true,
      message: `Trainee ${name} (${traineeId}) deleted permanently. Room allocation freed.`,
      traineeId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 10. Manual / Retry ID Card Email Delivery ----------------
async function handleIdCardEmailDelivery(req, res) {
  try {
    const rawId = req.params.traineeId || '';
    const cleanId = String(rawId).trim().toUpperCase();

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }],
    });

    if (!trainee) {
      return res.status(404).json({ error: `Trainee "${cleanId}" not found.` });
    }

    // Persist latest hostel and roomNo if passed from frontend
    if (req.body?.hostel && String(req.body.hostel).trim()) {
      trainee.hostel = String(req.body.hostel).trim();
    }
    if (req.body?.roomNo && String(req.body.roomNo).trim()) {
      trainee.roomNo = String(req.body.roomNo).trim();
    }
    if (req.body?.hostel || req.body?.roomNo) {
      await trainee.save();
    }

    const result = await sendTraineeIdCardEmail({ trainee, force: true, isUpdated: true });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
router.post('/trainees/:traineeId/send-id-card', auth, handleIdCardEmailDelivery);
router.post('/trainees/:traineeId/email-id-card', auth, handleIdCardEmailDelivery);

// ---------------- 10b. Manual / Retry Approval / Rejection Decision Email ----------------
router.post('/trainees/:traineeId/send-approval-email', auth, async (req, res) => {
  try {
    const rawId = req.params.traineeId || '';
    const cleanId = String(rawId).trim().toUpperCase();

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }],
    });

    if (!trainee) {
      return res.status(404).json({ error: `Trainee "${cleanId}" not found.` });
    }

    if (!['APPROVED', 'REJECTED'].includes(trainee.approvalStatus)) {
      return res.status(400).json({ error: 'Trainee has not been approved or rejected yet.' });
    }

    if (!trainee.email) {
      return res.status(400).json({ error: 'Trainee does not have an email address configured.' });
    }

    const emailResult = await sendDecisionNotificationEmail({
      trainee,
      decision: trainee.approvalStatus,
      rejectionReason: trainee.rejectionReason || '',
      actorName: req.user ? (req.user.name || req.user.username) : 'Super Admin',
    });

    trainee.approvalEmailSent = emailResult?.ok === true;
    if (emailResult?.ok) {
      trainee.approvalEmailSentAt = new Date();
      trainee.approvalEmailError = '';
    } else {
      trainee.approvalEmailError = emailResult?.error || 'Email dispatch failed';
    }
    await trainee.save();
    await bumpRev();

    return res.json({
      ok: emailResult?.ok !== false,
      message: emailResult?.ok ? 'Decision notification email dispatched successfully.' : `Email dispatch: ${emailResult?.error || 'Failed'}`,
      emailResult,
      trainee,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 11. Manual / Retry Welcome Email Delivery ----------------
router.post('/trainees/:traineeId/send-welcome-email', auth, async (req, res) => {
  try {
    const rawId = req.params.traineeId || '';
    const cleanId = String(rawId).trim().toUpperCase();

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }],
    });

    if (!trainee) {
      return res.status(404).json({ error: `Trainee "${cleanId}" not found.` });
    }

    const result = await sendTraineeWelcomeEmail({
      trainee,
      force: true,
      triggeredBy: req.user ? `Super Admin Retry (${req.user.name || req.user.username})` : 'Super Admin Retry',
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 12. Allocate Room & Trigger Welcome Email ----------------
async function handleRoomAllocation(req, res) {
  try {
    const rawId = req.params.traineeId || req.body.traineeId || '';
    const cleanId = String(rawId).trim().toUpperCase();
    const { hostel = '', roomNo = '' } = req.body || {};

    const allocResult = await allocateTraineeToRoom({
      traineeId: cleanId,
      hostelNameOrId: hostel,
      roomNo,
      actorName: req.user ? req.user.name : 'System',
    });

    return res.json(allocResult);
  } catch (err) {
    console.error('Error in PUT room capacity:', err?.message || err);
    const status = err.status || err.statusCode || (err.name === 'ValidationError' ? 400 : 500);
    return res.status(status).json({
      error: err.message,
      code: err.code || (status === 400 ? 'VALIDATION_ERROR' : status === 409 ? 'CONFLICT' : 'INTERNAL_SERVER_ERROR'),
    });
  }
}
router.post('/trainees/:traineeId/allocate-room', auth, handleRoomAllocation);
router.post('/approval/allocate-room', auth, handleRoomAllocation);

// ---------------- 12b. Dynamic Room Occupancy Dashboard Endpoint ----------------
router.get('/hostels/occupancy', auth, async (req, res) => {
  try {
    const { hostel, room, status } = req.query || {};
    const occupancyData = await getAllRoomsOccupancy({ hostel, room, status });
    return res.json({ ok: true, rooms: occupancyData });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 12c. Super Admin Room Capacity Configuration ----------------
router.put('/hostels/:hostelId/rooms/:roomNo/capacity', auth, requireSuper, async (req, res) => {
  try {
    const { hostelId = '', roomNo = '' } = req.params;
    const { capacity } = req.body || {};
    const cap = Number(capacity);

    if (isNaN(cap) || cap < 1 || !Number.isInteger(cap)) {
      return res.status(400).json({ error: 'Room capacity must be a positive integer of at least 1.', code: 'INVALID_CAPACITY' });
    }

    // Validate capacity reduction below occupancy
    if (typeof validateCapacityReduction === 'function') {
      await validateCapacityReduction(hostelId, roomNo, cap);
    }

    const { Hostel } = await import('../models/Hostel.js');
    const hostel = await Hostel.findOne({
      $or: [{ id: String(hostelId).trim() }, { name: String(hostelId).trim() }],
    });

    if (!hostel) {
      return res.status(404).json({ error: `Hostel "${hostelId}" not found.` });
    }

    const roomObj = (hostel.rooms || []).find((r) => String(r.no).trim() === String(roomNo).trim());
    if (!roomObj) {
      return res.status(404).json({ error: `Room "${roomNo}" not found in hostel "${hostel.name}".` });
    }

    roomObj.capacity = cap;
    await hostel.save();
    await bumpRev();

    return res.json({
      ok: true,
      message: `Room ${roomNo} capacity updated to ${cap}.`,
      hostelId: hostel.id,
      roomNo,
      capacity: cap,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// ---------------- 13. Email Recipient Management (Super Admin Only) ----------------
router.get('/admin/email-recipients', auth, requireSuper, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    const recipients = cfg?.emailRecipients || [];
    return res.json({ recipients });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/email-recipients', auth, requireSuper, async (req, res) => {
  try {
    const { name = '', email = '', type = 'CC', emailTypes = [], enabled = true, description = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const cleanType = ['TO', 'CC', 'BCC'].includes(String(type).toUpperCase()) ? String(type).toUpperCase() : 'CC';
    const id = `REC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newRecipient = {
      id,
      name: String(name).trim(),
      email: cleanEmail,
      type: cleanType,
      emailTypes: Array.isArray(emailTypes) && emailTypes.length > 0 ? emailTypes : ['WELCOME', 'ID_CARD', 'APPROVAL', 'ID_CARD_UPDATED', 'SYSTEM'],
      enabled: enabled !== false,
      description: String(description).trim(),
    };

    const cfg = await Config.findOneAndUpdate(
      { key: 'main' },
      { $push: { emailRecipients: newRecipient } },
      { upsert: true, new: true }
    );
    await bumpRev();
    return res.json({ ok: true, recipient: newRecipient, recipients: cfg.emailRecipients });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/email-recipients/:id', auth, requireSuper, async (req, res) => {
  try {
    const recId = String(req.params.id).trim();
    const { name, email, type, emailTypes, enabled, description } = req.body || {};
    const cfg = await Config.findOne({ key: 'main' });
    if (!cfg) return res.status(404).json({ error: 'Config not found.' });

    const existingIdx = (cfg.emailRecipients || []).findIndex((r) => r.id === recId);
    if (existingIdx === -1) {
      return res.status(404).json({ error: 'Recipient not found.' });
    }

    const current = cfg.emailRecipients[existingIdx];
    if (name !== undefined) current.name = String(name).trim();
    if (email !== undefined) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!cleanEmail || !cleanEmail.includes('@')) {
        return res.status(400).json({ error: 'Invalid email address.' });
      }
      current.email = cleanEmail;
    }
    if (type !== undefined) {
      current.type = ['TO', 'CC', 'BCC'].includes(String(type).toUpperCase()) ? String(type).toUpperCase() : current.type;
    }
    if (Array.isArray(emailTypes)) current.emailTypes = emailTypes;
    if (enabled !== undefined) current.enabled = Boolean(enabled);
    if (description !== undefined) current.description = String(description).trim();

    await cfg.save();
    await bumpRev();
    return res.json({ ok: true, recipient: current, recipients: cfg.emailRecipients });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/admin/email-recipients/:id', auth, requireSuper, async (req, res) => {
  try {
    const recId = String(req.params.id).trim();
    const cfg = await Config.findOneAndUpdate(
      { key: 'main' },
      { $pull: { emailRecipients: { id: recId } } },
      { new: true }
    );
    await bumpRev();
    return res.json({ ok: true, message: 'Recipient deleted.', recipients: cfg?.emailRecipients || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 14. Email Templates Management (Super Admin Only) ----------------
router.get('/admin/email-templates', auth, requireSuper, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    const templates = {
      ...DEFAULT_EMAIL_TEMPLATES,
      ...(cfg?.emailTemplates || {}),
    };
    return res.json({ templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/email-templates/:type', auth, requireSuper, async (req, res) => {
  try {
    const type = String(req.params.type).trim();
    if (!['welcome', 'idCard', 'idCardUpdated', 'approval'].includes(type)) {
      return res.status(400).json({ error: 'Invalid email template type.' });
    }

    const { subject, heading, subheading, bodyText, footerText, logoUrl, headerBg, accentColor } = req.body || {};
    const cfg = await Config.findOne({ key: 'main' });
    if (!cfg) return res.status(404).json({ error: 'Config not found.' });

    if (!cfg.emailTemplates || typeof cfg.emailTemplates !== 'object') {
      cfg.emailTemplates = { ...DEFAULT_EMAIL_TEMPLATES };
    }

    const currentTpl = cfg.emailTemplates[type] || DEFAULT_EMAIL_TEMPLATES[type] || {};
    cfg.emailTemplates[type] = {
      ...currentTpl,
      ...(subject !== undefined ? { subject: String(subject).trim() } : {}),
      ...(heading !== undefined ? { heading: String(heading).trim() } : {}),
      ...(subheading !== undefined ? { subheading: String(subheading).trim() } : {}),
      ...(bodyText !== undefined ? { bodyText: String(bodyText) } : {}),
      ...(footerText !== undefined ? { footerText: String(footerText).trim() } : {}),
      ...(logoUrl !== undefined ? { logoUrl: String(logoUrl) } : {}),
      ...(headerBg !== undefined ? { headerBg: String(headerBg) } : {}),
      ...(accentColor !== undefined ? { accentColor: String(accentColor) } : {}),
    };

    cfg.markModified('emailTemplates');
    await cfg.save();
    await bumpRev();

    return res.json({ ok: true, template: cfg.emailTemplates[type], type });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/email-templates/:type/reset', auth, requireSuper, async (req, res) => {
  try {
    const type = String(req.params.type).trim();
    if (!['welcome', 'idCard', 'idCardUpdated', 'approval'].includes(type)) {
      return res.status(400).json({ error: 'Invalid template type.' });
    }
    const defaultTpl = DEFAULT_EMAIL_TEMPLATES[type];
    const cfg = await Config.findOne({ key: 'main' });
    if (cfg) {
      if (!cfg.emailTemplates) cfg.emailTemplates = {};
      cfg.emailTemplates[type] = { ...defaultTpl };
      cfg.markModified('emailTemplates');
      await cfg.save();
      await bumpRev();
    }
    return res.json({ ok: true, template: defaultTpl, type });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/email-templates/:type/test', auth, requireSuper, async (req, res) => {
  try {
    const type = String(req.params.type).trim();
    const { targetEmail = '', templateData = {} } = req.body || {};
    const recipient = String(targetEmail || req.user.email || `${req.user.username}@gmail.com`).trim();

    if (!recipient || !recipient.includes('@')) {
      return res.status(400).json({ error: 'A valid target email address is required.' });
    }

    const cfg = await Config.findOne({ key: 'main' }).lean();
    const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };
    const savedTpl = cfg?.emailTemplates?.[type] || DEFAULT_EMAIL_TEMPLATES[type] || {};
    const tpl = { ...savedTpl, ...templateData };

    const sampleData = {
      traineeName: 'Rahul Sharma',
      traineeId: 'TR-DEMO-001',
      qrId: 'QR-DEMO-001',
      traineeEmail: recipient,
      hostelName: 'Apollo Campus Block A',
      roomNumber: '102',
      joiningDate: '15/01/2026',
      freeValidityStartDate: '15/01/2026',
      freeValidityEndDate: '15/04/2026',
      organizationName: branding.orgName || 'APOLLO TYRES LTD',
      organizationLogo: tpl.logoUrl || branding.logo || '',
      idCardAttachment: `${getAppUrl()}/#/verify/QR-DEMO-001`,
    };

    const subject = `[TEST PREVIEW] ${replaceDynamicPlaceholders(tpl.subject, sampleData)}`;
    const heading = replaceDynamicPlaceholders(tpl.heading, sampleData);
    const subheading = replaceDynamicPlaceholders(tpl.subheading, sampleData);
    const bodyText = replaceDynamicPlaceholders(tpl.bodyText, sampleData);
    const footerText = replaceDynamicPlaceholders(tpl.footerText, sampleData);
    const headerBg = tpl.headerBg || '#2E1065';
    const accentColor = tpl.accentColor || '#7C3AED';

    const text = `
[DEMO TEST EMAIL — ${type.toUpperCase()}]
${bodyText}

Sample Details:
- Trainee: ${sampleData.traineeName} (${sampleData.traineeId})
- Hostel: ${sampleData.hostelName}, Room: ${sampleData.roomNumber}
- Free Stay: ${sampleData.freeValidityStartDate} to ${sampleData.freeValidityEndDate}

${footerText}
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
  <div style="background: #eab308; color: #000; padding: 6px 12px; font-size: 11px; font-weight: bold; border-radius: 4px; text-align: center; margin-bottom: 12px;">
    DEMO TEST PREVIEW EMAIL · SENT FROM ADMIN CONSOLE
  </div>
  <div style="background: ${headerBg}; color: #ffffff; padding: 18px 22px; border-radius: 8px 8px 0 0; margin: 0 -24px 20px -24px; display: flex; align-items: center; justify-content: space-between;">
    <div>
      <h2 style="margin: 0; font-size: 20px; color: #ffffff;">${heading}</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #ddd6fe;">${subheading}</p>
    </div>
    ${sampleData.organizationLogo ? `<img src="${sampleData.organizationLogo}" alt="${sampleData.organizationName}" style="max-height: 42px; max-width: 130px; object-fit: contain; margin-left: 12px;" />` : ''}
  </div>

  <div style="font-size: 14.5px; color: #1e293b; line-height: 1.6; white-space: pre-line; margin: 16px 0;">
    ${bodyText}
  </div>

  <div style="background: #f8fafc; border-left: 4px solid ${accentColor}; padding: 14px 18px; margin: 18px 0; border-radius: 6px; font-size: 13.5px;">
    <p style="margin: 4px 0;"><strong>Trainee:</strong> ${sampleData.traineeName} (<span style="font-family: monospace; color: ${accentColor}; font-weight: bold;">${sampleData.traineeId}</span>)</p>
    <p style="margin: 4px 0;"><strong>Hostel / Room:</strong> ${sampleData.hostelName} · Room ${sampleData.roomNumber}</p>
    <p style="margin: 4px 0;"><strong>Validity Period:</strong> ${sampleData.freeValidityStartDate} → ${sampleData.freeValidityEndDate}</p>
  </div>

  <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 24px; text-align: center;">
    ${footerText}
  </p>
</div>
`;

    const dispatch = await sendEmail({
      to: recipient,
      subject,
      text,
      html,
      type: 'TEST',
      triggeredBy: `Admin Test (${req.user.username})`,
      metadata: { templateType: type },
    });

    return res.json({ ok: true, recipient, dispatch });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 15. Email Delivery History / Logs (Super Admin Only) ----------------
router.get('/admin/email-logs', auth, requireSuper, async (req, res) => {
  try {
    const logs = await EmailLog.find({}).sort({ sentAt: -1 }).limit(150).lean();
    return res.json({ logs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 16. Admin Notification Email Management (Super Admin) ----------------
router.get('/admin/notification-email', auth, async (req, res) => {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    let email = cfg?.adminNotificationEmail && !cfg.adminNotificationEmail.endsWith('@hostel.com')
      ? cfg.adminNotificationEmail.trim().toLowerCase()
      : '';
    if (!email) {
      const admin = await User.findOne({
        roleId: { $in: ['superadmin', 'admin'] },
        active: true,
        email: { $exists: true, $ne: '', $not: /@hostel\.com$/i },
      }).sort({ createdAt: 1 }).lean();
      email = admin?.email ? admin.email.trim().toLowerCase() : '';
    }
    if (!email) {
      email = (process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'apollotyres.hostel@gmail.com').trim().toLowerCase();
    }
    return res.json({ adminNotificationEmail: email });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/admin/notification-email', auth, requireSuper, async (req, res) => {
  try {
    const { email = '' } = req.body || {};
    const cleanEmail = String(email).trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return res.status(400).json({ error: 'Please provide a valid administrator email address.' });
    }

    // 1. Update Config model as single source of truth
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { adminNotificationEmail: cleanEmail } },
      { upsert: true }
    );

    // 2. Synchronize admin user records in User collection
    await User.updateMany(
      { username: { $in: ['admin', 'superadmin'] } },
      { $set: { email: cleanEmail } }
    );

    // 3. Synchronize approvers list in approvalConfig if admin/superadmin is an approver
    const cfg = await Config.findOne({ key: 'main' });
    if (cfg?.approvalConfig?.approvers?.length > 0) {
      let modified = false;
      cfg.approvalConfig.approvers = cfg.approvalConfig.approvers.map((appr) => {
        if (appr.username === 'admin' || appr.username === 'superadmin') {
          modified = true;
          return { ...appr, email: cleanEmail };
        }
        return appr;
      });
      if (modified) {
        cfg.markModified('approvalConfig');
        await cfg.save();
      }
    }

    await bumpRev();
    return res.json({
      ok: true,
      adminNotificationEmail: cleanEmail,
      message: 'Admin notification email updated and saved in MongoDB.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/admin/notification-email/test', auth, requireSuper, async (req, res) => {
  try {
    const { targetEmail = '' } = req.body || {};
    const cfg = await Config.findOne({ key: 'main' }).lean();
    const recipient = String(targetEmail || cfg?.adminNotificationEmail || req.user.email || '').trim().toLowerCase();

    if (!recipient || !recipient.includes('@')) {
      return res.status(400).json({ error: 'A valid target email address is required.' });
    }

    const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };
    const orgName = branding.orgName || 'APOLLO TYRES LTD';

    const subject = `[System Notification] Test Admin Alert — ${orgName}`;
    const text = `
Apollo Tyres Ltd — Trainee Hostel Operations
Administrative Notification Test

This is an automated verification confirming that the Admin Notification Email address (${recipient}) is active, operational, and correctly configured in MongoDB.

Triggered By: ${req.user.name} (${req.user.username})
Timestamp: ${new Date().toISOString()}
Configured Address: ${recipient}
`;

    const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
  <div style="background: linear-gradient(135deg, #2E1065 0%, #4C1D95 100%); color: #ffffff; padding: 18px 22px; border-radius: 8px 8px 0 0; margin: -24px -24px 20px -24px;">
    <h2 style="margin: 0; font-size: 20px; color: #ffffff;">Admin Notification Test</h2>
    <p style="margin: 4px 0 0 0; font-size: 13px; color: #ddd6fe;">${orgName} · Trainee Hostel System</p>
  </div>
  <p>Dear <strong>Administrator</strong>,</p>
  <p>This email confirms that the <strong>Admin Notification Email</strong> configuration in the Trainee Hostel Management System is active and receiving notifications.</p>
  <div style="background: #f8fafc; border-left: 4px solid #7c3aed; padding: 14px 18px; margin: 18px 0; border-radius: 6px;">
    <p style="margin: 4px 0;"><strong>Configured Address:</strong> <code style="color: #7c3aed; font-weight: bold;">${recipient}</code></p>
    <p style="margin: 4px 0;"><strong>Status:</strong> Active &amp; Verified in MongoDB</p>
    <p style="margin: 4px 0;"><strong>Triggered By:</strong> ${req.user.name} (${req.user.username})</p>
    <p style="margin: 4px 0;"><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>
  </div>
  <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 24px; text-align: center;">
    ${orgName} · Hostel Administration &amp; Trainee Operations
  </p>
</div>
`;

    const dispatch = await sendEmail({
      to: recipient,
      subject,
      text,
      html,
      type: 'SYSTEM',
      triggeredBy: `Admin Test Alert (${req.user.username})`,
      metadata: { targetEmail: recipient },
    });

    return res.json({ ok: true, recipient, dispatch });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
