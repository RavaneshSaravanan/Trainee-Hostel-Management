import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { NotificationLog } from '../models/NotificationLog.js';
import { EmailLog } from '../models/EmailLog.js';
import { Config } from '../models/Config.js';
import { Trainee } from '../models/Trainee.js';
import { User } from '../models/User.js';
import {
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_EMAIL_TEMPLATES,
  DEFAULT_IDCARD_TEMPLATE,
  DEFAULT_ORG_BRANDING,
} from '../defaults.js';
import { fmtDate } from '../utils/dates.js';
import { addThreeCalendarMonths } from '../utils/validity.js';

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
 * Resolves the primary admin notification email configured in MongoDB.
 * MongoDB is the single source of truth, overriding any hardcoded fallbacks.
 */
export async function getAdminNotificationEmail() {
  try {
    const cfg = await Config.findOne({ key: 'main' }).lean();
    if (cfg?.adminNotificationEmail && cfg.adminNotificationEmail.includes('@') && !cfg.adminNotificationEmail.endsWith('@hostel.com')) {
      return cfg.adminNotificationEmail.trim().toLowerCase();
    }
    const admin = await User.findOne({
      roleId: { $in: ['superadmin', 'admin'] },
      active: true,
      email: { $exists: true, $ne: '', $not: /@hostel\.com$/i },
    }).sort({ createdAt: 1 }).lean();

    if (admin?.email && admin.email.includes('@')) {
      return admin.email.trim().toLowerCase();
    }
  } catch (err) {
    console.error('[EmailService] Error retrieving admin notification email:', err.message);
  }
  return (process.env.ADMIN_EMAIL || process.env.SMTP_USER || 'apollotyres.hostel@gmail.com').trim().toLowerCase();
}

/**
 * Resolves active configured additional recipients (TO, CC, BCC) from database for an email type.
 * Supported types: 'WELCOME', 'ID_CARD', 'ID_CARD_UPDATED', 'APPROVAL', 'SYSTEM'
 */
export async function getRecipientsForType(emailType) {
  try {
    const normType = emailType === 'APPROVAL_REQUEST' || emailType === 'APPROVAL_DECISION' ? 'APPROVAL' : emailType;
    const cfg = await Config.findOne({ key: 'main' }).lean();
    const list = cfg?.emailRecipients || [];
    const active = list.filter(
      (r) => r && r.enabled !== false && Array.isArray(r.emailTypes) && (r.emailTypes.includes(normType) || r.emailTypes.includes(emailType))
    );

    const to = active.filter((r) => r.type === 'TO').map((r) => r.email.trim().toLowerCase()).filter(Boolean);
    const cc = active.filter((r) => r.type === 'CC').map((r) => r.email.trim().toLowerCase()).filter(Boolean);
    const bcc = active.filter((r) => r.type === 'BCC').map((r) => r.email.trim().toLowerCase()).filter(Boolean);

    // If SYSTEM notification or APPROVAL alert and admin notification email is configured, ensure admin receives copy if not already in TO/CC/BCC
    if (['SYSTEM', 'APPROVAL'].includes(normType) && cfg?.adminNotificationEmail) {
      const adminMail = cfg.adminNotificationEmail.trim().toLowerCase();
      if (adminMail && !to.includes(adminMail) && !cc.includes(adminMail) && !bcc.includes(adminMail)) {
        cc.push(adminMail);
      }
    }

    return { to, cc, bcc };
  } catch (err) {
    return { to: [], cc: [], bcc: [] };
  }
}

/**
 * Replaces usable dynamic placeholders with actual database values.
 * Placeholders:
 * {{traineeName}}, {{traineeId}}, {{qrId}}, {{traineeEmail}}, {{hostelName}},
 * {{roomNumber}}, {{joiningDate}}, {{freeValidityStartDate}}, {{freeValidityEndDate}},
 * {{organizationName}}, {{organizationLogo}}, {{idCardAttachment}}
 */
export function replaceDynamicPlaceholders(str = '', data = {}) {
  if (!str) return '';
  return String(str)
    .replace(/\{\{traineeName\}\}/g, data.traineeName || '')
    .replace(/\{\{traineeId\}\}/g, data.traineeId || '')
    .replace(/\{\{qrId\}\}/g, data.qrId || '')
    .replace(/\{\{traineeEmail\}\}/g, data.traineeEmail || '')
    .replace(/\{\{hostelName\}\}/g, data.hostelName || '')
    .replace(/\{\{roomNumber\}\}/g, data.roomNumber || '')
    .replace(/\{\{joiningDate\}\}/g, data.joiningDate || '')
    .replace(/\{\{freeValidityStartDate\}\}/g, data.freeValidityStartDate || '')
    .replace(/\{\{freeValidityEndDate\}\}/g, data.freeValidityEndDate || '')
    .replace(/\{\{organizationName\}\}/g, data.organizationName || 'Apollo Tyres Ltd')
    .replace(/\{\{organizationLogo\}\}/g, data.organizationLogo || '')
    .replace(/\{\{idCardAttachment\}\}/g, data.idCardAttachment || '');
}

/**
 * Core email dispatch helper.
 * Automatically attaches configured additional CC and BCC recipients.
 * Records comprehensive audit history in both EmailLog and NotificationLog.
 */
export async function sendEmail({
  to,
  cc = [],
  bcc = [],
  subject,
  html,
  text,
  attachments = [],
  type = 'GENERAL',
  traineeId = '',
  traineeName = '',
  triggeredBy = 'System',
  metadata = {},
}) {
  const from = process.env.SMTP_FROM || 'Apollo Tyres Ltd Hostel Administration <noreply@hostel.com>';
  const transport = getTransporter();

  // Merge with dynamically configured recipients for this email type
  const additional = await getRecipientsForType(type);
  const primaryToList = Array.isArray(to) ? to : [to];
  const finalTo = Array.from(new Set([...primaryToList, ...(additional.to || [])])).filter(Boolean);
  const initialCc = Array.isArray(cc) ? cc : [cc];
  const finalCc = Array.from(new Set([...initialCc, ...(additional.cc || [])])).filter(Boolean);
  const initialBcc = Array.isArray(bcc) ? bcc : [bcc];
  const finalBcc = Array.from(new Set([...initialBcc, ...(additional.bcc || [])])).filter(Boolean);

  const recipientString = finalTo.join(', ');

  // Diagnostic safe logging (no passwords, tokens or secrets)
  const diagnosticInfo = {
    timestamp: new Date().toISOString(),
    emailType: type,
    decision: metadata?.decision || (type === 'APPROVAL_DECISION' ? metadata?.decision : undefined),
    traineeId: traineeId || metadata?.traineeId || '',
    intendedRecipients: {
      primaryTo: primaryToList,
      finalTo,
      cc: finalCc,
      bcc: finalBcc,
    },
    subject,
    templateId: metadata?.templateType || type,
  };
  console.log(`[EMAIL DISPATCH INITIATED] ${JSON.stringify(diagnosticInfo)}`);

  if (transport) {
    try {
      const mailOptions = {
        from,
        to: finalTo,
        subject,
        html,
        text,
      };
      if (finalCc.length > 0) mailOptions.cc = finalCc;
      if (finalBcc.length > 0) mailOptions.bcc = finalBcc;
      if (Array.isArray(attachments) && attachments.length > 0) {
        mailOptions.attachments = attachments;
      }

      const info = await transport.sendMail(mailOptions);

      await Promise.all([
        NotificationLog.create({
          type,
          recipient: recipientString,
          subject,
          content: text || html,
          status: 'SENT',
          metadata: { ...metadata, to: finalTo, cc: finalCc, bcc: finalBcc, messageId: info.messageId },
        }),
        EmailLog.create({
          recipient: recipientString,
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          emailType: type,
          status: 'SENT',
          traineeId,
          traineeName,
          triggeredBy,
          content: html || text,
          metadata: { ...metadata, html, text, messageId: info.messageId },
        }),
      ]);

      console.log(`[EMAIL DISPATCH COMPLETED] ${JSON.stringify({ ...diagnosticInfo, status: 'SENT', messageId: info.messageId })}`);
      return { ok: true, status: 'SENT', messageId: info.messageId, to: finalTo, cc: finalCc, bcc: finalBcc };
    } catch (err) {
      console.error(`[EMAIL DISPATCH FAILED] ${JSON.stringify({ ...diagnosticInfo, status: 'FAILED', error: err.message })}`);

      await Promise.all([
        NotificationLog.create({
          type,
          recipient: recipientString,
          subject,
          content: text || html,
          status: 'FAILED',
          error: err.message,
          metadata: { ...metadata, to: finalTo, cc: finalCc, bcc: finalBcc },
        }),
        EmailLog.create({
          recipient: recipientString,
          to: finalTo,
          cc: finalCc,
          bcc: finalBcc,
          subject,
          emailType: type,
          status: 'FAILED',
          error: err.message,
          traineeId,
          traineeName,
          triggeredBy,
          content: html || text,
          metadata: { ...metadata, html, text },
        }),
      ]);

      return { ok: false, status: 'FAILED', error: err.message, to: finalTo, cc: finalCc, bcc: finalBcc };
    }
  }

  // Development / Unconfigured SMTP mode: log cleanly and persist audit record
  console.log(`\n======================================================`);
  console.log(`[Email Simulated] (Configure SMTP_HOST in .env for live dispatch)`);
  console.log(`To      : ${finalTo.join(', ')}`);
  if (finalCc.length > 0) console.log(`CC      : ${finalCc.join(', ')}`);
  if (finalBcc.length > 0) console.log(`BCC     : ${finalBcc.join(', ')}`);
  console.log(`Subject : ${subject}`);
  console.log(`Type    : ${type}`);
  console.log(`Message : \n${text || html}`);
  console.log(`======================================================\n`);

  await Promise.all([
    NotificationLog.create({
      type,
      recipient: recipientString,
      subject,
      content: text || html,
      status: 'DEV_SIMULATED',
      metadata: { ...metadata, to: finalTo, cc: finalCc, bcc: finalBcc },
    }),
    EmailLog.create({
      recipient: recipientString,
      to: finalTo,
      cc: finalCc,
      bcc: finalBcc,
      subject,
      emailType: type,
      status: 'DEV_SIMULATED',
      traineeId,
      traineeName,
      triggeredBy,
      content: html || text,
      metadata: { ...metadata, html, text },
    }),
  ]);

  console.log(`[EMAIL DISPATCH COMPLETED] ${JSON.stringify({ ...diagnosticInfo, status: 'DEV_SIMULATED' })}`);
  return { ok: true, status: 'DEV_SIMULATED', to: finalTo, cc: finalCc, bcc: finalBcc };
}

/**
 * AUTOMATIC WELCOME EMAIL AFTER COMPLETE REGISTRATION AND ROOM ALLOCATION
 * 
 * Rules:
 * 1. Sent only after BOTH conditions are satisfied:
 *    - All mandatory trainee registration details are completed and validated.
 *    - A hostel and room have been successfully allocated to the trainee.
 * 2. Sent ONLY ONCE per trainee (unless force === true for Super Admin retry).
 * 3. Includes 3 calendar months free accommodation validity period calculation.
 */
export async function sendTraineeWelcomeEmail({ trainee, force = false, triggeredBy = 'Room Allocation' }) {
  if (!trainee) return { ok: false, error: 'No trainee provided' };

  // 1. Mandatory details validation
  const missingFields = [];
  if (!trainee.name) missingFields.push('Name');
  if (!trainee.mobile) missingFields.push('Mobile');
  if (!trainee.email) missingFields.push('Email');
  if (!trainee.gender) missingFields.push('Gender');
  if (!trainee.qualification) missingFields.push('Qualification');
  if (!trainee.aadhar) missingFields.push('Aadhaar');
  if (!trainee.joiningDate) missingFields.push('Joining Date');

  if (missingFields.length > 0) {
    return {
      ok: false,
      reason: 'MANDATORY_DETAILS_INCOMPLETE',
      message: `Welcome email deferred: Missing mandatory details (${missingFields.join(', ')}).`,
    };
  }

  // 2. Email format validation (@gmail.com strictly required)
  const email = String(trainee.email || '').trim().toLowerCase();
  if (!email.endsWith('@gmail.com')) {
    return {
      ok: false,
      reason: 'INVALID_EMAIL',
      message: 'Welcome email skipped: Registered email must be a valid @gmail.com address.',
    };
  }

  // 3. Room allocation & Approval condition
  const hasHostel = Boolean(trainee.hostel && String(trainee.hostel).trim());
  const hasRoom = Boolean(trainee.roomNo && String(trainee.roomNo).trim());
  const isApproved = trainee.approvalStatus === 'APPROVED';
  const isNotRejected = trainee.approvalStatus !== 'REJECTED' && trainee.hostelStatus !== 'REJECTED';

  if (!hasHostel || !hasRoom || !isApproved || !isNotRejected) {
    return {
      ok: false,
      reason: 'ROOM_NOT_ALLOCATED_OR_NOT_APPROVED',
      message: 'Welcome email deferred: Trainee must be approved and allocated to a hostel room.',
    };
  }

  // 4. Duplicate prevention: sent only ONCE per trainee
  if (trainee.welcomeEmailSent && !force) {
    return {
      ok: true,
      reason: 'ALREADY_SENT',
      message: 'Welcome email has already been sent to this trainee.',
      sentAt: trainee.welcomeEmailSentAt,
    };
  }

  // 5. Compute Free-Stay Validity Period (exact 3 calendar months from joining date)
  const freeValidityStartDate = fmtDate(trainee.joiningDate);
  const expiryIso = addThreeCalendarMonths(trainee.joiningDate);
  const freeValidityEndDate = fmtDate(expiryIso);

  // 6. Load customizable welcome template and branding from Config
  const cfg = await Config.findOne({ key: 'main' }).lean();
  const welcomeTpl = {
    ...DEFAULT_EMAIL_TEMPLATES.welcome,
    ...(cfg?.emailTemplates?.welcome || {}),
  };
  const branding = {
    ...DEFAULT_ORG_BRANDING,
    ...(cfg?.orgBranding || {}),
  };

  const orgName = branding.orgName || 'APOLLO TYRES LTD';
  const orgLogo = welcomeTpl.logoUrl || branding.logo || cfg?.logo || '';
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/#/verify/${encodeURIComponent(trainee.qrId || trainee.traineeId)}`;

  const effectiveHostel = String(trainee.hostel || trainee.hostelName || (trainee.hostelId && trainee.hostelId !== trainee.traineeId ? trainee.hostelId : '') || '').trim();
  const rawRoom = String(trainee.roomNo || trainee.room || '').trim();
  const effectiveRoomNo = rawRoom ? (rawRoom.toLowerCase().startsWith('room') ? rawRoom : `Room ${rawRoom}`) : '';

  const placeholderData = {
    traineeName: trainee.name,
    traineeId: trainee.traineeId || trainee.qrId,
    qrId: trainee.qrId,
    traineeEmail: trainee.email,
    hostelName: effectiveHostel || 'Hostel Campus',
    roomNumber: effectiveRoomNo || 'To be assigned',
    joiningDate: fmtDate(trainee.joiningDate),
    freeValidityStartDate,
    freeValidityEndDate,
    organizationName: orgName,
    organizationLogo: orgLogo,
    idCardAttachment: verifyUrl,
  };

  const subject = replaceDynamicPlaceholders(welcomeTpl.subject, placeholderData);
  const heading = replaceDynamicPlaceholders(welcomeTpl.heading, placeholderData);
  const subheading = replaceDynamicPlaceholders(welcomeTpl.subheading, placeholderData);
  const bodyText = replaceDynamicPlaceholders(welcomeTpl.bodyText, placeholderData);
  const footerText = replaceDynamicPlaceholders(welcomeTpl.footerText, placeholderData);
  const headerBg = welcomeTpl.headerBg || '#2E1065';
  const accentColor = welcomeTpl.accentColor || '#7C3AED';

  const text = `
========================================================================
${orgName.toUpperCase()} — TRAINEE HOSTEL ADMISSION
========================================================================

${bodyText}

TRAINEE & ROOM ALLOCATION DETAILS:
- Trainee Name              : ${trainee.name}
- Trainee ID                : ${trainee.traineeId || '—'}
- Unique QR ID              : ${trainee.qrId}
- Email Address             : ${trainee.email || "—"}
- Mobile Number             : ${trainee.mobile || "—"}
- Guardian Name             : ${trainee.guardianName || "—"}
- Guardian Contact          : ${trainee.guardianContact || "—"}
- Allocated Hostel          : ${effectiveHostel || "Hostel Campus"}
- Allocated Room Number     : ${effectiveRoomNo || "To be assigned"}
- Official Joining Date     : ${fmtDate(trainee.joiningDate)}

FREE ACCOMMODATION VALIDITY:
- Validity Duration         : Exactly 3 Calendar Months
- Free Stay Start Date      : ${freeValidityStartDate}
- Free Stay Expiry Date     : ${freeValidityEndDate}

IMPORTANT HOSTEL RULES & ONBOARDING GUIDELINES:
1. ID Card & QR Code: Keep your digital Trainee Identity Card accessible at all times for campus and hostel security check-ins.
2. Daily Attendance: Attendance is strictly marked through the hostel scanner system according to your shift schedule.
3. Outing and Leave: Record all departure (OUT) and return (IN) movements through hostel administration before leaving.
4. Hostel Premises: Maintain cleanliness, discipline, and adhere to hostel quiet hours (10:00 PM to 6:00 AM).

View / Verify Your Digital ID Card:
${verifyUrl}

${footerText}
`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.06);">
  <!-- Header Banner -->
  <div style="background: linear-gradient(135deg, ${headerBg} 0%, #4c1d95 100%); color: #ffffff; padding: 24px; text-align: center;">
    ${orgLogo ? `<img src="${orgLogo}" alt="${orgName}" style="max-height: 48px; max-width: 160px; object-fit: contain; margin-bottom: 10px;" /><br/>` : ''}
    <h1 style="margin: 0; font-size: 22px; letter-spacing: 0.5px; color: #ffffff;">${heading}</h1>
    <p style="margin: 6px 0 0 0; font-size: 13.5px; color: #ddd6fe;">${subheading}</p>
  </div>

  <!-- Accent Divider -->
  <div style="height: 6px; background: ${accentColor};"></div>

  <!-- Main Body Content -->
  <div style="padding: 26px;">
    <div style="font-size: 14.5px; color: #1e293b; line-height: 1.6; white-space: pre-line; margin-bottom: 20px;">
      ${bodyText}
    </div>

    <!-- Allocation Details Card -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid ${accentColor}; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
      <h3 style="margin: 0 0 12px 0; font-size: 15px; color: ${headerBg}; text-transform: uppercase; letter-spacing: 0.5px;">
        Hostel Room Allocation Summary
      </h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13.5px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b; width: 40%;">Trainee Name:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${trainee.name}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Trainee ID:</td>
            <td style="padding: 6px 0; color: ${accentColor}; font-weight: bold; font-family: monospace;">${trainee.traineeId || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Unique QR ID:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold; font-family: monospace;">${trainee.qrId}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Email Address:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${trainee.email || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Mobile Number:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${trainee.mobile || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Guardian Name:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${trainee.guardianName || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Guardian Contact No:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${trainee.guardianContact || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Allocated Hostel:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${effectiveHostel || "Hostel Campus"}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 6px 0; color: #64748b;">Allocated Room:</td>
            <td style="padding: 6px 0; color: #16a34a; font-weight: bold; font-size: 14px;">${effectiveRoomNo || "To be assigned"}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Joining Date:</td>
            <td style="padding: 6px 0; color: #0f172a; font-weight: bold;">${fmtDate(trainee.joiningDate)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Free Accommodation Validity Period Box -->
    <div style="background: #ede9fe; border: 1px solid #c4b5fd; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #5b21b6; letter-spacing: 0.5px;">
            Free Accommodation Validity (3 Calendar Months)
          </div>
          <div style="font-size: 15px; font-weight: bold; color: #2e1065; margin-top: 4px;">
            ${freeValidityStartDate} &nbsp;→&nbsp; ${freeValidityEndDate}
          </div>
        </div>
        <div style="background: #7c3aed; color: #ffffff; font-size: 11.5px; font-weight: bold; padding: 4px 10px; border-radius: 12px;">
          COMPLIMENTARY
        </div>
      </div>
      <p style="margin: 8px 0 0 0; font-size: 12px; color: #6d28d9;">
        Hostel accommodation is fully covered by ${orgName} for the first 3 calendar months from joining.
      </p>
    </div>

    <!-- Important Hostel Rules -->
    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 18px; margin-bottom: 22px;">
      <h4 style="margin: 0 0 8px 0; font-size: 13.5px; color: #92400e;">
        Important Onboarding & Hostel Guidelines:
      </h4>
      <ul style="margin: 0; padding-left: 18px; font-size: 12.5px; color: #78350f; line-height: 1.6;">
        <li>Daily shift attendance scanning via your QR badge is strictly mandatory.</li>
        <li>Record all departure (OUT) and return (IN) logs with hostel security before leaving.</li>
        <li>Keep your living quarters clean and maintain quiet hours between 10:00 PM and 6:00 AM.</li>
      </ul>
    </div>

    <!-- ID Card Action Button -->
    <div style="text-align: center; margin: 24px 0 10px 0;">
      <a href="${verifyUrl}" style="background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 13px 28px; border-radius: 8px; font-weight: bold; font-size: 14.5px; display: inline-block; box-shadow: 0 2px 8px rgba(124, 58, 237, 0.35);">
        View & Download Digital ID Card →
      </a>
      <p style="font-size: 11.5px; color: #94a3b8; margin: 8px 0 0 0;">
        Secure Access URL: <a href="${verifyUrl}" style="color: ${accentColor}; word-break: break-all;">${verifyUrl}</a>
      </p>
    </div>
  </div>

  <!-- Footer -->
  <div style="background: #f8fafc; border-top: 1px solid #e2e8f0; color: #64748b; padding: 16px 24px; font-size: 12px; text-align: center;">
    ${footerText}
  </div>
</div>
`;

  try {
    const result = await sendEmail({
      to: email,
      subject,
      text,
      html,
      type: 'WELCOME',
      traineeId: trainee.traineeId,
      traineeName: trainee.name,
      triggeredBy,
      metadata: {
        hostel: trainee.hostel,
        roomNo: trainee.roomNo,
        freeValidityStartDate,
        freeValidityEndDate,
      },
    });

    await Trainee.updateOne(
      { _id: trainee._id },
      {
        $set: {
          welcomeEmailSent: true,
          welcomeEmailSentAt: new Date(),
          welcomeEmailError: '',
        },
      }
    );

    return { ok: true, status: 'DELIVERED', recipient: email, dispatch: result };
  } catch (err) {
    await Trainee.updateOne(
      { _id: trainee._id },
      {
        $set: {
          welcomeEmailError: err.message,
        },
      }
    );
    return { ok: false, error: err.message };
  }
}

/**
 * Sends review requests to configured approval authorities with secure, expiring review links.
 */
export async function sendApprovalRequestEmail({ approver, trainee }) {
  const appUrl = getAppUrl();
  const jwtSecret = process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';

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
  const approvalTpl = {
    ...DEFAULT_EMAIL_TEMPLATES.approval,
    ...(cfg?.emailTemplates?.approval || {}),
  };
  const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };

  const orgName = branding.orgName || 'APOLLO TYRES LTD';
  const orgLogo = approvalTpl.logoUrl || branding.logo || cfg?.logo || '';
  const traineeName = trainee.name || '';
  const traineeId = trainee.traineeId || '';
  const joiningDate = fmtDate(trainee.joiningDate);
  const department = trainee.qualification || 'Trainee Operations';
  const approverName = approver.name || 'Approver';

  const placeholderData = {
    traineeName,
    traineeId,
    qrId: trainee.qrId || '',
    traineeEmail: trainee.email || '',
    joiningDate,
    organizationName: orgName,
    organizationLogo: orgLogo,
  };

  const subject = replaceDynamicPlaceholders(
    approvalTpl.subject || '[Action Required] Review Registration: {{traineeName}} ({{traineeId}})',
    placeholderData
  );
  const heading = replaceDynamicPlaceholders(approvalTpl.heading || 'Trainee Registration Review Request', placeholderData);
  const subheading = replaceDynamicPlaceholders(approvalTpl.subheading || `${orgName} — Trainee Hostel Operations`, placeholderData);
  const bodyText = replaceDynamicPlaceholders(
    approvalTpl.bodyText || 'A new trainee registration has been submitted and requires your official review.',
    placeholderData
  );
  const footerText = replaceDynamicPlaceholders(
    approvalTpl.footerText || 'Security Notice: This link contains a secure, single-use token expiring in 7 days.',
    placeholderData
  );
  const headerBg = approvalTpl.headerBg || '#2E1065';
  const accentColor = approvalTpl.accentColor || '#7C3AED';
  const fontFamily = 'Arial, sans-serif';

  const text = `
Dear ${approverName},

${bodyText}

Trainee Details:
- Name: ${traineeName}
- Trainee ID: ${traineeId}
- Contact: ${trainee.mobile || '—'}
- Department / Qualification: ${department}
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
    <p style="margin: 4px 0;"><strong>Email Address:</strong> ${trainee.email || '—'}</p>
    <p style="margin: 4px 0;"><strong>Mobile Number:</strong> ${trainee.mobile || '—'}</p>
    <p style="margin: 4px 0;"><strong>Guardian Name:</strong> ${trainee.guardianName || '—'}</p>
    <p style="margin: 4px 0;"><strong>Guardian Contact:</strong> ${trainee.guardianContact || '—'}</p>
    <p style="margin: 4px 0;"><strong>Department / Qualification:</strong> ${department}</p>
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

  // Resolve approver email dynamically from live User records in MongoDB or Config
  let approverEmail = '';
  if (approver.userId || approver.id) {
    const liveUser = await User.findOne({ id: approver.userId || approver.id }).lean();
    if (liveUser?.email && !liveUser.email.endsWith('@hostel.com')) approverEmail = liveUser.email.trim();
  }
  if (!approverEmail && approver.username) {
    const liveUser = await User.findOne({ username: approver.username }).lean();
    if (liveUser?.email && !liveUser.email.endsWith('@hostel.com')) approverEmail = liveUser.email.trim();
  }
  if (!approverEmail && approver.email && !approver.email.endsWith('@hostel.com')) {
    approverEmail = approver.email.trim();
  }
  if (!approverEmail || approverEmail.endsWith('@hostel.com')) {
    approverEmail = await getAdminNotificationEmail();
  }

  if (!approverEmail || !approverEmail.includes('@')) {
    console.warn(`[Approval Request Alert Skipped] Approver "${approver.name || approver.username}" has no valid email address configured.`);
    return {
      ok: false,
      status: 'SKIPPED_NO_EMAIL',
      error: `No valid email configured for approver ${approver.name || approver.username}`,
    };
  }

  return sendEmail({
    to: approverEmail,
    subject,
    text,
    html,
    type: 'APPROVAL_REQUEST',
    traineeId: trainee.traineeId,
    traineeName: trainee.name,
    triggeredBy: 'Approval Request',
    metadata: { traineeId: trainee.traineeId, approverId: approver.userId || approver.id },
  });
}

/**
 * Single source of truth template renderer for Trainee Approval and Rejection Decision emails.
 * Guarantees strict parity between saved MongoDB status, subject, heading, body, badge, and theme color.
 */
export function renderDecisionEmailContent({
  decision,
  trainee,
  actorName = 'Hostel Administrator',
  rejectionReason = '',
  organizationName = 'APOLLO TYRES LTD',
  organizationLogo = '',
}) {
  const norm = String(decision || trainee?.approvalStatus || '').trim().toUpperCase();
  const isApproved = norm === 'APPROVED' || norm === 'APPROVE';
  const isRejected = norm === 'REJECTED' || norm === 'REJECT';

  if (!isApproved && !isRejected) {
    throw new Error(`Invalid approval decision: "${decision}". Must be APPROVED or REJECTED.`);
  }

  const finalDecision = isApproved ? 'APPROVED' : 'REJECTED';
  const heading = isApproved ? 'REGISTRATION APPROVED' : 'REGISTRATION REJECTED';
  const subject = isApproved
    ? 'Your Hostel Registration Has Been Approved'
    : 'Your Hostel Registration Has Been Rejected';
  const bodyText = isApproved
    ? 'Your hostel registration has been reviewed and approved successfully.'
    : 'Your hostel registration has been reviewed and rejected.';
  const reviewer = actorName || trainee?.approvedBy || 'Hostel Administrator';
  const reason = isRejected ? String(rejectionReason || trainee?.rejectionReason || 'Details could not be verified').trim() : '';

  // Positive green styling (#16a34a) for approval; red styling (#dc2626) for rejection
  const bannerBg = isApproved ? '#16a34a' : '#dc2626';
  const accentBorder = isApproved ? '#16a34a' : '#dc2626';
  const badgeBg = isApproved ? '#dcfce7' : '#fee2e2';
  const badgeText = isApproved ? '#15803d' : '#b91c1c';
  const badgeBorder = isApproved ? '#86efac' : '#fca5a5';

  const text = isApproved
    ? `${heading}\n\nDear ${trainee.name},\n\n${bodyText}\n\nTrainee ID: ${trainee.traineeId}\nDecision: ${finalDecision}\nReviewer: ${reviewer}\n\nA hostel room and ID card will be allocated shortly.\n\n${organizationName} Trainee Hostel Administration`
    : `${heading}\n\nDear ${trainee.name},\n\n${bodyText}\n\nTrainee ID: ${trainee.traineeId}\nDecision: ${finalDecision}\nReviewer: ${reviewer}\nRejection Reason: ${reason}\n\n${organizationName} Trainee Hostel Administration`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 10px; background: #ffffff;">
  <!-- Decision Banner -->
  <div style="background: ${bannerBg}; color: #ffffff; padding: 18px 22px; border-radius: 8px 8px 0 0; margin: -24px -24px 20px -24px; display: flex; align-items: center; justify-content: space-between;">
    <div>
      <h2 style="margin: 0; font-size: 20px; color: #ffffff; letter-spacing: 0.5px;">${heading}</h2>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: rgba(255, 255, 255, 0.95);">${organizationName} — Trainee Hostel Operations</p>
    </div>
    ${organizationLogo ? `<img src="${organizationLogo}" alt="${organizationName}" style="max-height: 40px; max-width: 120px; object-fit: contain; margin-left: 12px;" />` : ''}
  </div>

  <p style="font-size: 15px; color: #1e293b;">Dear <strong>${trainee.name}</strong>,</p>
  <p style="font-size: 14.5px; color: #334155; line-height: 1.6;">${bodyText}</p>
  
  <!-- Review Decision Box -->
  <div style="background: #f8fafc; border-left: 4px solid ${accentBorder}; border-top: 1px solid #f1f5f9; border-right: 1px solid #f1f5f9; border-bottom: 1px solid #f1f5f9; padding: 16px 20px; margin: 20px 0; border-radius: 6px;">
    <div style="margin-bottom: 8px; font-size: 14px; color: #1e293b;">
      <strong>Trainee ID:</strong> <span style="font-family: monospace; font-weight: bold; color: ${accentBorder};">${trainee.traineeId}</span>
    </div>
    <div style="margin-bottom: 8px; font-size: 14px; color: #1e293b; display: flex; align-items: center; gap: 8px;">
      <strong>Decision:</strong> 
      <span style="background: ${badgeBg}; color: ${badgeText}; border: 1px solid ${badgeBorder}; padding: 2px 10px; border-radius: 4px; font-weight: bold; font-size: 13px;">
        ${finalDecision}
      </span>
    </div>
    ${isRejected && reason ? `
    <div style="margin-bottom: 8px; font-size: 14px; color: #1e293b;">
      <strong>Rejection Reason:</strong> <span style="color: #dc2626; font-weight: 500;">${reason}</span>
    </div>` : ''}
    <div style="font-size: 14px; color: #1e293b;">
      <strong>Reviewer:</strong> ${reviewer}
    </div>
  </div>

  ${isApproved ? `
  <p style="font-size: 13.5px; color: #475569; line-height: 1.5;">
    Your registration has been approved. The hostel warden will allocate your hostel and room number shortly. Upon room allocation, your official Trainee Identity Card and Welcome Package will be sent to this email address.
  </p>` : `
  <p style="font-size: 13.5px; color: #475569; line-height: 1.5;">
    If you believe this decision was made in error or if you have questions regarding the rejection reason, please contact the Hostel Administration office.
  </p>`}

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />
  <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
    ${organizationName} · Trainee Hostel Management System · Automated Notification
  </p>
</div>
`;

  return {
    subject,
    heading,
    bodyText,
    decision: finalDecision,
    bannerBg,
    accentBorder,
    reviewer,
    rejectionReason: reason,
    text,
    html,
  };
}

/**
 * Sends decision notification after approval/rejection to trainee.
 * Strictly uses single source of truth rendered content with pre-send validation.
 */
export async function sendDecisionNotificationEmail({ trainee, decision, rejectionReason = '', actorName }) {
  if (!trainee || !trainee.email) {
    console.warn('[Decision Email Skipped] Trainee or trainee email missing.');
    return { ok: false, error: 'No trainee email' };
  }

  const cfg = await Config.findOne({ key: 'main' }).lean();
  const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };

  // Use single source of truth template renderer
  const content = renderDecisionEmailContent({
    decision,
    trainee,
    actorName,
    rejectionReason,
    organizationName: branding.orgName || 'APOLLO TYRES LTD',
    organizationLogo: branding.logo || '',
  });

  // Strict pre-send validation: Ensure subject, heading, body, and decision strictly match
  if (content.decision === 'APPROVED') {
    if (content.heading !== 'REGISTRATION APPROVED' ||
        content.subject !== 'Your Hostel Registration Has Been Approved' ||
        !content.bodyText.includes('approved successfully') ||
        content.bannerBg !== '#16a34a') {
      throw new Error('Approval email validation failed: Contradictory content detected.');
    }
  } else if (content.decision === 'REJECTED') {
    if (content.heading !== 'REGISTRATION REJECTED' ||
        content.subject !== 'Your Hostel Registration Has Been Rejected' ||
        !content.bodyText.includes('reviewed and rejected') ||
        content.bannerBg !== '#dc2626') {
      throw new Error('Rejection email validation failed: Contradictory content detected.');
    }
  }

  // Diagnostic logging before dispatch
  console.log(`[EMAIL DIAGNOSTIC - DECISION NOTIFICATION] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    emailType: 'APPROVAL_DECISION',
    decision: content.decision,
    traineeEmail: trainee.email,
    reviewer: content.reviewer,
    subject: content.subject,
    heading: content.heading,
  })}`);

  return sendEmail({
    to: trainee.email,
    subject: content.subject,
    text: content.text,
    html: content.html,
    type: 'APPROVAL_DECISION',
    traineeId: trainee.traineeId,
    traineeName: trainee.name,
    triggeredBy: 'Approval Decision',
    metadata: {
      decision: content.decision,
      reviewer: content.reviewer,
      rejectionReason: content.rejectionReason,
      heading: content.heading,
    },
  });
}

/**
 * Generates a high-resolution, vector-crisp CR80 vertical ID Card PDF buffer.
 * Incorporates Apollo Tyres violet & deep purple theme, company branding,
 * trainee photo/initials avatar, trainee details, and actual scannable QR code.
 */
export async function generateIdCardPdf({ trainee, branding = {}, qrBuffer, verifyUrl = '' }) {
  return new Promise((resolve, reject) => {
    try {
      const companyName = branding.orgName || 'APOLLO TYRES LTD';
      const subtitle = 'OFFICIAL TRAINEE ID CARD';
      const footerText = `Authorized Trainee ID Card · ${companyName}`;

      const doc = new PDFDocument({ size: [240, 380], margin: 0 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      // Outer border (violet-tinted border with rounded corners)
      doc.roundedRect(2, 2, 236, 376, 8).lineWidth(1).stroke('#DDD6FE');

      // Header background (Deep violet #2E1065)
      doc.save();
      doc.roundedRect(2, 2, 236, 60, 8).clip();
      doc.rect(2, 2, 236, 60).fill('#2E1065');
      doc.restore();

      // Header text: Organization Name & Subtitle
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11).text(companyName.toUpperCase(), 10, 16, { align: 'center', width: 220 });
      doc.fillColor('#DDD6FE').font('Helvetica').fontSize(7.5).text(subtitle.toUpperCase(), 10, 32, { align: 'center', width: 220, characterSpacing: 1 });

      // Accent violet stripe (#7C3AED)
      doc.rect(2, 60, 236, 3).fill('#7C3AED');

      // Trainee Photo or Avatar
      let photoRendered = false;
      if (trainee.photo && typeof trainee.photo === 'string') {
        try {
          if (trainee.photo.startsWith('data:image/')) {
            const base64Data = trainee.photo.split(',')[1];
            if (base64Data) {
              const photoBuf = Buffer.from(base64Data, 'base64');
              doc.image(photoBuf, 88, 70, { fit: [64, 64], align: 'center', valign: 'center' });
              doc.rect(88, 70, 64, 64).lineWidth(1.5).stroke('#7C3AED');
              photoRendered = true;
            }
          }
        } catch {
          photoRendered = false;
        }
      }

      if (!photoRendered) {
        // Initials avatar circle
        doc.circle(120, 100, 26).fillAndStroke('#EDE9FE', '#7C3AED');
        const initials = ((trainee.name || 'TR').trim().slice(0, 2)).toUpperCase();
        doc.fillColor('#5B21B6').font('Helvetica-Bold').fontSize(15).text(initials, 95, 93, { align: 'center', width: 50 });
      }

      // Trainee Name
      doc.fillColor('#1E1B4B').font('Helvetica-Bold').fontSize(12).text(trainee.name || 'Trainee', 10, 140, { align: 'center', width: 220 });

      // Badge ID pill
      doc.roundedRect(30, 158, 180, 16, 4).fill('#EDE9FE');
      const badgeText = `ID: ${trainee.traineeId || 'Unassigned'}  •  QR: ${trainee.qrId || '—'}`;
      doc.fillColor('#5B21B6').font('Helvetica-Bold').fontSize(7.5).text(badgeText, 30, 162, { align: 'center', width: 180 });

      // Details key-values
      const effectiveHostel = String(trainee.hostel || trainee.hostelName || (trainee.hostelId && trainee.hostelId !== trainee.traineeId ? trainee.hostelId : '') || '').trim();
      const rawRoom = String(trainee.roomNo || trainee.room || '').trim();
      const effectiveRoomNo = rawRoom ? (rawRoom.toLowerCase().startsWith('room') ? rawRoom : `Room ${rawRoom}`) : '';

      const details = [
        ['Hostel Block:', effectiveHostel || 'Hostel Campus'],
        ['Room Number:', effectiveRoomNo || 'To be assigned'],
        ['Mobile Number:', trainee.mobile || '—'],
        ['Joining Date:', fmtDate(trainee.joiningDate)],
      ];
      let startY = 182;
      details.forEach(([lbl, val]) => {
        doc.fillColor('#6D28D9').font('Helvetica-Bold').fontSize(7.5).text(lbl, 24, startY, { width: 75 });
        doc.fillColor('#1E1B4B').font('Helvetica').fontSize(7.5).text(val, 98, startY, { width: 118 });
        startY += 12;
      });

      // QR Code (Actual unique scannable QR Code image)
      if (qrBuffer) {
        doc.image(qrBuffer, 82, 234, { width: 76, height: 76 });
        doc.rect(80, 232, 80, 80).lineWidth(1).stroke('#DDD6FE');
        doc.fillColor('#6D28D9').font('Helvetica-Bold').fontSize(6.5).text('SCAN FOR INSTANT VERIFICATION', 10, 318, { align: 'center', width: 220 });
      }

      // Footer
      doc.save();
      doc.roundedRect(2, 356, 236, 22, 8).clip();
      doc.rect(2, 356, 236, 22).fill('#2E1065');
      doc.restore();
      doc.fillColor('#DDD6FE').font('Helvetica').fontSize(6.5).text(footerText, 10, 362, { align: 'center', width: 220 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Automatically delivers the official Trainee Identity Card to the trainee's
 * registered @gmail.com address upon completing registration and gaining approval.
 */
export async function sendTraineeIdCardEmail({ trainee, force = false, isUpdated = false }) {
  if (!trainee) return { ok: false, error: 'No trainee provided' };

  // 1. Validate email address format (@gmail.com strictly required)
  const email = String(trainee.email || '').trim().toLowerCase();
  if (!email || !email.endsWith('@gmail.com')) {
    return {
      ok: false,
      reason: 'INVALID_EMAIL',
      message: 'ID Card delivery skipped: Registered email must be a valid @gmail.com address.',
    };
  }

  // 2. Pending Record Handling: Do NOT send while incomplete or pending
  const isApproved = trainee.approvalStatus === 'APPROVED';
  const isNotPending = trainee.hostelStatus !== 'PENDING REVIEW' && trainee.hostelStatus !== 'PENDING_APPROVAL';
  const isNotRejected = trainee.approvalStatus !== 'REJECTED' && trainee.hostelStatus !== 'REJECTED';

  if (!isApproved || !isNotPending || !isNotRejected) {
    return {
      ok: false,
      reason: 'PENDING_INCOMPLETE',
      message: 'ID Card delivery deferred: Trainee record is currently pending approval or incomplete.',
    };
  }

  // 3. Avoid duplicate delivery for unchanged record unless forced or updated
  if (trainee.idCardDelivered && !force && !isUpdated) {
    return {
      ok: true,
      reason: 'ALREADY_DELIVERED',
      message: 'ID Card already delivered to this trainee.',
      deliveredAt: trainee.idCardDeliveredAt,
    };
  }

  // 4. Load configuration template and organization branding
  const cfg = await Config.findOne({ key: 'main' }).lean();
  const idCardTpl = isUpdated
    ? { ...DEFAULT_EMAIL_TEMPLATES.idCardUpdated, ...(cfg?.emailTemplates?.idCardUpdated || {}) }
    : { ...DEFAULT_EMAIL_TEMPLATES.idCard, ...(cfg?.emailTemplates?.idCard || {}) };
  const branding = { ...DEFAULT_ORG_BRANDING, ...(cfg?.orgBranding || {}) };

  const companyName = branding.orgName || 'APOLLO TYRES LTD';
  const effectiveLogo = idCardTpl.logoUrl || branding.logo || cfg?.logo || '';
  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/#/verify/${encodeURIComponent(trainee.qrId || trainee.traineeId)}`;
  const displayJoiningDate = fmtDate(trainee.joiningDate);

  const effectiveHostel = String(trainee.hostel || trainee.hostelName || (trainee.hostelId && trainee.hostelId !== trainee.traineeId ? trainee.hostelId : '') || '').trim();
  const rawRoom = String(trainee.roomNo || trainee.room || '').trim();
  const effectiveRoomNo = rawRoom ? (rawRoom.toLowerCase().startsWith('room') ? rawRoom : `Room ${rawRoom}`) : '';

  const placeholderData = {
    traineeName: trainee.name,
    traineeId: trainee.traineeId || 'Unassigned',
    qrId: trainee.qrId,
    traineeEmail: trainee.email,
    traineeMobile: trainee.mobile,
    guardianName: trainee.guardianName,
    guardianContact: trainee.guardianContact,
    hostelName: effectiveHostel || 'Hostel Campus',
    roomNumber: effectiveRoomNo || 'To be assigned',
    joiningDate: displayJoiningDate,
    organizationName: companyName,
    organizationLogo: effectiveLogo,
    idCardAttachment: verifyUrl,
  };

  const subject = replaceDynamicPlaceholders(
    idCardTpl.subject || `Official Trainee Identity Card — ${companyName} ({{traineeName}})`,
    placeholderData
  );
  const heading = replaceDynamicPlaceholders(idCardTpl.heading || companyName, placeholderData);
  const subtitle = replaceDynamicPlaceholders(idCardTpl.subheading || 'TRAINEE IDENTITY CARD', placeholderData);
  const bodyText = replaceDynamicPlaceholders(
    idCardTpl.bodyText || `Congratulations! Your trainee registration with ${companyName} has been officially approved.`,
    placeholderData
  );
  const footerText = replaceDynamicPlaceholders(
    idCardTpl.footerText || `Authorized Trainee ID Card · ${companyName}`,
    placeholderData
  );

  const headerBgStart = idCardTpl.headerBg || '#2E1065';
  const headerBgEnd = '#4C1D95';
  const accentColor = idCardTpl.accentColor || '#7C3AED';

  // Generate high-resolution, scannable QR Code image (Data URL for HTML & Buffer for PDF)
  const qrContent = verifyUrl;
  const qrDataUrl = await QRCode.toDataURL(qrContent, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 280,
    color: { dark: '#2E1065', light: '#FFFFFF' },
  });
  const qrBuffer = await QRCode.toBuffer(qrContent, {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 280,
    color: { dark: '#2E1065', light: '#FFFFFF' },
  });

  const text = `
Dear ${trainee.name},

${bodyText}

===========================================
${companyName.toUpperCase()}
${subtitle.toUpperCase()}
===========================================
Name          : ${trainee.name}
QR ID         : ${trainee.qrId}
Trainee ID    : ${trainee.traineeId || 'Unassigned'}
Email Address : ${trainee.email || "—"}
Mobile Number : ${trainee.mobile || "—"}
Guardian Name : ${trainee.guardianName || "—"}
Guardian Phone: ${trainee.guardianContact || "—"}
Department    : ${trainee.qualification || "Trainee Operations"}
Hostel Block  : ${effectiveHostel || 'Hostel Campus'}
Room Number   : ${effectiveRoomNo || 'To be assigned'}
Joining Date  : ${displayJoiningDate}

Public Verification Link:
${verifyUrl}

${footerText}
`;

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f8fafc; border-radius: 12px;">
  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
    <!-- Card Header -->
    <div style="background: linear-gradient(135deg, ${headerBgStart} 0%, ${headerBgEnd} 100%); color: #ffffff; padding: 20px; text-align: center;">
      ${effectiveLogo ? `<img src="${effectiveLogo}" alt="${companyName}" style="max-height: 48px; max-width: 140px; object-fit: contain; margin-bottom: 8px;" /><br/>` : ''}
      <h1 style="margin: 0; font-size: 20px; letter-spacing: 0.5px; color: #ffffff;">${heading.toUpperCase()}</h1>
      <p style="margin: 4px 0 0 0; font-size: 13px; color: #ddd6fe; letter-spacing: 1px;">${subtitle.toUpperCase()}</p>
    </div>
    
    <!-- Accent Stripe -->
    <div style="height: 6px; background: ${accentColor};"></div>

    <!-- Card Body -->
    <div style="padding: 24px; text-align: center;">
      <div style="display: inline-block; width: 110px; height: 110px; border-radius: 50%; border: 4px solid ${accentColor}; background: #ede9fe; color: #5b21b6; font-size: 38px; font-weight: bold; line-height: 102px; overflow: hidden; margin-bottom: 12px;">
        ${trainee.photo ? `<img src="${trainee.photo.startsWith('http') || trainee.photo.startsWith('data:') ? trainee.photo : `${appUrl}${trainee.photo}`}" alt="${trainee.name}" style="width: 100%; height: 100%; object-fit: cover;" />` : trainee.name.slice(0, 2).toUpperCase()}
      </div>

      <h2 style="margin: 0; font-size: 22px; color: #1e1b4b;">${trainee.name}</h2>
      <div style="display: inline-block; background: #ede9fe; color: ${headerBgEnd}; font-family: monospace; font-size: 14px; font-weight: bold; padding: 4px 14px; border-radius: 12px; margin: 6px 0 16px 0;">
        QR ID: ${trainee.qrId} ${trainee.traineeId ? `· ID: ${trainee.traineeId}` : ''}
      </div>

      <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px; margin: 12px 0 20px 0;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Qualification:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${trainee.qualification || 'Trainee'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Mobile Number:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${trainee.mobile || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Email Address:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${trainee.email || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Guardian Name:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${trainee.guardianName || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Guardian Contact No:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${trainee.guardianContact || '—'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Hostel Block:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${effectiveHostel || 'Hostel Campus'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Room Number:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${effectiveRoomNo || 'Unassigned'}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 12px; color: #6d28d9; font-weight: 600;">Joining Date:</td>
            <td style="padding: 8px 12px; color: #1e1b4b; font-weight: bold;">${displayJoiningDate}</td>
          </tr>
        </tbody>
      </table>

      <!-- Scannable Trainee QR Code -->
      <div style="margin: 20px 0 16px 0; text-align: center;">
        <div style="display: inline-block; padding: 12px; background: #ffffff; border: 2px solid #7c3aed; border-radius: 12px; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.12);">
          <img src="${qrDataUrl}" alt="Trainee QR Code (${trainee.qrId})" width="140" height="140" style="display: block; margin: 0 auto;" />
          <div style="font-size: 11px; font-weight: bold; color: #6d28d9; margin-top: 8px; letter-spacing: 0.5px;">SCAN FOR INSTANT VERIFICATION</div>
          <div style="font-size: 10px; color: #64748b; font-family: monospace; margin-top: 2px;">${trainee.qrId}</div>
        </div>
      </div>

      <!-- Verification Link Button -->
      <div style="margin: 16px 0 8px 0;">
        <a href="${verifyUrl}" style="background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 14px; display: inline-block;">
          View / Verify Digital ID Card Badge →
        </a>
      </div>
      <p style="font-size: 11px; color: #94a3b8; margin: 6px 0 0 0;">
        Verification URL: <a href="${verifyUrl}" style="color: ${accentColor};">${verifyUrl}</a>
      </p>
      <div style="margin-top: 14px; padding: 10px 14px; background: #f5f3ff; border: 1px dashed #c4b5fd; border-radius: 8px; font-size: 12px; color: #5b21b6;">
        📎 <strong>Official Trainee ID Card Attached:</strong> A printable high-resolution PDF copy has been attached to this email for your records.
      </div>
    </div>

    <!-- Card Footer -->
    <div style="background: ${headerBgStart}; color: #ddd6fe; padding: 12px 16px; font-size: 11.5px; text-align: center;">
      ${footerText}
    </div>
  </div>
</div>
`;

  try {
    let pdfBuffer = null;
    try {
      pdfBuffer = await generateIdCardPdf({ trainee, branding, qrBuffer, verifyUrl });
    } catch (pdfErr) {
      console.warn('[ID Card PDF Generation Warning]', pdfErr.message);
    }

    const attachments = [];
    if (pdfBuffer) {
      const filename = `Trainee-ID-Card-${trainee.traineeId || trainee.qrId}.pdf`;
      attachments.push({
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      });
    }

    const emailType = isUpdated ? 'ID_CARD_UPDATED' : 'ID_CARD';
    const result = await sendEmail({
      to: email,
      subject,
      text,
      html,
      attachments,
      type: emailType,
      traineeId: trainee.traineeId,
      traineeName: trainee.name,
      triggeredBy: isUpdated ? 'Room Change / Update' : 'Approval Decision',
      metadata: { traineeId: trainee.traineeId, qrId: trainee.qrId, hasPdfAttachment: !!pdfBuffer },
    });

    await Trainee.updateOne(
      { _id: trainee._id },
      {
        $set: {
          idCardDelivered: true,
          idCardDeliveredAt: new Date(),
          idCardDeliveryError: '',
        },
      }
    );

    return { ok: true, status: 'DELIVERED', recipient: email, dispatch: result };
  } catch (err) {
    await Trainee.updateOne(
      { _id: trainee._id },
      {
        $set: {
          idCardDeliveryError: err.message,
        },
      }
    );
    return { ok: false, error: err.message };
  }
}


/**
 * Sends a 4-digit verification OTP to the user's email during trainee registration.
 * Expires in 5 minutes.
 */
export async function sendRegistrationOtpEmail({ email, otp }) {
  const subject = `Your Verification Code for Hostel Registration: ${otp}`;
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h2 style="color: #1e293b; margin-top: 0;">Email Verification</h2>
      <p style="color: #475569; font-size: 15px;">Use the verification code below to complete your Trainee Registration. This code is valid for 5 minutes.</p>
      <div style="margin: 24px 0; padding: 16px; background-color: #f1f5f9; border-radius: 8px; text-align: center;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0284c7;">${otp}</span>
      </div>
      <p style="color: #64748b; font-size: 13px;">If you did not request this verification code, please ignore this email.</p>
    </div>
  `;
  const text = `Your verification code for Trainee Registration is: ${otp}. It expires in 5 minutes.`;
  return sendEmail({
    to: email,
    subject,
    html,
    text,
    type: 'OTP',
    triggeredBy: 'Registration OTP Request',
  });
}
