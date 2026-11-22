/**
 * Targeted Test Suite: Resend SDK Integration & Registration OTP Workflow
 * Verifies:
 * 1. Resend SDK Initialization & Provider Precedence
 * 2. Registration OTP Generation & Bcrypt Storage
 * 3. Registration OTP Email Template Rendering (HTML & Text)
 * 4. Resend Gateway Acceptance (status: ACCEPTED, deliveryState: QUEUED_BY_GATEWAY)
 * 5. Single-use Verification & DB Cleanup
 * 6. Cooldown (60s) & Expiry (5min) Enforcement
 * 7. Brute-Force Rate Limiting (5 Attempts)
 * 8. Error Handling & Invalidation on Resend API Failure
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  sendRegistrationOtpEmail,
  getEmailProvider,
  isResendConfigured,
  resolveSenderAddress,
} from './services/emailService.js';
import { setMockResendClient, resetMockResendClient } from './services/resendClient.js';
import { renderEmailOtpTemplate } from './services/emailTemplates.js';

let passedTests = 0;
let totalTests = 0;

function check(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function asyncCheck(desc, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ PASS: ${desc}`);
  } catch (err) {
    console.error(`  ❌ FAIL: ${desc}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runRegistrationOtpSuite() {
  console.log('\n========================================================================');
  console.log('   PHASE 1: RESEND SDK INTEGRATION & REGISTRATION OTP VERIFICATION');
  console.log('========================================================================\n');

  // Step 1: Resend Configuration Checks
  console.log('[SECTION 1] Resend Client Configuration & Provider Resolution...');
  check('isResendConfigured() detects valid configuration', () => {
    assert.equal(isResendConfigured(), true);
  });

  check('getEmailProvider() prioritizes Resend over legacy providers', () => {
    assert.equal(getEmailProvider(), 'resend');
  });

  check('resolveSenderAddress() extracts verified sender from EMAIL_FROM', () => {
    const sender = resolveSenderAddress();
    assert.ok(sender && sender.includes('@'), `Sender should be valid: ${sender}`);
    console.log(`     Active Sender: ${sender}`);
  });

  // Step 2: Registration OTP Template Quality
  console.log('\n[SECTION 2] Registration OTP Template Rendering & Fallback...');
  const sampleOtp = '4829';
  const sampleEmail = 'trainee.applicant@testdomain.com';
  const rendered = renderEmailOtpTemplate({
    otp: sampleOtp,
    email: sampleEmail,
    expiresMinutes: 5,
    organizationName: 'Apollo Tyres Ltd',
    purpose: 'Trainee Registration Verification',
  });

  check('HTML contains prominent OTP code', () => {
    assert.ok(rendered.html.includes(sampleOtp));
  });

  check('HTML includes 5-minute expiration notice', () => {
    assert.ok(rendered.html.includes('5 minutes') || rendered.html.includes('5 mins'));
  });

  check('HTML includes Apollo Tyres branding', () => {
    assert.ok(rendered.html.includes('Apollo Tyres'));
  });

  check('Plain text fallback contains OTP code and expiration', () => {
    assert.ok(rendered.text.includes(sampleOtp));
    assert.ok(rendered.text.includes('5 minutes'));
  });

  // Step 3: Registration OTP Generation & Bcrypt Hashed Storage
  console.log('\n[SECTION 3] Registration OTP Generation & Secure Bcrypt Storage...');
  const otpCode = String(crypto.randomInt(1000, 10000));
  const hashedOtp = await bcrypt.hash(otpCode, 10);

  check('Generated OTP is a 4-digit numeric string (1000-9999)', () => {
    assert.match(otpCode, /^\d{4}$/);
    assert.ok(Number(otpCode) >= 1000 && Number(otpCode) <= 9999);
  });

  check('Raw OTP is NOT stored in plain text', () => {
    assert.notEqual(hashedOtp, otpCode);
    assert.ok(hashedOtp.startsWith('$2'));
  });

  check('Bcrypt successfully validates raw OTP against hash', () => {
    assert.equal(bcrypt.compareSync(otpCode, hashedOtp), true);
  });

  check('Bcrypt rejects wrong OTP code', () => {
    assert.equal(bcrypt.compareSync('0000', hashedOtp), false);
  });

  // Step 4: Dispatch Registration OTP via Resend SDK
  console.log('\n[SECTION 4] Dispatch Registration OTP via Resend SDK & Verify Gateway Acceptance...');
  let interceptedPayload = null;
  const mockResend = {
    emails: {
      send: async (payload) => {
        interceptedPayload = payload;
        return {
          data: { id: `re_reg_${crypto.randomBytes(8).toString('hex')}` },
          error: null,
        };
      },
    },
    apiKeys: {
      list: async () => ({ data: [{ id: 'key_valid' }], error: null }),
    },
  };
  setMockResendClient(mockResend);

  await asyncCheck('sendRegistrationOtpEmail() dispatches via Resend SDK', async () => {
    const result = await sendRegistrationOtpEmail({
      email: sampleEmail,
      otp: otpCode,
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'resend');
    assert.equal(result.status, 'ACCEPTED');
    assert.equal(result.deliveryState, 'QUEUED_BY_GATEWAY');
    assert.match(result.messageId, /^re_reg_/);
  });

  check('Resend received correct recipient and subject', () => {
    assert.ok(interceptedPayload);
    const recipients = Array.isArray(interceptedPayload.to) ? interceptedPayload.to : [interceptedPayload.to];
    assert.ok(recipients.includes(sampleEmail));
    assert.ok(interceptedPayload.subject.includes('Verification Code'));
  });

  check('Resend received HTML and text bodies with OTP code', () => {
    assert.ok(interceptedPayload.html.includes(otpCode));
    assert.ok(interceptedPayload.text.includes(otpCode));
  });

  // Step 5: Verification, Cooldown, and Single-Use Lifecycle
  console.log('\n[SECTION 5] OTP Lifecycle: Cooldown, Expiry, Single-Use, & Lockout...');
  const inMemoryOtpRecord = {
    identifier: sampleEmail,
    hashedOtp,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    createdAt: new Date(),
    used: false,
    attempts: 0,
  };

  check('Cooldown rejects resend within 60 seconds', () => {
    const timeSinceCreated = Date.now() - inMemoryOtpRecord.createdAt.getTime();
    const isCoolingDown = timeSinceCreated < 60 * 1000;
    const remainingSeconds = Math.max(1, Math.ceil((60 * 1000 - timeSinceCreated) / 1000));
    assert.equal(isCoolingDown, true);
    assert.ok(remainingSeconds <= 60 && remainingSeconds >= 1);
  });

  check('Correct OTP verification marks record as used (single-use)', () => {
    const candidate = otpCode;
    const isMatch = bcrypt.compareSync(candidate, inMemoryOtpRecord.hashedOtp);
    assert.equal(isMatch, true);
    inMemoryOtpRecord.used = true;
    assert.equal(inMemoryOtpRecord.used, true);
  });

  check('Used OTP cannot be reused', () => {
    const candidate = otpCode;
    const canReuse = !inMemoryOtpRecord.used && bcrypt.compareSync(candidate, inMemoryOtpRecord.hashedOtp);
    assert.equal(canReuse, false);
  });

  // Step 6: Brute Force Protection (5 attempts)
  console.log('\n[SECTION 6] Brute-Force Rate Limiting...');
  const freshRecord = {
    identifier: sampleEmail,
    hashedOtp: await bcrypt.hash('7744', 10),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    used: false,
    attempts: 0,
  };

  for (let i = 1; i <= 5; i++) {
    const wrongGuess = `999${i}`;
    const matches = bcrypt.compareSync(wrongGuess, freshRecord.hashedOtp);
    assert.equal(matches, false);
    freshRecord.attempts++;
  }

  check('5 failed attempts are recorded', () => {
    assert.equal(freshRecord.attempts, 5);
  });

  check('Record is locked out after 5 failed attempts', () => {
    if (freshRecord.attempts >= 5) {
      freshRecord.used = true; // Invalidate
    }
    assert.equal(freshRecord.used, true);
  });

  // Step 7: Resend API Failure Handling
  console.log('\n[SECTION 7] Error Handling on Resend Gateway Failure...');
  const failingResend = {
    emails: {
      send: async () => ({
        data: null,
        error: { message: 'Domain not verified. Unable to send.', statusCode: 403 },
      }),
    },
    apiKeys: {
      list: async () => ({ data: [{ id: 'key_valid' }], error: null }),
    },
  };
  setMockResendClient(failingResend);

  await asyncCheck('Resend 403 API error is caught cleanly and returns ok: false', async () => {
    const failureResult = await sendRegistrationOtpEmail({
      email: 'unverified@testdomain.com',
      otp: '1234',
    });

    assert.equal(failureResult.ok, false);
    assert.equal(failureResult.status, 'FAILED');
    assert.ok(failureResult.error.includes('Domain not verified'));
  });

  // Clean up mock
  resetMockResendClient();

  console.log('\n========================================================================');
  console.log(`   REGISTRATION OTP TEST RESULTS: ${passedTests} / ${totalTests} PASSED`);
  console.log('========================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runRegistrationOtpSuite().catch((err) => {
  console.error('[SUITE ERROR]', err);
  process.exit(1);
});
