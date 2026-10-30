import express from 'express';
import { auth, requireSuper } from '../middleware/auth.js';
import { Config } from '../models/Config.js';
import { User } from '../models/User.js';
import { Trainee } from '../models/Trainee.js';
import { ApprovalLog } from '../models/ApprovalLog.js';
import { bumpRev } from '../models/Meta.js';
import { sendDecisionNotificationEmail, sendEmail, getAppUrl } from '../services/emailService.js';
import { computeValidity } from '../utils/validity.js';
import { migrateExistingPhotosToDrive } from '../services/googleDriveService.js';
import { DEFAULT_ORG_BRANDING, DEFAULT_IDCARD_TEMPLATE, DEFAULT_EMAIL_TEMPLATE } from '../defaults.js';

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

    // Send email notification to trainee if email provided
    sendDecisionNotificationEmail({
      trainee,
      decision,
      rejectionReason: String(rejectionReason).trim(),
      actorName: req.user.name,
    }).catch(() => {});

    await bumpRev();

    return res.json({
      ok: true,
      message: `Trainee ${cleanId} marked ${decision}${finalStatus === 'APPROVED' ? ' (Approved and ready for room allocation)' : ''}.`,
      trainee,
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

export default router;
