import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import { NotificationLog } from '../models/NotificationLog.js';
import { Config } from '../models/Config.js';
import { DEFAULT_EMAIL_TEMPLATE, DEFAULT_ORG_BRANDING } from '../defaults.js';

let transporter = null;

/**
 * Returns the deployed website base URL, ensuring trailing slashes are removed.
 * Strictly uses configured APP_URL or FRONTEND_URL, falling back to CLIENT_ORIGIN.
 */
export function getAppUrl() {
  const url = process.env.APP_URL || process.env.FRONTEND_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173';
  return url.replace(/\/+$/, '');
}

/**
 * Configures and returns live Nodemailer SMTP transporter.
 * Sourced from environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_FROM.
 */
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    if (!transporter) {
      const port = Number(process.env.SMTP_PORT) || 587;
      const secure = process.env.SMTP_SECURE === 'true' || port === 465;

      transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: process.env.NODE_ENV === 'production',
        },
      });
    }
    return transporter;
  }
  return null;
}

/**
 * Core email dispatch helper.
 * Uses real SMTP if configured; records audit trail in MongoDB NotificationLog.
 */
export async function sendEmail({ to, subject, html, text, type = 'GENERAL', metadata = {} }) {
  const from = process.env.SMTP_FROM || 'Trainee Hostel <noreply@hostel.com>';
  const transport = getTransporter();

  if (transport) {
    try {
      const info = await transport.sendMail({ from, to, subject, html, text });
      await NotificationLog.create({
        type,
        recipient: to,
        subject,
        content: text || html,
        status: 'SENT',
        metadata: { ...metadata, messageId: info.messageId },
      });
      console.log(`[Email] Notification sent via SMTP to ${to}: "${subject}"`);
      return { ok: true, status: 'SENT', messageId: info.messageId };
    } catch (err) {
      console.error(`[Email Error] Failed sending via SMTP to ${to}:`, err.message);
      await NotificationLog.create({
        type,
        recipient: to,
        subject,
        content: text || html,
        status: 'FAILED',
        error: err.message,
        metadata,
      });
      return { ok: false, status: 'FAILED', error: err.message };
    }
  }

  // Development / Unconfigured SMTP mode: log cleanly and persist audit record
  console.log(`\n======================================================`);
  console.log(`[Email Simulated] (Configure SMTP_HOST in .env for live dispatch)`);
  console.log(`To      : ${to}`);
  console.log(`Subject : ${subject}`);
  console.log(`Type    : ${type}`);
  console.log(`Message : \n${text || html}`);
  console.log(`======================================================\n`);

  await NotificationLog.create({
    type,
    recipient: to,
    subject,
    content: text || html,
    status: 'DEV_SIMULATED',
    metadata,
  });

  return { ok: true, status: 'DEV_SIMULATED' };
}

/**
 * Sends review requests to configured approval authorities with secure, expiring review links.
 */
export async function sendApprovalRequestEmail({ approver, trainee }) {
  const appUrl = getAppUrl();
  const jwtSecret = process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';

  // Secure expiring single-use authorization token (valid for 7 days)
  const token = jwt.sign(
    {
      traineeId: trainee.traineeId,
      approverId: approver.userId,
      purpose: 'REVIEW_REGISTRATION',
    },
    jwtSecret,
    { expiresIn: '7d' }
  );

  const reviewLink = `${appUrl}/#/review/${encodeURIComponent(trainee.traineeId)}?token=${token}`;

  const cfg = await Config.findOne({ key: 'main' }).lean();
  const tpl = { ...DEFAULT_EMAIL_TEMPLATE, ...(cfg?.emailTemplate || {}) };
  const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };

  const orgName = branding.orgName || 'APOLLO TYRES LTD';
  const orgLogo = branding.logo || '';
  const traineeName = trainee.name || '';
  const traineeId = trainee.traineeId || '';
  const joiningDate = trainee.joiningDate || '';
  const department = trainee.department || trainee.qualification || 'Operations';
  const approverName = approver.name || 'Approver';

  // Dynamic token substitution
  const replaceTokens = (str = '') =>
    String(str)
      .replace(/\{\{traineeName\}\}/g, traineeName)
      .replace(/\{\{traineeId\}\}/g, traineeId)
      .replace(/\{\{joiningDate\}\}/g, joiningDate)
      .replace(/\{\{department\}\}/g, department)
      .replace(/\{\{approvalLink\}\}/g, reviewLink)
      .replace(/\{\{organizationName\}\}/g, orgName)
      .replace(/\{\{organizationLogo\}\}/g, orgLogo)
      .replace(/\{\{approverName\}\}/g, approverName);

  const subject = replaceTokens(tpl.subject || '[Action Required] Review Registration: {{traineeName}} ({{traineeId}})');
  const heading = replaceTokens(tpl.heading || 'Trainee Registration Review Request');
  const subheading = replaceTokens(tpl.subheading || `${orgName} — Trainee Hostel Operations`);
  const bodyText = replaceTokens(tpl.bodyText || 'A new trainee registration has been submitted and requires your official review.');
  const footerText = replaceTokens(tpl.footerText || 'Security Notice: This link contains a secure, single-use token expiring in 7 days.');
  const headerBg = tpl.headerBg || '#2E1065';
  const accentColor = tpl.accentColor || '#7C3AED';
  const fontFamily = tpl.fontFamily || 'Arial, sans-serif';

  const text = `
Dear ${approverName},

${bodyText}

Trainee Details:
- Name: ${traineeName}
- Trainee ID: ${traineeId}
- Contact: ${trainee.mobile || '—'}
- Department / Qualification: ${department}
- Shift: ${trainee.defaultShift || 'G'}
- Joining Date: ${joiningDate || 'Today'}
- Organization: ${orgName}

Please click the secure link below to open the website review page and record your decision:
${reviewLink}

Note: You must be authenticated as an authorized approver to execute approval or rejection.

${footerText}
`;

  const html = `
<div style="font-family: ${fontFamily}; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
  <div style="background: ${headerBg}; color: #ffffff; padding: 18px 22px; border-radius: 8px 8px 0 0; margin: -24px -24px 20px -24px; display: flex; align-items: center; justify-content: space-between;">
    <div>
      <h2 style="margin: 0; font-size: 20px; color: #ffffff;">${heading}</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #ddd6fe;">${subheading}</p>
    </div>
    ${orgLogo ? `<img src="${orgLogo}" alt="${orgName}" style="max-height: 42px; max-width: 130px; object-fit: contain; margin-left: 12px;" />` : ''}
  </div>

  <p style="font-size: 15px; color: #1e293b;">Dear <strong>${approverName}</strong>,</p>
  <div style="font-size: 14px; color: #334155; line-height: 1.6; white-space: pre-line; margin: 12px 0;">${bodyText}</div>
  
  <div style="background: #f8fafc; border-left: 4px solid ${accentColor}; padding: 14px 18px; margin: 18px 0; border-radius: 6px;">
    <p style="margin: 4px 0;"><strong>Full Name:</strong> ${traineeName}</p>
    <p style="margin: 4px 0;"><strong>Trainee ID:</strong> <span style="font-family: monospace; font-weight: bold; color: ${accentColor};">${traineeId}</span></p>
    <p style="margin: 4px 0;"><strong>Mobile:</strong> ${trainee.mobile || '—'}</p>
    <p style="margin: 4px 0;"><strong>Department / Qualification:</strong> ${department}</p>
    <p style="margin: 4px 0;"><strong>Default Shift:</strong> ${trainee.defaultShift || 'G'} Shift</p>
    <p style="margin: 4px 0;"><strong>Joining Date:</strong> ${joiningDate || 'Today'}</p>
  </div>

  <div style="margin: 28px 0; text-align: center;">
    <a href="${reviewLink}" style="background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">
      Open Trainee Review & Decisions →
    </a>
  </div>

  <p style="font-size: 12.5px; color: #64748b; margin-top: 16px;">
    Direct secure link: <a href="${reviewLink}" style="color: ${accentColor}; word-break: break-all;">${reviewLink}</a>
  </p>

  <p style="font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 14px; margin-top: 24px;">
    ${footerText}
  </p>
</div>
`;

  return sendEmail({
    to: approver.email || `${approver.username}@hostel.com`,
    subject,
    text,
    html,
    type: 'APPROVAL_REQUEST',
    metadata: { traineeId: trainee.traineeId, approverId: approver.userId },
  });
}

/**
 * Sends decision notification after approval/rejection to trainee
 */
export async function sendDecisionNotificationEmail({ trainee, decision, rejectionReason = '', actorName }) {
  if (!trainee.email) return;

  const isApproved = decision === 'APPROVED';
  const subject = `Your Hostel Registration has been ${isApproved ? 'Approved' : 'Rejected'}`;
  
  const text = isApproved
    ? `Dear ${trainee.name},\n\nYour trainee hostel registration (${trainee.traineeId}) has been approved by ${actorName}.\nA hostel room and ID card will be allocated shortly.\n\nTrainee Hostel Team`
    : `Dear ${trainee.name},\n\nYour trainee hostel registration (${trainee.traineeId}) was reviewed and could not be approved at this time.\nReason: ${rejectionReason || 'Details could not be verified'}.\n\nTrainee Hostel Team`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
  <div style="background: ${isApproved ? '#16a34a' : '#dc2626'}; color: #ffffff; padding: 16px 20px; border-radius: 8px 8px 0 0; margin: -24px -24px 20px -24px;">
    <h2 style="margin: 0; font-size: 20px;">Registration ${decision}</h2>
    <p style="margin: 4px 0 0 0; font-size: 13px; color: rgba(255,255,255,0.9);">Hostel Administration Decision</p>
  </div>

  <p>Dear <strong>${trainee.name}</strong>,</p>
  <p>${isApproved ? 'Congratulations! Your hostel registration has been officially approved.' : 'Your hostel registration has been reviewed and rejected.'}</p>
  
  <div style="background: #f8fafc; border-left: 4px solid ${isApproved ? '#16a34a' : '#dc2626'}; padding: 14px 18px; margin: 18px 0; border-radius: 6px;">
    <p style="margin: 4px 0;"><strong>Trainee ID:</strong> ${trainee.traineeId}</p>
    <p style="margin: 4px 0;"><strong>Decision:</strong> ${decision}</p>
    ${!isApproved && rejectionReason ? `<p style="margin: 4px 0;"><strong>Reason:</strong> ${rejectionReason}</p>` : ''}
    <p style="margin: 4px 0;"><strong>Reviewed By:</strong> ${actorName}</p>
  </div>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
  <p style="font-size: 12px; color: #94a3b8;">Trainee Hostel Management System</p>
</div>
`;

  return sendEmail({
    to: trainee.email,
    subject,
    text,
    html,
    type: 'APPROVAL_DECISION',
    metadata: { traineeId: trainee.traineeId, decision },
  });
}
