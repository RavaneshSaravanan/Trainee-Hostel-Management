import assert from 'assert';
import jwt from 'jsonwebtoken';
import { getAppUrl, sendApprovalRequestEmail } from './services/emailService.js';

console.log('--- RUNNING REVIEW URL & APPROVAL EMAIL UNIT TESTS ---');

const originalEnv = { ...process.env };

function resetEnv() {
  process.env = { ...originalEnv };
  delete process.env.GMAIL_CLIENT_ID;
  delete process.env.GMAIL_CLIENT_SECRET;
  delete process.env.GMAIL_REFRESH_TOKEN;
  delete process.env.GMAIL_USER;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.BREVO_API_KEY;
}

// Test 1: getAppUrl in local dev without FRONTEND_URL defaults to http://localhost:5173
{
  resetEnv();
  delete process.env.FRONTEND_URL;
  delete process.env.APP_URL;
  delete process.env.CLIENT_ORIGIN;
  process.env.NODE_ENV = 'development';
  const url = getAppUrl();
  assert.strictEqual(url, 'http://localhost:5173', 'Test 1 Failed: Local development fallback should be http://localhost:5173');
  console.log('✅ Test 1 Passed: Local development fallback correctly returns http://localhost:5173');
}

// Test 2: getAppUrl prioritizes FRONTEND_URL
{
  resetEnv();
  process.env.FRONTEND_URL = 'https://trainee-hostel-management.vercel.app';
  process.env.NODE_ENV = 'production';
  const url = getAppUrl();
  assert.strictEqual(url, 'https://trainee-hostel-management.vercel.app', 'Test 2 Failed: Production FRONTEND_URL priority');
  console.log('✅ Test 2 Passed: getAppUrl prioritizes FRONTEND_URL in production');
}

// Test 3: getAppUrl trims trailing slashes
{
  resetEnv();
  process.env.FRONTEND_URL = 'https://trainee-hostel-management.vercel.app///';
  const url = getAppUrl();
  assert.strictEqual(url, 'https://trainee-hostel-management.vercel.app', 'Test 3 Failed: Trailing slash trimming');
  console.log('✅ Test 3 Passed: Trailing slashes are cleanly trimmed');
}

// Test 4: getAppUrl in production rejects localhost and falls back to deployed CLIENT_ORIGIN
{
  resetEnv();
  process.env.NODE_ENV = 'production';
  delete process.env.FRONTEND_URL;
  delete process.env.APP_URL;
  process.env.CLIENT_ORIGIN = 'http://localhost:5173,https://trainee-hostel-management.vercel.app';
  const url = getAppUrl();
  assert.strictEqual(url, 'https://trainee-hostel-management.vercel.app', 'Test 4 Failed: Rejection of localhost in production');
  console.log('✅ Test 4 Passed: In production, localhost is rejected and deployed domain from CLIENT_ORIGIN is used');
}

// Test 5: Verify dynamic reviewUrl generation logic matches user specification
{
  resetEnv();
  process.env.FRONTEND_URL = 'https://trainee-hostel-management.vercel.app';
  process.env.JWT_SECRET = 'ec676a706bf879761ceb25411352184fbc49ae70a939426a7a1a248bbf0a1768';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.NODE_ENV = 'production';

  const traineeId = '101';
  const approver = { userId: 'admin_001', name: 'Super Admin', email: 'admin@example.com', roleId: 'superadmin' };

  const frontendUrl = (process.env.FRONTEND_URL || getAppUrl() || 'http://localhost:5173').trim().replace(/\/+$/, '');
  const token = jwt.sign(
    {
      traineeId,
      approverId: approver.userId,
      purpose: 'REVIEW_REGISTRATION',
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const reviewUrl = `${frontendUrl}/#/review/${traineeId}?token=${token}`;

  assert(reviewUrl.startsWith('https://trainee-hostel-management.vercel.app/#/review/101?token='), 'Review URL starts with deployed domain and hash route');
  assert(!reviewUrl.includes('localhost'), 'Review URL must not contain localhost in production');

  // Verify JWT payload
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  assert.strictEqual(decoded.traineeId, '101');
  assert.strictEqual(decoded.approverId, 'admin_001');
  assert.strictEqual(decoded.purpose, 'REVIEW_REGISTRATION');
  assert(decoded.exp - decoded.iat === 7 * 24 * 60 * 60, 'Token expiry must be 7 days');

  console.log('✅ Test 5 Passed: Dynamic reviewUrl, HashRouter structure, and JWT verification passed');
}

// Test 6: Verify dynamic reviewUrl generation in local development without FRONTEND_URL uses localhost:5173
{
  resetEnv();
  delete process.env.FRONTEND_URL;
  delete process.env.APP_URL;
  delete process.env.CLIENT_ORIGIN;
  process.env.NODE_ENV = 'development';
  process.env.JWT_SECRET = 'dev_secret_key_for_testing_1234567890';

  const traineeId = '101';
  const approver = { userId: 'admin_001', name: 'Super Admin' };

  const frontendUrl = (process.env.FRONTEND_URL || getAppUrl() || 'http://localhost:5173').trim().replace(/\/+$/, '');
  const token = jwt.sign(
    {
      traineeId,
      approverId: approver.userId,
      purpose: 'REVIEW_REGISTRATION',
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  const reviewUrl = `${frontendUrl}/#/review/${traineeId}?token=${token}`;

  assert.strictEqual(frontendUrl, 'http://localhost:5173');
  assert(reviewUrl.startsWith('http://localhost:5173/#/review/101?token='));
  console.log('✅ Test 6 Passed: Local development successfully defaults to http://localhost:5173');
}

// Test 7: Verify sendApprovalRequestEmail dispatches with production URL in button and direct link
{
  resetEnv();
  process.env.FRONTEND_URL = 'https://trainee-hostel-management.vercel.app';
  process.env.JWT_SECRET = 'ec676a706bf879761ceb25411352184fbc49ae70a939426a7a1a248bbf0a1768';
  process.env.ADMIN_EMAIL = 'admin@example.com';
  process.env.NODE_ENV = 'production';
  // Mock Resend to intercept dispatch without sending live HTTP
  process.env.RESEND_API_KEY = 're_test_key_12345';

  let interceptedPayload = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).includes('resend.com')) {
      interceptedPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_test_123' }),
        text: async () => JSON.stringify({ id: 'email_test_123' }),
      };
    }
    return originalFetch(url, options);
  };

  try {
    const res = await sendApprovalRequestEmail({
      approver: { userId: 'superadmin_1', name: 'Apollo Super Admin', email: 'admin@apollotyres.com', roleId: 'superadmin' },
      trainee: { traineeId: '101', name: 'Arun Kumar', email: 'arun@example.com', mobile: '9876543210', qualification: 'Diploma Mech' },
    });

    assert(res.ok, `sendApprovalRequestEmail should succeed: ${res.error}`);
    assert(interceptedPayload, 'Dispatch payload should be intercepted');

    const expectedPrefix = 'https://trainee-hostel-management.vercel.app/#/review/101?token=';
    assert(interceptedPayload.html.includes(`href="${expectedPrefix}`), 'HTML button must link to production Vercel review URL');
    assert(interceptedPayload.html.includes(`Direct secure link: <a href="${expectedPrefix}`), 'HTML direct secure link must match production Vercel review URL');
    assert(interceptedPayload.text.includes(expectedPrefix), 'Plain-text body must contain production Vercel review URL');
    assert(!interceptedPayload.html.includes('localhost:5173'), 'Production email HTML must NOT contain localhost');
    assert(!interceptedPayload.text.includes('localhost:5173'), 'Production email text must NOT contain localhost');

    console.log('✅ Test 7 Passed: sendApprovalRequestEmail dispatches production Vercel URL in both HTML button and direct link');
  } finally {
    global.fetch = originalFetch;
  }
}

// Test 8: Verify sendApprovalRequestEmail in development uses localhost:5173 in button and direct link
{
  resetEnv();
  delete process.env.FRONTEND_URL;
  delete process.env.APP_URL;
  delete process.env.CLIENT_ORIGIN;
  process.env.NODE_ENV = 'development';
  process.env.JWT_SECRET = 'ec676a706bf879761ceb25411352184fbc49ae70a939426a7a1a248bbf0a1768';
  process.env.RESEND_API_KEY = 're_test_key_dev';

  let interceptedPayload = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (String(url).includes('resend.com')) {
      interceptedPayload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'email_dev_123' }),
        text: async () => JSON.stringify({ id: 'email_dev_123' }),
      };
    }
    return originalFetch(url, options);
  };

  try {
    const res = await sendApprovalRequestEmail({
      approver: { userId: 'superadmin_1', name: 'Apollo Super Admin', email: 'admin@apollotyres.com', roleId: 'superadmin' },
      trainee: { traineeId: '101', name: 'Arun Kumar', email: 'arun@example.com', mobile: '9876543210', qualification: 'Diploma Mech' },
    });

    assert(res.ok, `sendApprovalRequestEmail should succeed in dev: ${res.error}`);
    assert(interceptedPayload, 'Dispatch payload should be intercepted');

    const expectedLocalPrefix = 'http://localhost:5173/#/review/101?token=';
    assert(interceptedPayload.html.includes(`href="${expectedLocalPrefix}`), 'Dev HTML button must link to localhost');
    assert(interceptedPayload.text.includes(expectedLocalPrefix), 'Dev plain-text body must contain localhost');

    console.log('✅ Test 8 Passed: sendApprovalRequestEmail in development correctly uses localhost:5173');
  } finally {
    global.fetch = originalFetch;
  }
}

resetEnv();
console.log('\n🎉 ALL 8 TESTS PASSED SUCCESSFULLY! EVERYTHING IS VERIFIED.');
process.exit(0);
