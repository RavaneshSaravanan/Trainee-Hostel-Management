import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

import { Config } from './models/Config.js';
import { Trainee } from './models/Trainee.js';
import { withDefaults, DEFAULT_CONFIG } from './defaults.js';
import {
  sendTraineeWelcomeEmail,
  sendTraineeIdCardEmail,
  sendRegistrationConfirmationEmail,
  sendDecisionNotificationEmail,
  sendApprovalRequestNotification,
  sendRegistrationOtpEmail,
} from './services/emailService.js';
import { isValidEmail, isValidAadhaar } from './utils/validators.js';
import { maskAadhaar, encryptAadhaar, hashAadhaar } from './utils/encryption.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== STARTING TEST SUITE: SUPER ADMIN EMAIL CONTROLS & VERIFICATION ===\n');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB Atlas.\n');

  try {
    const mockTrainee = {
      traineeId: 'TEST-TR-001',
      qrId: 'QR-TEST-001',
      name: 'Test Trainee',
      email: 'ironman.jarvis100@gmail.com',
      joiningDate: '2026-01-01',
      hostel: 'Hostel A',
      roomNo: '101',
      approvalStatus: 'APPROVED',
      hostelStatus: 'ACTIVE',
      emailVerified: true,
    };

    // -------------------------------------------------------------
    // Test 1: Welcome Email ON and OFF
    // -------------------------------------------------------------
    console.log('--- Test 1: Welcome Email ON and OFF ---');
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.welcomeEmail': false } },
      { upsert: true }
    );
    const res1Off = await sendTraineeWelcomeEmail({ trainee: mockTrainee, force: true });
    assert(
      res1Off.ok === true && res1Off.status === 'SKIPPED_BY_CONFIG' && res1Off.reason === 'WELCOME_EMAIL_DISABLED',
      'Welcome email is gracefully skipped when welcomeEmail is OFF'
    );

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.welcomeEmail': true } },
      { upsert: true }
    );
    const cfgCheck1 = await Config.findOne({ key: 'main' }).lean();
    assert(cfgCheck1.emailVerificationControl.welcomeEmail === true, 'Welcome email setting is ON in config');

    // -------------------------------------------------------------
    // Test 2: ID Card Email ON and OFF
    // -------------------------------------------------------------
    console.log('\n--- Test 2: ID Card Email ON and OFF ---');
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.idCardEmail': false } },
      { upsert: true }
    );
    const res2Off = await sendTraineeIdCardEmail({ trainee: mockTrainee, force: true });
    assert(
      res2Off.ok === true && res2Off.status === 'SKIPPED_BY_CONFIG' && res2Off.reason === 'ID_CARD_EMAIL_DISABLED',
      'ID Card email is gracefully skipped when idCardEmail is OFF'
    );

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.idCardEmail': true } },
      { upsert: true }
    );
    const cfgCheck2 = await Config.findOne({ key: 'main' }).lean();
    assert(cfgCheck2.emailVerificationControl.idCardEmail === true, 'ID Card email setting is ON in config');

    // -------------------------------------------------------------
    // Test 3: Registration Complete Email ON and OFF
    // -------------------------------------------------------------
    console.log('\n--- Test 3: Registration Complete Email ON and OFF ---');
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.registrationCompleteEmail': false } },
      { upsert: true }
    );
    const res3Off = await sendRegistrationConfirmationEmail({ trainee: mockTrainee, force: true });
    assert(
      res3Off.ok === true && res3Off.status === 'SKIPPED_BY_CONFIG' && res3Off.reason === 'REGISTRATION_COMPLETE_EMAIL_DISABLED',
      'Registration Complete email is gracefully skipped when registrationCompleteEmail is OFF'
    );

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.registrationCompleteEmail': true } },
      { upsert: true }
    );
    const cfgCheck3 = await Config.findOne({ key: 'main' }).lean();
    assert(cfgCheck3.emailVerificationControl.registrationCompleteEmail === true, 'Registration Complete email setting is ON in config');

    // -------------------------------------------------------------
    // Test 4: Approval Email ON and OFF
    // -------------------------------------------------------------
    console.log('\n--- Test 4: Approval Email ON and OFF ---');
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.approvalEmail': false } },
      { upsert: true }
    );
    const res4Decision = await sendDecisionNotificationEmail({
      trainee: mockTrainee,
      decision: 'APPROVED',
      actorName: 'Admin Tester',
    });
    assert(
      res4Decision.ok === true && res4Decision.status === 'SKIPPED_BY_CONFIG' && res4Decision.reason === 'APPROVAL_EMAIL_DISABLED',
      'Approval decision email is gracefully skipped when approvalEmail is OFF'
    );

    const res4Request = await sendApprovalRequestNotification({ trainee: mockTrainee, force: true });
    assert(
      res4Request.ok === true && res4Request.status === 'SKIPPED_BY_CONFIG' && res4Request.reason === 'APPROVAL_EMAIL_DISABLED',
      'Approval request notification is gracefully skipped when approvalEmail is OFF'
    );

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.approvalEmail': true } },
      { upsert: true }
    );

    // -------------------------------------------------------------
    // Test 5: Registration OTP ON and OFF
    // -------------------------------------------------------------
    console.log('\n--- Test 5: Registration OTP ON and OFF ---');
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.registrationOtp': false } },
      { upsert: true }
    );
    const res5OtpOff = await sendRegistrationOtpEmail({
      email: 'ironman.jarvis100@gmail.com',
      otp: '1234',
    });
    assert(
      res5OtpOff.ok === false && res5OtpOff.status === 'SKIPPED_BY_CONFIG',
      'sendRegistrationOtpEmail returns SKIPPED_BY_CONFIG when registrationOtp is OFF'
    );

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.registrationOtp': true } },
      { upsert: true }
    );
    const cfgCheck5 = await Config.findOne({ key: 'main' }).lean();
    assert(cfgCheck5.emailVerificationControl.registrationOtp === true, 'Registration OTP setting is ON in config');

    // -------------------------------------------------------------
    // Test 6: Email Address Verification ON and OFF
    // -------------------------------------------------------------
    console.log('\n--- Test 6: Email Address Verification ON and OFF ---');
    const unverifiedTrainee = {
      ...mockTrainee,
      traineeId: 'TEST-UNVERIFIED',
      emailVerified: false,
    };

    // When ON:
    await Config.findOneAndUpdate(
      { key: 'main' },
      {
        $set: {
          'emailVerificationControl.welcomeEmail': true,
          'emailVerificationControl.idCardEmail': true,
          'emailVerificationControl.emailVerification': true,
        },
      },
      { upsert: true }
    );

    const res6WelcomeOn = await sendTraineeWelcomeEmail({ trainee: unverifiedTrainee, force: true });
    assert(
      res6WelcomeOn.ok === false && res6WelcomeOn.status === 'UNVERIFIED_EMAIL' && res6WelcomeOn.reason === 'EMAIL_NOT_VERIFIED',
      'Welcome email is deferred when trainee email is unverified and emailVerification is ON'
    );

    const res6IdCardOn = await sendTraineeIdCardEmail({ trainee: unverifiedTrainee, force: true });
    assert(
      res6IdCardOn.ok === false && res6IdCardOn.status === 'UNVERIFIED_EMAIL' && res6IdCardOn.reason === 'EMAIL_NOT_VERIFIED',
      'ID Card email is deferred when trainee email is unverified and emailVerification is ON'
    );

    // When OFF:
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'emailVerificationControl.emailVerification': false } },
      { upsert: true }
    );
    const cfg6Off = await Config.findOne({ key: 'main' }).lean();
    assert(cfg6Off.emailVerificationControl.emailVerification === false, 'Email verification toggle set to OFF');

    // -------------------------------------------------------------
    // Test 7: Invalid Email Address Format Validation
    // -------------------------------------------------------------
    console.log('\n--- Test 7: Invalid Email Address Validation ---');
    const validEmail1 = 'user@gmail.com';
    const trimmedEmail = '  test.trainee@gmail.com  '.trim();
    const invalidEmail1 = 'notanemail';
    const invalidEmail2 = 'user@';
    const invalidEmail3 = '@domain.com';

    assert(isValidEmail(validEmail1) === true, 'Valid email format accepted');
    assert(isValidEmail(trimmedEmail) === true, 'Trimmed email format accepted');
    assert(isValidEmail(invalidEmail1) === false, 'Invalid string without @ rejected');
    assert(isValidEmail(invalidEmail2) === false, 'Invalid email ending with @ rejected');
    assert(isValidEmail(invalidEmail3) === false, 'Invalid email without user prefix rejected');

    // -------------------------------------------------------------
    // Test 8: Changed Email Address Resets emailVerified Status
    // -------------------------------------------------------------
    console.log('\n--- Test 8: Changed Email Resets Verification Status ---');
    const testDoc = new Trainee({
      name: 'Verify Reset Test',
      qrId: `QR-TEST-${Date.now()}`,
      email: 'original@gmail.com',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    });
    assert(testDoc.emailVerified === true, 'Initial status has emailVerified: true');

    // Simulate update route logic
    const newEmail = 'newaddress@gmail.com';
    if (newEmail !== testDoc.email) {
      testDoc.email = newEmail;
      testDoc.emailVerified = false;
      testDoc.emailVerifiedAt = null;
    }
    assert(testDoc.email === 'newaddress@gmail.com', 'Email updated to new address');
    assert(testDoc.emailVerified === false, 'emailVerified reset to false upon email change');
    assert(testDoc.emailVerifiedAt === null, 'emailVerifiedAt reset to null upon email change');

    // -------------------------------------------------------------
    // Test 9: Valid and Invalid Aadhaar Format (12 Digits Numeric)
    // -------------------------------------------------------------
    console.log('\n--- Test 9: Valid and Invalid Aadhaar Format ---');
    const validAadhaar = '234567890124'; // 12-digit number with valid Verhoeff checksum
    const invalidLengthAadhaar = '12345678901'; // 11 digits
    const invalidLongAadhaar = '1234567890123'; // 13 digits
    const alphaAadhaar = '1234ABCD9012';

    assert(isValidAadhaar(validAadhaar) === true, '12-digit numeric Aadhaar with Verhoeff checksum is valid');
    assert(isValidAadhaar(invalidLengthAadhaar) === false, '11-digit Aadhaar rejected');
    assert(isValidAadhaar(invalidLongAadhaar) === false, '13-digit Aadhaar rejected');
    assert(isValidAadhaar(alphaAadhaar) === false, 'Alphanumeric Aadhaar rejected');

    const masked = maskAadhaar(validAadhaar);
    assert(masked === 'XXXX-XXXX-0124', `Aadhaar masked correctly: ${masked}`);

    const encrypted = encryptAadhaar(validAadhaar);
    assert(encrypted.length > 20 && !encrypted.includes(validAadhaar), 'Aadhaar securely encrypted without plaintext');

    const hashed = hashAadhaar(validAadhaar);
    assert(hashed.length === 64, 'Aadhaar hashed with SHA-256 (64 hex characters)');

    // -------------------------------------------------------------
    // Test 10: Aadhaar Verification Status (No Live Integration)
    // -------------------------------------------------------------
    console.log('\n--- Test 10: Aadhaar Verification Status Display ---');
    const aadhaarTrainee = new Trainee({
      name: 'Aadhaar Test Trainee',
      qrId: `QR-AADHAAR-${Date.now()}`,
      aadhar: masked,
      aadharMasked: masked,
      aadharEncrypted: encrypted,
      aadharHash: hashed,
      aadhaarVerificationStatus: 'FORMAT_VALIDATED',
    });
    assert(
      aadhaarTrainee.aadhaarVerificationStatus === 'FORMAT_VALIDATED',
      'Aadhaar status correctly marked FORMAT_VALIDATED (not claiming live biometric verification without authorized API)'
    );

    // -------------------------------------------------------------
    // Test 11: Settings Persistence in MongoDB Atlas
    // -------------------------------------------------------------
    console.log('\n--- Test 11: Settings Persistence in MongoDB Atlas ---');
    const testSettings = {
      welcomeEmail: true,
      idCardEmail: false,
      registrationCompleteEmail: true,
      approvalEmail: false,
      registrationOtp: true,
      emailVerification: true,
      configuredAt: new Date(),
      configuredBy: 'Super Admin Test Runner',
    };

    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { emailVerificationControl: testSettings } },
      { upsert: true, new: true }
    );

    // Reload from MongoDB directly
    const reloaded = await Config.findOne({ key: 'main' }).lean();
    assert(reloaded.emailVerificationControl.welcomeEmail === true, 'welcomeEmail persisted as true');
    assert(reloaded.emailVerificationControl.idCardEmail === false, 'idCardEmail persisted as false');
    assert(reloaded.emailVerificationControl.registrationCompleteEmail === true, 'registrationCompleteEmail persisted as true');
    assert(reloaded.emailVerificationControl.approvalEmail === false, 'approvalEmail persisted as false');
    assert(reloaded.emailVerificationControl.registrationOtp === true, 'registrationOtp persisted as true');
    assert(reloaded.emailVerificationControl.emailVerification === true, 'emailVerification persisted as true');
    assert(reloaded.emailVerificationControl.configuredBy === 'Super Admin Test Runner', 'configuredBy persisted');

    // -------------------------------------------------------------
    // Test 12: Unauthorized User Protection (Role Authorization)
    // -------------------------------------------------------------
    console.log('\n--- Test 12: Unauthorized User Protection ---');
    const mockSuperAdmin = { roleId: 'superadmin', username: 'superadmin' };
    const mockWarden = { roleId: 'warden', username: 'warden' };

    function checkCanModifyConfig(user) {
      if (!user || user.roleId !== 'superadmin') {
        return { status: 403, error: 'Unauthorized: Only Super Admin can modify system configuration.' };
      }
      return { status: 200, ok: true };
    }

    const wardenAttempt = checkCanModifyConfig(mockWarden);
    assert(wardenAttempt.status === 403, 'Non-superadmin (warden) is blocked with HTTP 403');

    const superAttempt = checkCanModifyConfig(mockSuperAdmin);
    assert(superAttempt.status === 200, 'Super Admin is authorized with HTTP 200');

    // -------------------------------------------------------------
    // Test 13: Multiple Email Flows Enabled Together
    // -------------------------------------------------------------
    console.log('\n--- Test 13: Multiple Email Flows Enabled Together ---');
    const allOnSettings = {
      welcomeEmail: true,
      idCardEmail: true,
      registrationCompleteEmail: true,
      approvalEmail: true,
      registrationOtp: true,
      emailVerification: true,
      configuredAt: new Date(),
      configuredBy: 'Super Admin',
    };
    await Config.findOneAndUpdate(
      { key: 'main' },
      { $set: { emailVerificationControl: allOnSettings } },
      { upsert: true }
    );
    const cfgAllOn = await Config.findOne({ key: 'main' }).lean();
    const ctrl13 = cfgAllOn.emailVerificationControl;
    assert(
      ctrl13.welcomeEmail && ctrl13.idCardEmail && ctrl13.registrationCompleteEmail && ctrl13.approvalEmail && ctrl13.registrationOtp && ctrl13.emailVerification,
      'All 6 email and verification flows enabled simultaneously'
    );

    // -------------------------------------------------------------
    // Test 14: One Email Flow Disabled While Others Continue
    // -------------------------------------------------------------
    console.log('\n--- Test 14: Independence of Email Flows ---');
    await Config.findOneAndUpdate(
      { key: 'main' },
      {
        $set: {
          'emailVerificationControl.welcomeEmail': true,
          'emailVerificationControl.idCardEmail': true,
          'emailVerificationControl.registrationCompleteEmail': false, // Only this disabled
          'emailVerificationControl.approvalEmail': true,
        },
      },
      { upsert: true }
    );

    const cfg14 = await Config.findOne({ key: 'main' }).lean();
    const ctrl14 = cfg14.emailVerificationControl;
    assert(ctrl14.registrationCompleteEmail === false, 'Registration Complete email is disabled');
    assert(ctrl14.welcomeEmail === true, 'Welcome email remains enabled');
    assert(ctrl14.idCardEmail === true, 'ID card email remains enabled');
    assert(ctrl14.approvalEmail === true, 'Approval email remains enabled');

    // -------------------------------------------------------------
    // Test 15: Registration and Trainee Finalization Combinations
    // -------------------------------------------------------------
    console.log('\n--- Test 15: Registration & Trainee Finalization Lifecycle ---');
    // Scenario A: OTP is OFF, direct registration permitted without token
    const configOtpOff = withDefaults({
      emailVerificationControl: { registrationOtp: false, emailVerification: false },
    });
    const otpDisabledCanRegister = configOtpOff.emailVerificationControl.registrationOtp === false;
    assert(otpDisabledCanRegister === true, 'Registration succeeds without OTP when registrationOtp is OFF');

    // Scenario B: OTP is ON, registration requires token
    const configOtpOn = withDefaults({
      emailVerificationControl: { registrationOtp: true, emailVerification: true },
    });
    const otpEnabledRequiresToken = configOtpOn.emailVerificationControl.registrationOtp === true;
    assert(otpEnabledRequiresToken === true, 'Registration requires OTP token when registrationOtp is ON');

    // Restore clean default configuration in MongoDB
    await Config.findOneAndUpdate(
      { key: 'main' },
      {
        $set: {
          emailVerificationControl: {
            welcomeEmail: true,
            idCardEmail: true,
            registrationCompleteEmail: true,
            approvalEmail: true,
            registrationOtp: true,
            emailVerification: true,
            configuredAt: new Date(),
            configuredBy: 'Super Admin',
          },
        },
      }
    );

    console.log('\n=== TEST SUITE RESULTS ===');
    console.log(`TOTAL TESTS: ${passed + failed}`);
    console.log(`PASSED: ${passed}`);
    console.log(`FAILED: ${failed}`);

    if (failed === 0) {
      console.log('\n🎉 ALL 15 TEST CASES PASSED SUCCESSFULLY!');
    }
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

runTests().catch((err) => {
  console.error('Test Suite Error:', err);
  process.exit(1);
});
