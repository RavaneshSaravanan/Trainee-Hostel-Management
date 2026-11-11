import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import QRCode from 'qrcode';
import {
  sendEmail,
  sendRegistrationOtpEmail,
  sendApprovalRequestEmail,
  sendDecisionNotificationEmail,
  renderDecisionEmailContent,
  sendTraineeWelcomeEmail,
  sendTraineeIdCardEmail,
  generateIdCardPdf,
  sendLeaveNotificationEmail,
  sendOutingNotificationEmail,
  sendAdminAlertEmail,
  isGmailConfigured,
  verifyGmailConnection,
  getGmailConfigStatus,
  getAdminNotificationEmail,
  replaceDynamicPlaceholders,
} from './services/emailService.js';

import {
  buildRawMimeMessage,
  scrubSensitive,
  sendMailViaGmail,
  setMockGmailClient,
  resetGmailClient,
} from './services/gmailService.js';

import { NotificationLog } from './models/NotificationLog.js';
import { EmailLog } from './models/EmailLog.js';
import { Trainee } from './models/Trainee.js';
import { connectDB, closeDB } from './config/db.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`✅ PASSED: ${message}`);
}

async function runEmailTestSuite() {
  console.log('\n======================================================');
  console.log('   STARTING GMAIL API & EMAIL WORKFLOW TEST SUITE     ');
  console.log('======================================================\n');

  await connectDB();

  // Clean logs before running tests
  await NotificationLog.deleteMany({ 'metadata.testSuite': 'GMAIL_MIGRATION' });
  await EmailLog.deleteMany({ 'metadata.testSuite': 'GMAIL_MIGRATION' });

  // ---------------- TEST 1: Gmail Configuration & Status ----------------
  console.log('\n[TEST 1] Testing Gmail API Configuration Check & Status...');
  const configStatus = getGmailConfigStatus();
  assert(typeof configStatus.configured === 'boolean', 'getGmailConfigStatus returns boolean configured flag');
  assert(configStatus.user.includes('@'), `Configured Gmail user email: ${configStatus.user}`);
  assert(!JSON.stringify(configStatus).includes('secret'), 'Config status does not expose secrets');

  const connectionCheck = await verifyGmailConnection();
  assert(typeof connectionCheck.ok === 'boolean', 'verifyGmailConnection returns ok boolean status');
  console.log(`Gmail API Status: ${connectionCheck.status} (ok: ${connectionCheck.ok})`);

  // ---------------- TEST 2: Sensitive Information Scrubbing ----------------
  console.log('\n[TEST 2] Testing Sensitive Information Scrubber...');
  const originalSecret = process.env.GMAIL_CLIENT_SECRET;
  const testString = 'Error connecting with token ya29.a0AfH6SM... and secret mySuperSecret12345';
  process.env.GMAIL_CLIENT_SECRET = 'mySuperSecret12345';
  const scrubbed = scrubSensitive(testString);
  assert(!scrubbed.includes('mySuperSecret12345'), 'Scrubber redacts GMAIL_CLIENT_SECRET');
  assert(!scrubbed.includes('ya29.a0AfH6SM'), 'Scrubber redacts OAuth access token patterns');
  process.env.GMAIL_CLIENT_SECRET = originalSecret;

  // ---------------- TEST 3: RFC 2822 MIME Message Construction & Base64URL ----------------
  console.log('\n[TEST 3] Testing Raw MIME Generation & Base64URL Encoding...');
  const testPdfBuf = Buffer.from('%PDF-1.4\n%Test PDF binary stream\n%%EOF');
  const mimeResult = await buildRawMimeMessage({
    from: 'Apollo Tyres Ltd <apollotyres.hostel@gmail.com>',
    to: ['trainee1@gmail.com'],
    cc: ['warden@gmail.com'],
    bcc: ['audit@gmail.com'],
    subject: 'Welcome to Hostel',
    text: 'Hello Trainee, welcome!',
    html: '<h3>Hello Trainee</h3><p>Welcome to Apollo Tyres!</p>',
    attachments: [
      {
        filename: 'Trainee-ID-Card.pdf',
        content: testPdfBuf,
        contentType: 'application/pdf',
      },
    ],
  });

  assert(Boolean(mimeResult.raw), 'MIME builder returns non-empty base64url raw string');
  assert(!mimeResult.raw.includes('+'), 'Raw string has no plus signs (Base64URL safe)');
  assert(!mimeResult.raw.includes('/'), 'Raw string has no slashes (Base64URL safe)');
  assert(!mimeResult.raw.includes('='), 'Raw string has no padding equals signs (Base64URL safe)');
  assert(mimeResult.buffer.length > 0, 'Buffer contains compiled RFC 2822 payload');
  const mimeHeaderSample = mimeResult.buffer.slice(0, 400).toString('utf8');
  assert(mimeHeaderSample.includes('Content-Type: multipart/mixed'), 'MIME contains multipart/mixed for attachments');
  assert(mimeHeaderSample.includes('To: trainee1@gmail.com'), 'MIME contains correct To recipient');
  assert(mimeHeaderSample.includes('Cc: warden@gmail.com'), 'MIME contains correct Cc recipient');

  // ---------------- TEST 4: Registration OTP Email ----------------
  console.log('\n[TEST 4] Testing Registration OTP Email Dispatch...');
  setMockGmailClient({
    users: {
      messages: {
        send: async ({ userId, requestBody }) => {
          return {
            status: 200,
            data: {
              id: 'test-mock-msg-' + Date.now(),
              threadId: 'test-thread-id',
              labelIds: ['SENT'],
            },
          };
        },
      },
    },
  });
  const otpRes = await sendRegistrationOtpEmail({
    email: 'new.trainee@gmail.com',
    otp: '4829',
  });
  assert(otpRes.ok === true, 'sendRegistrationOtpEmail returned ok status');
  const otpLog = await EmailLog.findOne({ recipient: 'new.trainee@gmail.com', emailType: 'OTP' }).sort({ createdAt: -1 });
  assert(Boolean(otpLog), 'EmailLog entry created for Registration OTP');
  assert(otpLog.content.includes('4829'), 'EmailLog contains 4-digit OTP code');

  // ---------------- TEST 5: Approver Review Request Email ----------------
  console.log('\n[TEST 5] Testing Approver Registration Review Request Email...');
  const sampleTrainee = {
    traineeId: 'TRN-TEST-101',
    qrId: 'QR-TEST-101',
    name: 'Rahul Sharma',
    mobile: '9876543210',
    email: 'rahul.sharma@gmail.com',
    gender: 'Male',
    qualification: 'Diploma Mechanical',
    aadhar: '123456789012',
    joiningDate: '2026-11-01',
    guardianName: 'Suresh Sharma',
    guardianContact: '9876543211',
    hostel: 'Block A - Boy Hostel',
    roomNo: '102',
    approvalStatus: 'PENDING',
  };

  const approverUser = {
    userId: 'superadmin',
    name: 'Hostel Super Admin',
    username: 'superadmin',
    email: 'apollotyres.hostel@gmail.com',
  };

  const reviewRes = await sendApprovalRequestEmail({
    approver: approverUser,
    trainee: sampleTrainee,
  });
  assert(reviewRes.ok === true, 'sendApprovalRequestEmail returned ok');
  const reviewLog = await EmailLog.findOne({ emailType: 'APPROVAL_REQUEST' }).sort({ createdAt: -1 });
  assert(Boolean(reviewLog), 'EmailLog entry created for APPROVAL_REQUEST');
  assert(reviewLog.content.includes('#/review/'), 'Review email content contains secure tokenized review link');
  assert(reviewLog.content.includes('Rahul Sharma'), 'Review email content contains trainee name');

  // ---------------- TEST 6: Decision Notification Emails (Approved & Rejected) ----------------
  console.log('\n[TEST 6] Testing Approval & Rejection Decision Emails...');
  const approvedContent = renderDecisionEmailContent({
    decision: 'APPROVED',
    trainee: sampleTrainee,
    actorName: 'Hostel Administrator',
  });
  assert(approvedContent.decision === 'APPROVED', 'Decision is APPROVED');
  assert(approvedContent.bannerBg === '#16a34a', 'Approval email has green banner #16a34a');
  assert(approvedContent.heading.includes('APPROVED'), 'Approval email heading includes APPROVED');

  const rejectedContent = renderDecisionEmailContent({
    decision: 'REJECTED',
    trainee: sampleTrainee,
    actorName: 'Hostel Administrator',
    rejectionReason: 'Invalid Aadhaar documentation provided',
  });
  assert(rejectedContent.decision === 'REJECTED', 'Decision is REJECTED');
  assert(rejectedContent.bannerBg === '#dc2626', 'Rejection email has red banner #dc2626');
  assert(rejectedContent.text.includes('Invalid Aadhaar documentation provided'), 'Rejection text contains reason');

  const approvedDispatch = await sendDecisionNotificationEmail({
    trainee: sampleTrainee,
    decision: 'APPROVED',
    actorName: 'Super Admin',
  });
  assert(approvedDispatch.ok === true, 'sendDecisionNotificationEmail (Approved) dispatched successfully');

  const rejectedDispatch = await sendDecisionNotificationEmail({
    trainee: sampleTrainee,
    decision: 'REJECTED',
    rejectionReason: 'Document mismatch',
    actorName: 'Super Admin',
  });
  assert(rejectedDispatch.ok === true, 'sendDecisionNotificationEmail (Rejected) dispatched successfully');

  // ---------------- TEST 7: ID Card PDF Generation with Photo & QR Code ----------------
  console.log('\n[TEST 7] Testing CR80 ID Card PDF Generation...');
  const qrBuf = await QRCode.toBuffer('https://trainee-hostel.example.com/#/verify/QR-TEST-101', {
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 280,
  });

  const samplePhotoDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const traineeWithPhoto = {
    ...sampleTrainee,
    photo: samplePhotoDataUrl,
  };

  const idCardPdf = await generateIdCardPdf({
    trainee: traineeWithPhoto,
    qrBuffer: qrBuf,
    verifyUrl: 'https://trainee-hostel.example.com/#/verify/QR-TEST-101',
    branding: { orgName: 'APOLLO TYRES LTD' },
  });

  assert(Buffer.isBuffer(idCardPdf), 'generateIdCardPdf returns a Buffer');
  assert(idCardPdf.length > 500, `Generated PDF buffer is non-trivial (${idCardPdf.length} bytes)`);
  assert(idCardPdf.slice(0, 4).toString('ascii') === '%PDF', 'Generated PDF has valid %PDF magic header');

  // ---------------- TEST 8: Trainee ID Card Email Delivery ----------------
  console.log('\n[TEST 8] Testing Trainee ID Card Email Delivery with Attachments...');
  const approvedTrainee = {
    ...sampleTrainee,
    approvalStatus: 'APPROVED',
    hostelStatus: 'ACTIVE',
  };

  const idCardRes = await sendTraineeIdCardEmail({
    trainee: approvedTrainee,
    force: true,
  });
  assert(idCardRes.ok === true, 'sendTraineeIdCardEmail returned ok');
  const idCardEmailLog = await EmailLog.findOne({ emailType: 'ID_CARD', recipient: sampleTrainee.email }).sort({ createdAt: -1 });
  assert(Boolean(idCardEmailLog), 'EmailLog entry exists for ID_CARD');
  assert(idCardEmailLog.metadata?.hasPdfAttachment === true, 'EmailLog confirms PDF attachment is present');
  assert(idCardEmailLog.content.includes('data:image/png;base64,'), 'HTML body has inline high-res QR code badge');

  // ---------------- TEST 9: Trainee Welcome Email Delivery ----------------
  console.log('\n[TEST 9] Testing Trainee Welcome Email with 3 Calendar Months Calculation...');
  const welcomeRes = await sendTraineeWelcomeEmail({
    trainee: approvedTrainee,
    force: true,
    triggeredBy: 'Test Suite',
  });
  assert(welcomeRes.ok === true, 'sendTraineeWelcomeEmail returned ok');
  const welcomeLog = await EmailLog.findOne({ emailType: 'WELCOME', recipient: sampleTrainee.email }).sort({ createdAt: -1 });
  assert(Boolean(welcomeLog), 'EmailLog entry exists for WELCOME');
  assert(welcomeLog.content.includes('Free Accommodation Validity'), 'Welcome email specifies free validity');
  assert(welcomeLog.content.includes('3 Calendar Months'), 'Welcome email specifies 3 Calendar Months period');

  // ---------------- TEST 10: Leave Notification Email ----------------
  console.log('\n[TEST 10] Testing Leave Notification Email (Departure & Return)...');
  const sampleLeave = {
    id: 'LV-0001',
    leaveType: 'Emergency Family Leave',
    outDate: '2026-11-12',
    outTime: '09:00 AM',
    expectedInDate: '2026-11-15',
    inDate: '2026-11-15',
    inTime: '06:00 PM',
    reason: 'Family function at hometown',
  };

  const leaveOutRes = await sendLeaveNotificationEmail({
    trainee: approvedTrainee,
    leave: sampleLeave,
    action: 'DEPARTURE',
    actorName: 'Warden John Doe',
  });
  assert(leaveOutRes.ok === true, 'sendLeaveNotificationEmail (DEPARTURE) returned ok');

  const leaveInRes = await sendLeaveNotificationEmail({
    trainee: approvedTrainee,
    leave: sampleLeave,
    action: 'RETURN',
    actorName: 'Warden John Doe',
  });
  assert(leaveInRes.ok === true, 'sendLeaveNotificationEmail (RETURN) returned ok');

  const leaveLog = await EmailLog.findOne({ emailType: 'LEAVE', recipient: sampleTrainee.email }).sort({ createdAt: -1 });
  assert(Boolean(leaveLog), 'EmailLog entry exists for LEAVE');
  assert(leaveLog.content.includes('Emergency Family Leave'), 'Leave email contains leave type');
  assert(leaveLog.content.includes('Warden John Doe'), 'Leave email contains recorded by');

  // ---------------- TEST 11: Outing Notification Email ----------------
  console.log('\n[TEST 11] Testing Outing Notification Email (Departure & Return)...');
  const sampleOuting = {
    id: 'OV-0001',
    outDate: '2026-11-11',
    outTime: '05:30 PM',
    expectedInTime: '09:00 PM',
    inDate: '2026-11-11',
    inTime: '08:45 PM',
    purpose: 'City Market visit for personal items',
  };

  const outingOutRes = await sendOutingNotificationEmail({
    trainee: approvedTrainee,
    outing: sampleOuting,
    action: 'DEPARTURE',
    actorName: 'Hostel Security In-Charge',
  });
  assert(outingOutRes.ok === true, 'sendOutingNotificationEmail (DEPARTURE) returned ok');

  const outingInRes = await sendOutingNotificationEmail({
    trainee: approvedTrainee,
    outing: sampleOuting,
    action: 'RETURN',
    actorName: 'Hostel Security In-Charge',
  });
  assert(outingInRes.ok === true, 'sendOutingNotificationEmail (RETURN) returned ok');

  const outingLog = await EmailLog.findOne({ emailType: 'OUTING', recipient: sampleTrainee.email }).sort({ createdAt: -1 });
  assert(Boolean(outingLog), 'EmailLog entry exists for OUTING');
  assert(outingLog.content.includes('City Market visit'), 'Outing email contains purpose');

  // ---------------- TEST 12: Admin Notification & Alert Email ----------------
  console.log('\n[TEST 12] Testing Admin Alert Email...');
  const adminAlertRes = await sendAdminAlertEmail({
    subject: 'Room Capacity Reached in Block A',
    message: 'Block A room 102 has reached maximum occupancy of 3 beds. Please verify remaining available inventory.',
    actorName: 'Hostel Allocation Service',
  });
  assert(adminAlertRes.ok === true, 'sendAdminAlertEmail returned ok');
  const adminEmail = await getAdminNotificationEmail();
  const alertLog = await EmailLog.findOne({ emailType: 'SYSTEM', recipient: adminEmail }).sort({ createdAt: -1 });
  assert(Boolean(alertLog), 'EmailLog entry exists for Admin Alert');
  assert(alertLog.subject.includes('[Hostel Admin Alert] Room Capacity Reached'), 'Subject properly formatted');

  // ---------------- TEST 13: Unconfigured Safe Error Handling ----------------
  console.log('\n[TEST 13] Testing Unconfigured Gmail Client Safe Handling...');
  resetGmailClient();
  const tempSecret = process.env.GMAIL_CLIENT_SECRET;
  delete process.env.GMAIL_CLIENT_SECRET;
  const unconfiguredRes = await sendMailViaGmail({
    from: 'Test <apollotyres.hostel@gmail.com>',
    to: 'dup-test@gmail.com',
    subject: 'Unconfigured Test Subject',
    text: 'Body text',
    emailType: 'TEST_UNCONFIGURED',
  });
  assert(unconfiguredRes.ok === false, 'sendMailViaGmail returns ok: false when unconfigured');
  assert(unconfiguredRes.status === 'NOT_CONFIGURED', 'sendMailViaGmail returns status: NOT_CONFIGURED without throwing');
  process.env.GMAIL_CLIENT_SECRET = tempSecret;
  resetGmailClient();

  // ---------------- TEST 14: Gmail API Dispatch & Duplicate Suppression ----------------
  console.log('\n[TEST 14] Testing Live Dispatch & Duplicate Suppression with Mock Client...');
  let apiCallCount = 0;
  setMockGmailClient({
    users: {
      messages: {
        send: async ({ userId, requestBody }) => {
          apiCallCount++;
          assert(userId === 'me', 'Gmail send API called with userId: me');
          assert(Boolean(requestBody?.raw), 'Gmail send API called with non-empty raw RFC 2822 base64url payload');
          return {
            status: 200,
            data: {
              id: 'gmail-msg-id-7890',
              threadId: 'gmail-thread-7890',
              labelIds: ['SENT'],
            },
          };
        },
      },
    },
  });

  const send1 = await sendMailViaGmail({
    from: 'Apollo Tyres <apollotyres.hostel@gmail.com>',
    to: 'rahul.dup@gmail.com',
    subject: 'Duplicate Test Subject',
    text: 'Body text',
    emailType: 'TEST_DUP',
    traineeId: 'TRN-DUP-01',
    force: false,
  });

  assert(send1.ok === true, 'First dispatch through mock Gmail API succeeded');
  assert(send1.messageId === 'gmail-msg-id-7890', 'Recorded Gmail messageId: gmail-msg-id-7890');
  assert(apiCallCount === 1, 'Gmail API invoked exactly once for first call');

  const send2 = await sendMailViaGmail({
    from: 'Apollo Tyres <apollotyres.hostel@gmail.com>',
    to: 'rahul.dup@gmail.com',
    subject: 'Duplicate Test Subject',
    text: 'Body text',
    emailType: 'TEST_DUP',
    traineeId: 'TRN-DUP-01',
    force: false,
  });

  assert(send2.ok === true, 'Second dispatch returned ok');
  assert(send2.duplicatePrevented === true || send2.status === 'DEDUPLICATED', 'Second identical dispatch suppressed within 30s');
  assert(apiCallCount === 1, 'Gmail API NOT invoked again; duplicate successfully suppressed');

  // Cleanup mock client
  setMockGmailClient(null);

  console.log('\n======================================================');
  console.log(`  ALL ${totalTests} TESTS PASSED SUCCESSFULLY! (${passedTests}/${totalTests})`);
  console.log('======================================================\n');

  await closeDB();
  process.exit(0);
}

runEmailTestSuite().catch(async (err) => {
  console.error('\n❌ TEST SUITE FAILED WITH ERROR:', err);
  await closeDB();
  process.exit(1);
});
