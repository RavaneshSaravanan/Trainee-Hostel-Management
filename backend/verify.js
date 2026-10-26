import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from './server.js';
import { connectDB } from './config/db.js';
import { seedDatabase } from './seed.js';

let server;
let baseUrl;
let mongod;

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log('--- Starting Verification Script ---');

  // Start in-memory Mongo if no local Mongo URI is provided or available
  let uri = process.env.MONGO_URI;
  if (!uri || uri.includes('localhost')) {
    try {
      // test if local mongo is reachable
      const testConn = await mongoose.connect(uri || 'mongodb://localhost:27017/trainee-hostel', { serverSelectionTimeoutMS: 1500 });
      await testConn.disconnect();
    } catch {
      console.log('Local MongoDB not running. Spawning MongoMemoryServer...');
      mongod = await MongoMemoryServer.create();
      uri = mongod.getUri();
      process.env.MONGO_URI = uri;
    }
  }

  await connectDB();
  await seedDatabase();

  const port = 5099;
  server = app.listen(port);
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running at ${baseUrl}`);

  try {
    // 1. Login as admin and superadmin
    console.log('\n[1] Testing POST /api/login as admin & superadmin...');
    const adminLogin = await request('/api/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin123' },
    });
    if (!adminLogin.ok || !adminLogin.data.token || adminLogin.data.user.roleId !== 'superadmin') {
      throw new Error(`Admin login failed: ${JSON.stringify(adminLogin.data)}`);
    }
    const adminToken = adminLogin.data.token;
    console.log('✓ Admin login successful. Token acquired.');

    const superAdminLogin = await request('/api/login', {
      method: 'POST',
      body: { username: 'superadmin', password: 'superadmin123' },
    });
    if (!superAdminLogin.ok || !superAdminLogin.data.token || superAdminLogin.data.user.roleId !== 'superadmin') {
      throw new Error(`Superadmin login failed: ${JSON.stringify(superAdminLogin.data)}`);
    }
    console.log('✓ superadmin (superadmin123) login successful. Token acquired.');

    // 2. Login as warden
    console.log('\n[2] Testing POST /api/login as warden...');
    const wardenLogin = await request('/api/login', {
      method: 'POST',
      body: { username: 'warden', password: 'warden123' },
    });
    if (!wardenLogin.ok || !wardenLogin.data.token || wardenLogin.data.user.roleId !== 'warden') {
      throw new Error(`Warden login failed: ${JSON.stringify(wardenLogin.data)}`);
    }
    const wardenToken = wardenLogin.data.token;
    console.log('✓ Warden login successful. Token acquired.');

    // 3. Test GET /api/rev
    console.log('\n[3] Testing GET /api/rev...');
    const revRes = await request('/api/rev');
    if (!revRes.ok || typeof revRes.data.rev !== 'number') {
      throw new Error(`GET /api/rev failed: ${JSON.stringify(revRes.data)}`);
    }
    console.log(`✓ GET /api/rev returned rev: ${revRes.data.rev}`);

    // 4. Test GET /api/state as admin and warden
    console.log('\n[4] Testing GET /api/state as admin...');
    const adminState = await request('/api/state', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!adminState.ok || !adminState.data.db || !Array.isArray(adminState.data.users) || adminState.data.users.length === 0) {
      throw new Error(`Admin GET /api/state failed: ${JSON.stringify(adminState.data)}`);
    }
    console.log(`✓ Admin GET /api/state returned ${adminState.data.db.trainees.length} trainees and ${adminState.data.users.length} users.`);

    console.log('Testing GET /api/state as warden...');
    const wardenState = await request('/api/state', {
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (!wardenState.ok || !wardenState.data.db || wardenState.data.users.length !== 0) {
      throw new Error(`Warden GET /api/state should return empty users array, got: ${JSON.stringify(wardenState.data.users)}`);
    }
    console.log('✓ Warden GET /api/state returned empty users list (access restricted as expected).');

    // 5. Test GET /api/public
    console.log('\n[5] Testing GET /api/public...');
    const pubRes = await request('/api/public');
    if (!pubRes.ok || !pubRes.data.appName) {
      throw new Error(`GET /api/public failed: ${JSON.stringify(pubRes.data)}`);
    }
    console.log(`✓ GET /api/public returned appName: "${pubRes.data.appName}"`);

    // 6. Test POST /api/public/register
    console.log('\n[6] Testing POST /api/public/register...');
    const regTraineeId = 'TRN-TEST-99999';
    const regRes = await request('/api/public/register', {
      method: 'POST',
      body: {
        traineeId: regTraineeId,
        name: 'Test Self Register',
        mobile: '9876543210',
        email: 'test@example.com',
      },
    });
    if (!regRes.ok || !regRes.data.ok || regRes.data.traineeId !== regTraineeId || !regRes.data.qrId) {
      throw new Error(`POST /api/public/register failed: ${JSON.stringify(regRes.data)}`);
    }
    console.log(`✓ Registration succeeded. Generated hostelId: ${regRes.data.hostelId}, qrId: ${regRes.data.qrId}`);

    // Verify duplicate registration returns 409
    const dupRes = await request('/api/public/register', {
      method: 'POST',
      body: {
        traineeId: regTraineeId,
        name: 'Duplicate',
        mobile: '9876543210',
      },
    });
    if (dupRes.status !== 409) {
      throw new Error(`Expected 409 for duplicate registration, got: ${dupRes.status}`);
    }
    console.log('✓ Duplicate registration properly rejected with 409 Conflict.');

    // 7. Test PUT /api/state with STALE db to confirm registered trainee is NOT lost
    console.log('\n[7] Testing PUT /api/state with stale db (verifying no data loss)...');
    // adminState.data.db was captured BEFORE the registration of regTraineeId
    const staleDb = adminState.data.db;
    const hasRegInStale = staleDb.trainees.some((t) => t.traineeId === regTraineeId);
    if (hasRegInStale) {
      throw new Error('Stale DB unexpectedly contains the registered trainee!');
    }

    const putRes = await request('/api/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { db: staleDb },
    });
    if (!putRes.ok) {
      throw new Error(`PUT /api/state failed: ${JSON.stringify(putRes.data)}`);
    }

    // Now check if registered trainee is still present in the returned state
    const regStillPresent = putRes.data.db.trainees.some((t) => t.traineeId === regTraineeId);
    if (!regStillPresent) {
      throw new Error('FAILED: Registered trainee was lost after PUT /api/state with stale db!');
    }
    console.log('✓ CONFIRMED: Registered trainee is retained in MongoDB after stale PUT /api/state.');

    // 8. Confirm warden cannot call /api/users
    console.log('\n[8] Confirming warden cannot call /api/users...');
    const wardenUserCall = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wardenToken}` },
      body: { action: 'save', user: { name: 'Test', username: 'test1' } },
    });
    if (wardenUserCall.status !== 403) {
      throw new Error(`Expected 403 for warden calling /api/users, got ${wardenUserCall.status}`);
    }
    console.log('✓ Warden blocked from /api/users with 403 Forbidden.');

    // 9. Confirm warden cannot change config via PUT /api/state
    console.log('\n[9] Confirming warden cannot change config...');
    const originalAppName = adminState.data.config.appName;
    const wardenConfigChange = await request('/api/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${wardenToken}` },
      body: { config: { appName: 'Hacked App Name' } },
    });
    if (wardenConfigChange.data.config.appName === 'Hacked App Name') {
      throw new Error('FAILED: Warden was able to alter config!');
    }
    console.log(`✓ Warden config change ignored. Config appName remains: "${wardenConfigChange.data.config.appName}"`);

    // 10. Confirm admin CAN change config via PUT /api/state
    console.log('\n[10] Confirming admin CAN change config...');
    const newAppName = 'Trainee Hostel Pro';
    const adminConfigChange = await request('/api/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { config: { ...adminState.data.config, appName: newAppName } },
    });
    if (adminConfigChange.data.config.appName !== newAppName) {
      throw new Error(`Admin failed to update config appName, got: ${adminConfigChange.data.config.appName}`);
    }
    console.log(`✓ Admin successfully updated config appName to "${newAppName}".`);

    // 11. Test password change
    console.log('\n[11] Testing POST /api/me/password...');
    const pwRes = await request('/api/me/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { oldPassword: 'wrongpassword', newPassword: 'newadminpass' },
    });
    if (pwRes.status !== 400) {
      throw new Error('Expected 400 for wrong oldPassword in /api/me/password');
    }
    const pwSuccess = await request('/api/me/password', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { oldPassword: 'admin123', newPassword: 'admin12345' },
    });
    if (!pwSuccess.ok || !pwSuccess.data.ok) {
      throw new Error(`Password change failed: ${JSON.stringify(pwSuccess.data)}`);
    }
    console.log('✓ Password change verified.');

    // 12. Test User creation with mandatory Email/Mobile and uniqueness checks
    console.log('\n[12] Testing user creation contact validation & uniqueness...');
    const noContactUser = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'save', user: { name: 'No Contact', username: 'nocontact', roleId: 'warden' }, password: 'password123' },
    });
    if (noContactUser.status !== 400) {
      throw new Error(`Expected 400 when creating user with no email and mobile, got: ${noContactUser.status}`);
    }
    console.log('✓ Rejected user creation with no email and no mobile (400 Bad Request).');

    const validUser = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'save',
        user: { name: 'Valid User', username: 'validuser', email: 'valid@example.com', mobile: '9988776655', roleId: 'warden' },
        password: 'password123',
      },
    });
    if (!validUser.ok) {
      throw new Error(`Failed to create valid user with email and mobile: ${JSON.stringify(validUser.data)}`);
    }
    console.log('✓ Successfully created user with email and mobile.');

    // Duplicate email
    const dupEmail = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'save',
        user: { name: 'Dup Email', username: 'dupemail', email: 'valid@example.com', mobile: '9111111111', roleId: 'warden' },
        password: 'password123',
      },
    });
    if (dupEmail.status !== 409) {
      throw new Error(`Expected 409 for duplicate email, got: ${dupEmail.status}`);
    }
    console.log('✓ Rejected duplicate email (409 Conflict).');

    // Duplicate mobile
    const dupMobile = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        action: 'save',
        user: { name: 'Dup Mobile', username: 'dupmobile', email: 'different@example.com', mobile: '9988776655', roleId: 'warden' },
        password: 'password123',
      },
    });
    if (dupMobile.status !== 409) {
      throw new Error(`Expected 409 for duplicate mobile, got: ${dupMobile.status}`);
    }
    console.log('✓ Rejected duplicate mobile (409 Conflict).');

    // 13. Test Forgot Password OTP Flow
    console.log('\n[13] Testing Forgot Password OTP Flow...');
    const sendOtpRes = await request('/api/auth/forgot-password/send-otp', {
      method: 'POST',
      body: { identifier: 'superadmin' },
    });
    if (!sendOtpRes.ok || !sendOtpRes.data.devOtp) {
      throw new Error(`Failed to send OTP: ${JSON.stringify(sendOtpRes.data)}`);
    }
    const testOtp = sendOtpRes.data.devOtp;
    console.log(`✓ OTP sent for superadmin. Code received: ${testOtp}`);

    // Invalid OTP test
    const badOtpRes = await request('/api/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: { identifier: 'superadmin', otp: '000000', newPassword: 'newpassword123' },
    });
    if (badOtpRes.status !== 400) {
      throw new Error('Expected 400 for invalid OTP code');
    }
    console.log('✓ Rejected invalid OTP code (400 Bad Request).');

    // Valid OTP reset test
    const resetRes = await request('/api/auth/forgot-password/verify-otp', {
      method: 'POST',
      body: { identifier: 'superadmin', otp: testOtp, newPassword: 'superadmin123' },
    });
    if (!resetRes.ok) {
      throw new Error(`Failed to reset password with valid OTP: ${JSON.stringify(resetRes.data)}`);
    }
    console.log('✓ Password reset successfully with OTP.');

    // Confirm login works with the password
    const reLogin = await request('/api/login', {
      method: 'POST',
      body: { username: 'superadmin', password: 'superadmin123' },
    });
    if (!reLogin.ok || !reLogin.data.token) {
      throw new Error('Login failed after OTP password reset');
    }
    console.log('✓ Login verified after OTP password reset.');

    // 14. Test Server-Side Reports Role Guard (Requirement 4)
    console.log('\n[14] Testing Server-Side Reports Authorization Guard...');
    
    // Unauthenticated access
    const unauthReports = await request('/api/reports?type=monthly');
    if (unauthReports.status !== 401) {
      throw new Error(`Expected 401 for unauthenticated /api/reports, got: ${unauthReports.status}`);
    }
    console.log('✓ Unauthenticated request to /api/reports rejected (401 Unauthorized).');

    // Super Admin access
    const adminReports = await request('/api/reports?type=monthly', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!adminReports.ok || !Array.isArray(adminReports.data.headers) || !Array.isArray(adminReports.data.rows)) {
      throw new Error(`Super Admin failed to access /api/reports: ${JSON.stringify(adminReports.data)}`);
    }
    console.log(`✓ Super Admin granted access to /api/reports (${adminReports.data.rows.length} rows returned).`);

    // Warden access: MUST BE 403 Forbidden!
    const wardenReports = await request('/api/reports?type=monthly', {
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (wardenReports.status !== 403) {
      throw new Error(`CRITICAL: Warden access to /api/reports was NOT blocked! Status: ${wardenReports.status}`);
    }
    console.log(`✓ CONFIRMED: Warden access to /api/reports strictly blocked by backend guard (403 Forbidden: "${wardenReports.data.error}").`);

    console.log('\n====================================');
    console.log(' ALL VERIFICATION CHECKS PASSED! ✓');
    console.log('====================================\n');
  } finally {
    if (server) server.close();
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongod) await mongod.stop();
  }
}

run().catch((err) => {
  console.error('\n❌ Verification Failed:', err);
  process.exit(1);
});
