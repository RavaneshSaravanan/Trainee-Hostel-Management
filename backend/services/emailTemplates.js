/**
 * Comprehensive Responsive HTML & Plain-Text Email Templates
 * Project: Trainee Hostel Management System (Apollo Tyres Ltd)
 * 
 * Standards:
 * - Mobile-responsive design with max-width 600px containers
 * - Inline CSS compatible with major mail clients (Gmail, Outlook, Apple Mail)
 * - Clean Apollo Tyres Ltd branding (#2E1065 header, #7C3AED accent)
 * - High-contrast CTA buttons and accessible typography
 * - Dynamic placeholder replacement support
 */

const DEFAULT_ORG_NAME = 'Apollo Tyres Ltd';
const BRAND_HEADER_BG = '#2E1065';
const BRAND_ACCENT = '#7C3AED';
const FONT_FAMILY = 'Arial, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/**
 * Replaces dynamic {{key}} tokens within strings.
 */
export function replaceDynamicTokens(template = '', data = {}) {
  if (!template) return '';
  return String(template).replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) => {
    return data[key] !== undefined && data[key] !== null ? String(data[key]) : '';
  });
}

/**
 * Wraps email body content in a standard responsive layout container.
 */
function wrapEmailLayout({
  title = '',
  subtitle = '',
  headerBg = BRAND_HEADER_BG,
  accentColor = BRAND_ACCENT,
  organizationName = DEFAULT_ORG_NAME,
  logoUrl = '',
  bodyContent = '',
  footerContent = '',
}) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f8fafc; font-family: ${FONT_FAMILY}; -webkit-font-smoothing: antialiased; }
    table { border-collapse: collapse; }
    img { border: 0; outline: none; text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; border-radius: 0 !important; }
      .email-content { padding: 18px !important; }
      .otp-code { font-size: 28px !important; letter-spacing: 6px !important; }
      .btn-cta { width: 100% !important; text-align: center !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #f8fafc; color: #1e293b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc;">
    <tr>
      <td align="center" style="padding: 12px;">
        <!-- Email Container (max 600px) -->
        <table role="presentation" class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width: 600px; max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header Banner -->
          <tr>
            <td style="background: linear-gradient(135deg, ${headerBg} 0%, #4c1d95 100%); padding: 24px 28px; text-align: center; color: #ffffff;">
              ${logoUrl ? `<img src="${logoUrl}" alt="${organizationName}" style="max-height: 44px; max-width: 160px; object-fit: contain; margin-bottom: 10px;" /><br/>` : ''}
              <h1 style="margin: 0; font-size: 21px; font-weight: 700; color: #ffffff; letter-spacing: 0.5px;">${title}</h1>
              ${subtitle ? `<p style="margin: 6px 0 0 0; font-size: 13.5px; color: #ddd6fe;">${subtitle}</p>` : ''}
            </td>
          </tr>
          <!-- Accent Stripe -->
          <tr>
            <td style="height: 5px; background-color: ${accentColor}; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>
          <!-- Body Content -->
          <tr>
            <td class="email-content" style="padding: 28px 32px; font-size: 14.5px; line-height: 1.6; color: #334155;">
              ${bodyContent}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 18px 24px; text-align: center; font-size: 12px; color: #64748b;">
              ${footerContent || `
                <div style="font-weight: 600; color: #475569; margin-bottom: 4px;">${organizationName} &middot; Trainee Hostel Management System</div>
                <div>Automated Transactional Notification &middot; Please do not reply directly to this email</div>
              `}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * 1. Welcome / Hostel Admission & Room Allocation Email
 */
export function renderWelcomeTemplate(data = {}) {
  const {
    traineeName = 'Trainee',
    traineeId = '',
    qrId = '',
    hostelName = 'Hostel Campus',
    roomNumber = 'To be assigned',
    joiningDate = 'Immediate',
    freeValidityStartDate = '',
    freeValidityEndDate = '',
    verifyUrl = '',
    organizationName = DEFAULT_ORG_NAME,
    bodyText = '',
    hasIdCardAttachment = true,
  } = data;

  const title = `Welcome to ${organizationName}`;
  const subtitle = 'Official Hostel Admission & Room Allocation Confirmation';

  const defaultBody = `Dear ${traineeName},\n\nCongratulations on joining ${organizationName}!\nWe are delighted to welcome you to our organization and trainee residential community.\n\nYour hostel room allocation and onboarding details have been confirmed below. Please review the accommodation guidelines and keep your digital Trainee Identity Card handy for campus and hostel security check-ins.`;

  const introText = (bodyText || defaultBody).replace(/\n/g, '<br/>');

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: BRAND_HEADER_BG,
    accentColor: BRAND_ACCENT,
    organizationName,
    bodyContent: `
      <div style="font-size: 15px; color: #1e293b; margin-bottom: 20px;">
        ${introText}
      </div>

      <!-- Room Allocation Summary Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid ${BRAND_ACCENT}; border-radius: 8px; margin: 20px 0;">
        <tr>
          <td style="padding: 18px 20px;">
            <div style="font-size: 13.5px; font-weight: 700; color: ${BRAND_HEADER_BG}; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">
              Hostel Room Allocation Summary
            </div>
            <table role="presentation" width="100%" cellpadding="6" cellspacing="0" style="font-size: 13.5px;">
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td width="40%" style="color: #64748b;">Trainee Name:</td>
                <td style="color: #0f172a; font-weight: 700;">${traineeName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="color: #64748b;">Trainee ID:</td>
                <td style="color: ${BRAND_ACCENT}; font-weight: 700; font-family: monospace;">${traineeId || '—'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="color: #64748b;">Unique QR Identifier:</td>
                <td style="color: #0f172a; font-weight: 700; font-family: monospace;">${qrId}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="color: #64748b;">Allocated Hostel:</td>
                <td style="color: #0f172a; font-weight: 700;">${hostelName}</td>
              </tr>
              <tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="color: #64748b;">Allocated Room Number:</td>
                <td style="color: #16a34a; font-weight: 700; font-size: 14px;">${roomNumber}</td>
              </tr>
              <tr>
                <td style="color: #64748b;">Joining Date:</td>
                <td style="color: #0f172a; font-weight: 600;">${joiningDate}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${freeValidityStartDate && freeValidityEndDate ? `
      <!-- Complimentary Stay Box -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ede9fe; border: 1px solid #c4b5fd; border-radius: 8px; margin: 18px 0;">
        <tr>
          <td style="padding: 16px 20px;">
            <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #5b21b6; letter-spacing: 0.5px;">
              Free Accommodation Validity (3 Calendar Months)
            </div>
            <div style="font-size: 15px; font-weight: 700; color: #2e1065; margin-top: 4px;">
              ${freeValidityStartDate} &nbsp;&rarr;&nbsp; ${freeValidityEndDate}
            </div>
            <p style="margin: 6px 0 0 0; font-size: 12px; color: #6d28d9;">
              Hostel accommodation is fully covered by ${organizationName} for the first 3 calendar months from joining.
            </p>
          </td>
        </tr>
      </table>` : ''}

      <!-- Important Onboarding Guidelines -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; margin: 18px 0;">
        <tr>
          <td style="padding: 14px 18px; font-size: 12.5px; color: #78350f;">
            <div style="font-weight: 700; color: #92400e; margin-bottom: 6px; font-size: 13px;">Important Hostel Guidelines:</div>
            <ul style="margin: 0; padding-left: 18px; line-height: 1.5;">
              <li>Attendance scanning with your QR code badge is strictly mandatory for every shift.</li>
              <li>Record all departure (OUT) and return (IN) logs with hostel security.</li>
              <li>Maintain quiet hours between 10:00 PM and 6:00 AM.</li>
            </ul>
          </td>
        </tr>
      </table>

      ${verifyUrl ? `
      <!-- Primary Action CTA -->
      <div style="text-align: center; margin: 26px 0 12px 0;">
        <a href="${verifyUrl}" class="btn-cta" style="background-color: ${BRAND_ACCENT}; color: #ffffff; text-decoration: none; padding: 13px 30px; border-radius: 8px; font-weight: 700; font-size: 14.5px; display: inline-block;">
          View Digital Trainee ID Card &rarr;
        </a>
      </div>` : ''}

      ${hasIdCardAttachment ? `
      <div style="margin-top: 18px; padding: 10px 14px; background-color: #f5f3ff; border: 1px dashed #c4b5fd; border-radius: 6px; font-size: 12px; color: #5b21b6; text-align: center;">
        &#128206; <strong>Official Trainee ID Card Attached:</strong> A printable high-resolution PDF copy is attached to this email.
      </div>` : ''}
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — WELCOME & HOSTEL ADMISSION
========================================================================

Dear ${traineeName},

${introText.replace(/<br\/>/g, '\n')}

ROOM ALLOCATION DETAILS:
- Trainee Name         : ${traineeName}
- Trainee ID           : ${traineeId || '—'}
- QR ID                : ${qrId}
- Hostel Block         : ${hostelName}
- Room Number          : ${roomNumber}
- Joining Date         : ${joiningDate}
${freeValidityStartDate ? `- Free Stay Duration   : ${freeValidityStartDate} to ${freeValidityEndDate} (3 Months)` : ''}

${verifyUrl ? `View Your Digital ID Card:\n${verifyUrl}\n` : ''}
${hasIdCardAttachment ? 'Note: Your official printable ID Card PDF is attached to this email.\n' : ''}
${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: data.subject || `Welcome to ${organizationName} – Hostel & Room Allocation (${traineeName})` };
}

/**
 * 2. Email OTP Verification Template
 */
export function renderEmailOtpTemplate(data = {}) {
  const {
    otp = '',
    expiresMinutes = 5,
    email = '',
    organizationName = DEFAULT_ORG_NAME,
    purpose = 'Trainee Registration Verification',
  } = data;

  const title = 'Email Verification Code';
  const subtitle = `${organizationName} &middot; Secure Identity Verification`;

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: BRAND_HEADER_BG,
    accentColor: BRAND_ACCENT,
    organizationName,
    bodyContent: `
      <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
        Hello,
      </p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        We received a request to verify your email address (<strong>${email}</strong>) for <strong>${purpose}</strong>.
        Please use the single-use verification code below to complete your verification:
      </p>

      <!-- Prominent OTP Code Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 26px 0;">
        <tr>
          <td align="center">
            <div style="background-color: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px 32px; display: inline-block; text-align: center;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 6px;">
                Verification Code
              </div>
              <div class="otp-code" style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: ${BRAND_ACCENT}; font-family: 'Courier New', Courier, monospace;">
                ${otp}
              </div>
              <div style="margin-top: 6px; font-size: 12px; color: #dc2626; font-weight: 600;">
                &#9201; Valid for ${expiresMinutes} minutes only
              </div>
            </div>
          </td>
        </tr>
      </table>

      <!-- Security Guidance -->
      <div style="background-color: #f8fafc; border-left: 4px solid #94a3b8; padding: 12px 16px; border-radius: 4px; font-size: 12.5px; color: #64748b;">
        <strong>Security Notice:</strong> This code is single-use and will expire in ${expiresMinutes} minutes. Never share this code with anyone. ${organizationName} staff will never request your verification code.
      </div>

      <p style="font-size: 13px; color: #94a3b8; margin-top: 22px; margin-bottom: 0;">
        If you did not request this verification, please ignore this email or contact hostel administration.
      </p>
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — EMAIL VERIFICATION CODE
========================================================================

Your verification code is: ${otp}

This code is valid for ${expiresMinutes} minutes and can only be used once.
Purpose: ${purpose}
Recipient: ${email}

SECURITY NOTICE: Never share this code with anyone.

If you did not request this verification code, please ignore this email.
${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: data.subject || `Your Verification Code: ${otp} | ${organizationName}` };
}

/**
 * 3. Login OTP Template (2FA / Secure Login)
 */
export function renderLoginOtpTemplate(data = {}) {
  const {
    otp = '',
    username = '',
    expiresMinutes = 5,
    email = '',
    ipAddress = '',
    organizationName = DEFAULT_ORG_NAME,
  } = data;

  const title = 'Hostel Portal Sign-In Verification';
  const subtitle = `${organizationName} &middot; Two-Factor Authentication`;

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: BRAND_HEADER_BG,
    accentColor: BRAND_ACCENT,
    organizationName,
    bodyContent: `
      <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
        Hello <strong>${username || 'User'}</strong>,
      </p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        A sign-in attempt was detected for your account on the ${organizationName} Trainee Hostel Management Portal.
        Please use the following One-Time Password (OTP) to complete your login:
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
        <tr>
          <td align="center">
            <div style="background-color: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px 32px; display: inline-block; text-align: center;">
              <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 6px;">
                Login One-Time Code
              </div>
              <div class="otp-code" style="font-size: 38px; font-weight: 800; letter-spacing: 8px; color: #0284c7; font-family: 'Courier New', Courier, monospace;">
                ${otp}
              </div>
              <div style="margin-top: 6px; font-size: 12px; color: #dc2626; font-weight: 600;">
                &#9201; Expires in ${expiresMinutes} minutes
              </div>
            </div>
          </td>
        </tr>
      </table>

      ${ipAddress ? `
      <p style="font-size: 12.5px; color: #64748b;">
        Request origin IP: <code style="background-color: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${ipAddress}</code>
      </p>` : ''}

      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 16px; border-radius: 4px; font-size: 12.5px; color: #991b1b; margin-top: 18px;">
        <strong>Did not attempt to sign in?</strong> If you did not initiate this login request, change your password immediately and notify the system administrator.
      </div>
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — LOGIN VERIFICATION CODE
========================================================================

Hello ${username || 'User'},

Your login verification code is: ${otp}

This code expires in ${expiresMinutes} minutes.
${ipAddress ? `Request IP: ${ipAddress}\n` : ''}
If you did not initiate this login attempt, please secure your account immediately.
${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: data.subject || `Login Verification Code: ${otp} | ${organizationName}` };
}

/**
 * 4. Forgot Password Email Template
 */
export function renderForgotPasswordTemplate(data = {}) {
  const {
    name = 'User',
    resetUrl = '',
    expiresHours = 1,
    organizationName = DEFAULT_ORG_NAME,
  } = data;

  const title = 'Reset Your Portal Password';
  const subtitle = `${organizationName} &middot; Account Security Assistance`;

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: BRAND_HEADER_BG,
    accentColor: BRAND_ACCENT,
    organizationName,
    bodyContent: `
      <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
        Dear <strong>${name}</strong>,
      </p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        We received a request to reset the password associated with your account on the ${organizationName} Trainee Hostel Management Portal.
      </p>
      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        Click the button below to choose a new, secure password. This link is single-use and will expire in <strong>${expiresHours} hour${expiresHours > 1 ? 's' : ''}</strong>:
      </p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="${resetUrl}" class="btn-cta" style="background-color: ${BRAND_ACCENT}; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; display: inline-block;">
          Reset My Password &rarr;
        </a>
      </div>

      <p style="font-size: 12.5px; color: #64748b; margin-top: 20px;">
        Button not working? Copy and paste the link below directly into your web browser:<br/>
        <a href="${resetUrl}" style="color: ${BRAND_ACCENT}; word-break: break-all;">${resetUrl}</a>
      </p>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; margin-top: 24px; font-size: 12px; color: #64748b;">
        <strong>Didn't ask for a reset?</strong> If you did not request this password reset, you can safely ignore this email. Your current password remains active and secure.
      </div>
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — PASSWORD RESET REQUEST
========================================================================

Dear ${name},

We received a request to reset your password. Use the secure link below:
${resetUrl}

This link is valid for ${expiresHours} hour(s) and can only be used once.

If you did not request this reset, your account remains secure and you can ignore this email.
${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: data.subject || `Password Reset Request | ${organizationName}` };
}

/**
 * 5. Password Reset Confirmation Template
 */
export function renderPasswordResetConfirmationTemplate(data = {}) {
  const {
    name = 'User',
    timestamp = new Date().toLocaleString(),
    loginUrl = '',
    organizationName = DEFAULT_ORG_NAME,
  } = data;

  const title = 'Password Successfully Updated';
  const subtitle = `${organizationName} &middot; Account Security Confirmation`;

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: '#15803d',
    accentColor: '#16a34a',
    organizationName,
    bodyContent: `
      <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
        Dear <strong>${name}</strong>,
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; margin: 18px 0;">
        <tr>
          <td style="padding: 16px 20px;">
            <div style="font-size: 14.5px; font-weight: 700; color: #166534; display: flex; align-items: center; gap: 8px;">
              &#10004; Your password has been changed successfully
            </div>
            <div style="font-size: 12.5px; color: #15803d; margin-top: 4px;">
              Timestamp: ${timestamp}
            </div>
          </td>
        </tr>
      </table>

      <p style="font-size: 14px; color: #475569; line-height: 1.6;">
        You can now sign in to the ${organizationName} Trainee Hostel Management Portal using your new password.
      </p>

      ${loginUrl ? `
      <div style="text-align: center; margin: 26px 0;">
        <a href="${loginUrl}" class="btn-cta" style="background-color: #16a34a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block;">
          Sign In to Portal &rarr;
        </a>
      </div>` : ''}

      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 12px 16px; margin-top: 24px; font-size: 12.5px; color: #991b1b;">
        <strong>Important Security Notice:</strong> If you did not perform this password change, please contact the Hostel Super Administrator or Warden immediately to secure your account.
      </div>
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — PASSWORD CHANGED CONFIRMATION
========================================================================

Dear ${name},

Your password for the ${organizationName} Trainee Hostel Portal was successfully changed on:
${timestamp}

If you performed this change, no further action is required.
${loginUrl ? `Sign in: ${loginUrl}\n` : ''}
SECURITY ADVISORY: If you did NOT make this change, contact hostel administration immediately.
${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: data.subject || `Security Alert: Your Password Was Changed | ${organizationName}` };
}

/**
 * 6. Hostel Application Confirmation Template
 */
export function renderHostelApplicationConfirmationTemplate(data = {}) {
  const {
    traineeName = '',
    traineeId = '',
    qrId = '',
    mobile = '',
    email = '',
    department = 'Trainee Operations',
    joiningDate = 'Immediate',
    verifyUrl = '',
    organizationName = DEFAULT_ORG_NAME,
  } = data;

  const title = 'Registration Received & Under Review';
  const subtitle = `${organizationName} &middot; Trainee Hostel Operations`;

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: BRAND_HEADER_BG,
    accentColor: BRAND_ACCENT,
    organizationName,
    bodyContent: `
      <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
        Dear <strong>${traineeName}</strong>,
      </p>
      <p style="font-size: 14px; color: #334155; line-height: 1.6;">
        Your trainee registration application for the ${organizationName} Hostel has been successfully submitted and is currently pending official review.
      </p>

      <!-- Application Summary Card -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid ${BRAND_ACCENT}; border-radius: 6px; margin: 18px 0;">
        <tr>
          <td style="padding: 16px 20px;">
            <div style="font-size: 13.5px; font-weight: 700; color: #1e1b4b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;">
              Application Summary
            </div>
            <table role="presentation" width="100%" cellpadding="4" cellspacing="0" style="font-size: 13.5px;">
              <tr><td width="40%" style="color: #64748b;"><strong>Full Name:</strong></td><td style="color: #1e293b;">${traineeName}</td></tr>
              <tr><td style="color: #64748b;"><strong>Reference ID:</strong></td><td style="color: ${BRAND_ACCENT}; font-weight: 700; font-family: monospace;">${traineeId || qrId}</td></tr>
              <tr><td style="color: #64748b;"><strong>Unique QR Identifier:</strong></td><td style="color: #1e293b; font-family: monospace;">${qrId}</td></tr>
              <tr><td style="color: #64748b;"><strong>Mobile Contact:</strong></td><td style="color: #1e293b;">${mobile || '—'}</td></tr>
              <tr><td style="color: #64748b;"><strong>Department:</strong></td><td style="color: #1e293b;">${department}</td></tr>
              <tr><td style="color: #64748b;"><strong>Scheduled Joining:</strong></td><td style="color: #1e293b;">${joiningDate}</td></tr>
              <tr><td style="color: #64748b;"><strong>Application Status:</strong></td><td style="color: #d97706; font-weight: 700;">UNDER REVIEW</td></tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Next Steps -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; margin: 20px 0;">
        <tr>
          <td style="padding: 14px 18px; font-size: 13px; color: #1e40af;">
            <strong>Next Steps in the Onboarding Process:</strong>
            <ol style="margin: 8px 0 0 0; padding-left: 20px; line-height: 1.6;">
              <li>Hostel Warden and HR Administration will inspect your submitted credentials.</li>
              <li>Your hostel block and room number will be allocated upon approval.</li>
              <li>Your official Trainee Identity Card (with printable PDF) will be delivered to this email.</li>
            </ol>
          </td>
        </tr>
      </table>

      ${verifyUrl ? `
      <div style="text-align: center; margin: 24px 0 10px 0;">
        <a href="${verifyUrl}" class="btn-cta" style="background-color: ${BRAND_ACCENT}; color: #ffffff; text-decoration: none; padding: 12px 26px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block;">
          View Online Badge &rarr;
        </a>
      </div>` : ''}
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — APPLICATION RECEIVED
========================================================================

Dear ${traineeName},

Your trainee hostel registration application has been received and is under review.

SUMMARY:
- Trainee Name     : ${traineeName}
- Reference ID     : ${traineeId || qrId}
- QR Identifier    : ${qrId}
- Contact          : ${mobile || '—'}
- Joining Date     : ${joiningDate}
- Status           : UNDER REVIEW

NEXT STEPS:
1. Warden and HR review your application.
2. Room number and hostel block allocated upon approval.
3. Official ID Card and Welcome Package delivered to this email.

${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: data.subject || `Registration Received – Application Under Review | ${organizationName}` };
}

/**
 * 7. Admin Notification & System Alert Template
 */
export function renderAdminNotificationTemplate(data = {}) {
  const {
    subject = 'Hostel Administrative Alert',
    message = '',
    type = 'SYSTEM',
    details = {},
    actorName = 'System',
    actionUrl = '',
    timestamp = new Date().toLocaleString(),
    organizationName = DEFAULT_ORG_NAME,
  } = data;

  const title = 'Hostel Administrative Notification';
  const subtitle = `${organizationName} &middot; System Alerts &amp; Operations`;

  const detailRows = Object.entries(details).map(([k, v]) => `
    <tr>
      <td width="35%" style="color: #64748b; padding: 4px 0;"><strong>${k}:</strong></td>
      <td style="color: #1e293b; padding: 4px 0;">${v}</td>
    </tr>
  `).join('');

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg: BRAND_HEADER_BG,
    accentColor: BRAND_ACCENT,
    organizationName,
    bodyContent: `
      <div style="background-color: #f8fafc; border-left: 4px solid ${BRAND_ACCENT}; padding: 14px 18px; border-radius: 4px; margin-bottom: 20px;">
        <div style="font-size: 16px; font-weight: 700; color: #1e293b; margin-bottom: 4px;">${subject}</div>
        <div style="font-size: 12px; color: #64748b;">
          Type: <span style="font-weight: 600; color: ${BRAND_ACCENT};">${type}</span> &middot; Triggered by: <strong>${actorName}</strong>
        </div>
      </div>

      <div style="font-size: 14.5px; color: #334155; line-height: 1.6; margin-bottom: 20px; white-space: pre-line;">
        ${message}
      </div>

      ${detailRows ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 16px; margin: 18px 0; font-size: 13.5px;">
        ${detailRows}
      </table>` : ''}

      ${actionUrl ? `
      <div style="text-align: center; margin: 26px 0;">
        <a href="${actionUrl}" class="btn-cta" style="background-color: ${BRAND_ACCENT}; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block;">
          Open Admin Console &rarr;
        </a>
      </div>` : ''}

      <div style="font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 12px; margin-top: 20px;">
        Timestamp: ${timestamp}
      </div>
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — ADMIN ALERT
========================================================================

Subject: ${subject}
Type: ${type}
Triggered By: ${actorName}
Time: ${timestamp}

${message}

${Object.entries(details).map(([k, v]) => `${k}: ${v}`).join('\n')}

${actionUrl ? `Access Link: ${actionUrl}\n` : ''}
${organizationName} Trainee Hostel Administration
  `.trim();

  return { html, text, subject: `[Admin Alert] ${subject}` };
}

/**
 * 8. Application Status Update Template (Approval or Rejection)
 */
export function renderApplicationStatusUpdateTemplate(data = {}) {
  const {
    traineeName = 'Trainee',
    traineeId = '',
    decision = 'APPROVED',
    rejectionReason = '',
    reviewer = 'Hostel Administrator',
    bodyText = '',
    organizationName = DEFAULT_ORG_NAME,
    loginUrl = '',
  } = data;

  const isApproved = String(decision).toUpperCase() === 'APPROVED';
  const headerBg = isApproved ? '#15803d' : '#b91c1c';
  const accentColor = isApproved ? '#16a34a' : '#dc2626';
  const badgeBg = isApproved ? '#dcfce7' : '#fee2e2';
  const badgeText = isApproved ? '#15803d' : '#b91c1c';

  const title = isApproved ? 'Registration Approved' : 'Registration Status Update';
  const subtitle = `${organizationName} &middot; Review Decision`;

  const defaultApprovedText = `Congratulations! Your hostel registration application has been reviewed and officially approved. Our hostel warden will allocate your hostel and room shortly.`;
  const defaultRejectedText = `Your hostel registration application has been reviewed and could not be approved at this time.`;

  const displayBody = bodyText || (isApproved ? defaultApprovedText : defaultRejectedText);

  const html = wrapEmailLayout({
    title,
    subtitle,
    headerBg,
    accentColor,
    organizationName,
    bodyContent: `
      <p style="font-size: 15px; color: #1e293b; margin-top: 0;">
        Dear <strong>${traineeName}</strong>,
      </p>
      <p style="font-size: 14.5px; color: #334155; line-height: 1.6;">
        ${displayBody}
      </p>

      <!-- Decision Box -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid ${accentColor}; border-radius: 6px; margin: 20px 0;">
        <tr>
          <td style="padding: 16px 20px; font-size: 13.5px;">
            <div style="margin-bottom: 8px;">
              <span style="color: #64748b;">Trainee ID:</span>
              <strong style="font-family: monospace; color: ${accentColor};">${traineeId}</strong>
            </div>
            <div style="margin-bottom: 8px;">
              <span style="color: #64748b;">Review Decision:</span>
              <span style="background-color: ${badgeBg}; color: ${badgeText}; padding: 3px 10px; border-radius: 4px; font-weight: 700; font-size: 13px;">
                ${isApproved ? 'APPROVED' : 'REJECTED'}
              </span>
            </div>
            ${!isApproved && rejectionReason ? `
            <div style="margin-bottom: 8px;">
              <span style="color: #64748b;">Reason:</span>
              <strong style="color: #dc2626;">${rejectionReason}</strong>
            </div>` : ''}
            <div>
              <span style="color: #64748b;">Reviewed By:</span>
              <strong>${reviewer}</strong>
            </div>
          </td>
        </tr>
      </table>

      ${isApproved ? `
      <p style="font-size: 13.5px; color: #475569; line-height: 1.5;">
        Upon room allocation, your official Trainee Identity Card and Welcome Package will be sent directly to this email address.
      </p>` : `
      <p style="font-size: 13.5px; color: #475569; line-height: 1.5;">
        If you have questions regarding this decision, please contact the Hostel Administration office.
      </p>`}
    `,
  });

  const text = `
========================================================================
${organizationName.toUpperCase()} — APPLICATION DECISION: ${decision}
========================================================================

Dear ${traineeName},

${displayBody}

DECISION SUMMARY:
- Trainee ID    : ${traineeId}
- Decision      : ${decision}
${!isApproved && rejectionReason ? `- Reason        : ${rejectionReason}\n` : ''}- Reviewer      : ${reviewer}

${organizationName} Trainee Hostel Administration
  `.trim();

  const subject = isApproved
    ? `Hostel Registration Approved | ${organizationName} (${traineeName})`
    : `Hostel Registration Status Update | ${organizationName} (${traineeName})`;

  return { html, text, subject: data.subject || subject };
}
