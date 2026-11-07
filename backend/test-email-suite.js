import assert from 'node:assert/strict';
import {
  getEmailProvider,
  isEmailConfigured,
  getTransporter,
  verifySmtpConnection,
  resolveResendSender,
  sendEmail,
  sendRegistrationOtpEmail,
  sendRegistrationConfirmationEmail,
  sendApprovalRequestNotification,
  sendApprovalRequestEmail,
  sendDecisionNotificationEmail,
  sendTraineeWelcomeEmail,
  sendTraineeIdCardEmail,
} from './services/emailService.js';
import { getJwtSecret } from './config/jwt.js';

let passed = 0;
let failed = 0;

function it(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err) => {
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    });
}

// Global fetch mocking utility
let originalFetch = globalThis.fetch;
function mockFetch(handler) {
  globalThis.fetch = async (url, options) => {
    return handler(url, options);
  };
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

async function runTests() {
  console.log('\n======================================================');
  console.log('       PRODUCTION EMAIL DELIVERY TEST SUITE');
  console.log('======================================================\n');

  const originalEnv = { ...process.env };

  try {
    // ------------------------------------------------------------------
    console.log('[SECTION 1] JWT Secret Security & Production Hardening');
    // ------------------------------------------------------------------
    await it('Throws error in production if JWT_SECRET is default weak value', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'trainee_hostel_secret_jwt_key_2026';
      assert.throws(() => getJwtSecret(), /FATAL SECURITY ERROR/);
    });

    await it('Throws error in production if JWT_SECRET is too short (<32 chars)', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'short_secret_key_12345';
      assert.throws(() => getJwtSecret(), /FATAL SECURITY ERROR/);
    });

    await it('Accepts strong JWT_SECRET (>= 32 chars) in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.JWT_SECRET = 'a_very_strong_secure_random_jwt_secret_for_production_2026_test!';
      const sec = getJwtSecret();
      assert.equal(sec, process.env.JWT_SECRET);
    });

    await it('Provides safe fallback in development if JWT_SECRET is missing', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.JWT_SECRET;
      const sec = getJwtSecret();
      assert.ok(sec && sec.length >= 32);
    });

    // ------------------------------------------------------------------
    console.log('\n[SECTION 2] Environment Configuration & SMTP Disabling');
    // ------------------------------------------------------------------
    await it('Never returns "smtp" provider in production even if SMTP env vars exist', () => {
      process.env.NODE_ENV = 'production';
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_USER = 'test@gmail.com';
      process.env.SMTP_PASS = 'testpass';
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;

      const provider = getEmailProvider();
      assert.notEqual(provider, 'smtp', 'getEmailProvider() must NEVER return "smtp" in production');
      assert.equal(provider, 'none');
    });

    await it('Returns "resend" provider in production when RESEND_API_KEY is configured', () => {
      process.env.NODE_ENV = 'production';
      process.env.RESEND_API_KEY = 're_test_key_1234567890';
      const provider = getEmailProvider();
      assert.equal(provider, 'resend');
    });

    await it('getTransporter() strictly returns null in production (Never attempts SMTP)', () => {
      process.env.NODE_ENV = 'production';
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'test@gmail.com';
      process.env.SMTP_PASS = 'testpass';
      const transport = getTransporter();
      assert.equal(transport, null, 'getTransporter() must return null in production');
    });

    await it('verifySmtpConnection() blocks SMTP in production without connecting', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;
      const res = await verifySmtpConnection();
      assert.equal(res.ok, false);
      assert.equal(res.status, 'NOT_CONFIGURED');
    });

    await it('Allows "smtp" in development when credentials are present', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;
      process.env.SMTP_HOST = 'smtp.gmail.com';
      process.env.SMTP_USER = 'test@gmail.com';
      process.env.SMTP_PASS = 'testpass';
      const provider = getEmailProvider();
      assert.equal(provider, 'smtp');
    });

    // ------------------------------------------------------------------
    console.log('\n[SECTION 3] Resend Sender Address Resolution');
    // ------------------------------------------------------------------
    await it('Safely overrides @gmail.com to onboarding@resend.dev while preserving display name', () => {
      delete process.env.RESEND_FROM;
      const from = resolveResendSender('Apollo Tyres Ltd Hostel Administration <apollotyres.hostel@gmail.com>');
      assert.equal(from, 'Apollo Tyres Ltd Hostel Administration <onboarding@resend.dev>');
    });

    await it('Uses RESEND_FROM environment variable when set and valid', () => {
      process.env.RESEND_FROM = 'Apollo Operations <notifications@hostel.apollotyres.com>';
      const from = resolveResendSender('Custom <apollotyres.hostel@gmail.com>');
      assert.equal(from, 'Apollo Operations <notifications@hostel.apollotyres.com>');
    });

    await it('Falls back safely if RESEND_FROM is an invalid email string', () => {
      process.env.RESEND_FROM = 'invalid-email-address-no-at';
      const from = resolveResendSender('Apollo Tyres Ltd <test@hostel.com>');
      assert.ok(from.includes('onboarding@resend.dev'));
    });

    // ------------------------------------------------------------------
    console.log('\n[SECTION 4] Resend API Error Handling & Timeout Verification');
    // ------------------------------------------------------------------
    await it('Accurately reports failed delivery on missing RESEND_API_KEY in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.RESEND_API_KEY;

      const res = await sendEmail({
        to: 'trainee@apollo.com',
        subject: 'Test Subject',
        text: 'Test message',
        type: 'REGISTRATION_CONFIRMATION',
      });

      assert.equal(res.ok, false, 'Must not claim success when API key is missing');
      assert.equal(res.status, 'FAILED');
      assert.ok(res.error.includes('RESEND_API_KEY'));
    });

    await it('Accurately reports failed delivery when Resend API rejects with 401 Unauthorized', async () => {
      process.env.NODE_ENV = 'production';
      process.env.RESEND_API_KEY = 're_invalid_api_key_test';

      mockFetch((url, opts) => {
        return {
          ok: false,
          status: 401,
          json: async () => ({
            statusCode: 401,
            name: 'validation_error',
            message: 'API key is invalid',
          }),
        };
      });

      try {
        const res = await sendEmail({
          to: 'trainee@apollo.com',
          subject: 'Test 401',
          text: 'Test 401 message',
          type: 'REGISTRATION_CONFIRMATION',
        });

        assert.equal(res.ok, false, 'Must never report success when provider rejects');
        assert.equal(res.status, 'FAILED');
        assert.ok(res.error.includes('API key is invalid'));
      } finally {
        restoreFetch();
      }
    });

    await it('Accurately reports failed delivery when Resend API rejects with 422 Unverified Domain', async () => {
      process.env.NODE_ENV = 'production';
      process.env.RESEND_API_KEY = 're_valid_key_test';

      mockFetch((url, opts) => {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            statusCode: 422,
            name: 'validation_error',
            message: 'Domain not verified. You can only send from onboarding@resend.dev',
          }),
        };
      });

      try {
        const res = await sendEmail({
          to: 'trainee@apollo.com',
          subject: 'Test 422',
          text: 'Test 422 message',
          type: 'REGISTRATION_CONFIRMATION',
        });

        assert.equal(res.ok, false, 'Must never report success when provider rejects');
        assert.equal(res.status, 'FAILED');
        assert.ok(res.error.includes('Domain not verified'));
      } finally {
        restoreFetch();
      }
    });

    await it('Accurately handles API timeout via AbortController', async () => {
      process.env.NODE_ENV = 'production';
      process.env.RESEND_API_KEY = 're_valid_key_test';

      mockFetch((url, opts) => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      });

      try {
        const res = await sendEmail({
          to: 'trainee@apollo.com',
          subject: 'Test Timeout',
          text: 'Test timeout message',
          type: 'REGISTRATION_CONFIRMATION',
        });

        assert.equal(res.ok, false);
        assert.equal(res.status, 'FAILED');
        assert.ok(res.error.includes('timed out'));
      } finally {
        restoreFetch();
      }
    });

    await it('Returns SENT status and messageId when Resend API returns 200 OK', async () => {
      process.env.NODE_ENV = 'production';
      process.env.RESEND_API_KEY = 're_valid_key_test';

      let capturedPayload = null;
      mockFetch((url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 're_msg_successful_12345678' }),
        };
      });

      try {
        const res = await sendEmail({
          to: 'trainee@apollo.com',
          subject: 'Welcome to Hostel',
          html: '<strong>Welcome!</strong>',
          text: 'Welcome!',
          type: 'REGISTRATION_CONFIRMATION',
        });

        assert.equal(res.ok, true);
        assert.equal(res.status, 'SENT');
        assert.equal(res.messageId, 're_msg_successful_12345678');
        assert.equal(res.provider, 'resend');
        assert.ok(capturedPayload);
        assert.deepEqual(capturedPayload.to, ['trainee@apollo.com']);
        assert.equal(capturedPayload.subject, 'Welcome to Hostel');
        assert.ok(capturedPayload.from.includes('onboarding@resend.dev'));
      } finally {
        restoreFetch();
      }
    });

    // ------------------------------------------------------------------
    console.log('\n[SECTION 5] Existing Email Workflows & Payload Integrity');
    // ------------------------------------------------------------------
    process.env.NODE_ENV = 'production';
    process.env.RESEND_API_KEY = 're_valid_key_workflow_test';
    process.env.JWT_SECRET = 'a_very_strong_secure_random_jwt_secret_for_production_2026_test!';

    const mockTrainee = {
      traineeId: 'TRN-2026-TEST',
      qrId: 'QR-TEST-001',
      name: 'Ravi Kumar',
      email: 'ravi.kumar@apollo.com',
      mobile: '9876543210',
      hostel: 'Block A',
      roomNo: 'A-101',
      joiningDate: '2026-11-01',
      approvalStatus: 'APPROVED',
      hostelStatus: 'APPROVED',
      emergencyContactName: 'Suresh Kumar',
      emergencyContactNo: '9876543211',
    };

    await it('Workflow 1: sendRegistrationOtpEmail sends valid payload with protected OTP', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_otp_123' }) };
      });

      try {
        const res = await sendRegistrationOtpEmail({ email: 'newtrainee@apollo.com', otp: '4829' });
        assert.equal(res.ok, true);
        assert.equal(res.status, 'SENT');
        assert.deepEqual(sentPayload.to, ['newtrainee@apollo.com']);
        assert.ok(sentPayload.html.includes('4829'));
        assert.ok(sentPayload.subject.includes('Verification Code'));
      } finally {
        restoreFetch();
      }
    });

    await it('Workflow 2: sendRegistrationConfirmationEmail constructs correct template', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_reg_conf_123' }) };
      });

      try {
        const res = await sendRegistrationConfirmationEmail({ trainee: mockTrainee, force: true });
        assert.equal(res.ok, true);
        assert.deepEqual(sentPayload.to, ['ravi.kumar@apollo.com']);
        assert.ok(sentPayload.subject.includes('Registration'));
      } finally {
        restoreFetch();
      }
    });

    await it('Workflow 3: sendApprovalRequestEmail generates JWT review link', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_appr_req_123' }) };
      });

      try {
        const approver = { userId: 'admin_1', name: 'Warden Admin', email: 'warden@apollotyres.com', role: 'warden' };
        const res = await sendApprovalRequestEmail({ approver, trainee: mockTrainee });
        assert.equal(res.ok, true);
        assert.deepEqual(sentPayload.to, ['warden@apollotyres.com']);
        assert.ok(sentPayload.text.includes('#/review/TRN-2026-TEST?token='));
      } finally {
        restoreFetch();
      }
    });

    await it('Workflow 4: sendDecisionNotificationEmail (APPROVED)', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_dec_appr_123' }) };
      });

      try {
        const res = await sendDecisionNotificationEmail({
          trainee: mockTrainee,
          decision: 'APPROVED',
          actorName: 'Hostel Warden',
        });
        assert.equal(res.ok, true);
        assert.deepEqual(sentPayload.to, ['ravi.kumar@apollo.com']);
        assert.ok(sentPayload.subject.toLowerCase().includes('approved'));
      } finally {
        restoreFetch();
      }
    });

    await it('Workflow 5: sendDecisionNotificationEmail (REJECTED with reason)', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_dec_rej_123' }) };
      });

      try {
        const res = await sendDecisionNotificationEmail({
          trainee: mockTrainee,
          decision: 'REJECTED',
          rejectionReason: 'Invalid Aadhaar documentation provided',
          actorName: 'HR Administration',
        });
        assert.equal(res.ok, true);
        assert.deepEqual(sentPayload.to, ['ravi.kumar@apollo.com']);
        assert.ok(sentPayload.subject.toLowerCase().includes('rejected') || sentPayload.subject.toLowerCase().includes('update'));
        assert.ok(sentPayload.text.includes('Invalid Aadhaar documentation provided'));
      } finally {
        restoreFetch();
      }
    });

    await it('Workflow 6: sendTraineeWelcomeEmail sends room allocation details', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_welcome_123' }) };
      });

      try {
        const res = await sendTraineeWelcomeEmail({ trainee: mockTrainee, force: true });
        assert.equal(res.ok, true);
        assert.deepEqual(sentPayload.to, ['ravi.kumar@apollo.com']);
        assert.ok(sentPayload.subject.includes('Welcome') || sentPayload.subject.includes('Hostel'));
      } finally {
        restoreFetch();
      }
    });

    await it('Workflow 7: sendTraineeIdCardEmail generates PDF attachment with base64 encoding', async () => {
      let sentPayload = null;
      mockFetch((url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return { ok: true, status: 200, json: async () => ({ id: 're_idcard_123' }) };
      });

      try {
        const res = await sendTraineeIdCardEmail({ trainee: mockTrainee, force: true });
        assert.equal(res.ok, true);
        assert.deepEqual(sentPayload.to, ['ravi.kumar@apollo.com']);
        assert.ok(Array.isArray(sentPayload.attachments));
        assert.equal(sentPayload.attachments.length, 1);
        assert.ok(sentPayload.attachments[0].filename.includes('.pdf'));
        assert.ok(typeof sentPayload.attachments[0].content === 'string'); // base64 string
        assert.ok(sentPayload.attachments[0].content.length > 500); // contains binary PDF data
      } finally {
        restoreFetch();
      }
    });

    // ------------------------------------------------------------------
    console.log('\n[SECTION 6] Local Development Simulation & Fallback');
    // ------------------------------------------------------------------
    await it('Simulates emails locally without crashing when no provider is configured', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.RESEND_API_KEY;
      delete process.env.BREVO_API_KEY;
      delete process.env.SMTP_HOST;

      const res = await sendEmail({
        to: 'devtrainee@local.host',
        subject: 'Dev Test Simulation',
        text: 'Local testing content',
        type: 'REGISTRATION_CONFIRMATION',
      });

      assert.equal(res.ok, true);
      assert.equal(res.status, 'DEV_SIMULATED');
    });

  } finally {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  }

  console.log('\n======================================================');
  console.log(`TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
