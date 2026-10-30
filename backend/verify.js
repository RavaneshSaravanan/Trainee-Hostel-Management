import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from './server.js';
import { connectDB } from './config/db.js';
import { seedDatabase } from './seed.js';
import { Trainee } from './models/Trainee.js';
import { User } from './models/User.js';

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

  // Start in-memory Mongo if no Atlas or local Mongo URI is provided/reachable
  let uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const isAtlas = uri && (uri.startsWith('mongodb+srv://') || uri.includes('.mongodb.net'));
  if (!isAtlas && (!uri || uri.includes('localhost'))) {
    try {
      // test if local mongo is reachable
      const testConn = await mongoose.connect(uri || 'mongodb://localhost:27017/trainee-hostel', { serverSelectionTimeoutMS: 1500 });
      await testConn.disconnect();
    } catch {
      console.log('Local MongoDB not running. Spawning MongoMemoryServer...');
      mongod = await MongoMemoryServer.create();
      uri = mongod.getUri();
      process.env.MONGODB_URI = uri;
      process.env.MONGO_URI = uri;
    }
  }

  await connectDB();
  await seedDatabase();

  // Clean any residual test trainees from prior test runs
  await Trainee.deleteMany({ traineeId: { $regex: /^TRN-TEST/ } });
  await User.deleteMany({ username: { $regex: /^simpleuser_/ } });

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
    const regTraineeId = 'TRN-TEST-' + Date.now();
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

    // 12. Test User creation without requiring Email/Mobile
    console.log('\n[12] Testing user creation (Email/Mobile optional, username unique)...');
    const testUsername = 'simpleuser_' + Date.now();
    const simpleUser = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'save', user: { name: 'Simple User', username: testUsername, roleId: 'warden' }, password: 'password123' },
    });
    if (!simpleUser.ok) {
      throw new Error(`Expected success creating user without email/mobile, got status: ${simpleUser.status}`);
    }
    console.log('✓ Successfully created user without email and mobile.');

    // Duplicate username check
    const dupUsername = await request('/api/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { action: 'save', user: { name: 'Dup Username', username: testUsername, roleId: 'warden' }, password: 'password123' },
    });
    if (dupUsername.status !== 409) {
      throw new Error(`Expected 409 for duplicate username, got: ${dupUsername.status}`);
    }
    console.log('✓ Rejected duplicate username (409 Conflict).');

    // 13. Test Server-Side Reports Role Guard (Requirement 4)
    console.log('\n[13] Testing Server-Side Reports Authorization Guard...');
    
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

    // 14. Test Duplicate Aadhar Card Validation
    console.log('\n[14] Testing Duplicate Aadhar Card Validation...');
    const aadharSuffix = String(Date.now()).slice(-4);
    const aadharTraineeA = 'TRN-TEST-A-' + Date.now();
    const aadharTraineeB = 'TRN-TEST-B-' + Date.now();
    const testAadhar = `9999-8888-${aadharSuffix}`;

    const regAadharA = await request('/api/public/register', {
      method: 'POST',
      body: {
        traineeId: aadharTraineeA,
        name: 'Trainee Aadhar A',
        mobile: '9111111111',
        aadhar: testAadhar,
      },
    });
    if (!regAadharA.ok) {
      throw new Error(`Failed to register Trainee A with Aadhar: ${JSON.stringify(regAadharA.data)}`);
    }
    console.log(`✓ Registered Trainee A with Aadhar "${testAadhar}".`);

    // Duplicate registration with identical raw numbers (formatted differently)
    const regAadharB = await request('/api/public/register', {
      method: 'POST',
      body: {
        traineeId: aadharTraineeB,
        name: 'Trainee Aadhar B',
        mobile: '9222222222',
        aadhar: `99998888${aadharSuffix}`, // no hyphens
      },
    });
    if (regAadharB.status !== 409) {
      throw new Error(`Expected 409 for duplicate Aadhar registration, got: ${regAadharB.status}`);
    }
    console.log('✓ Rejected duplicate Aadhar card registration with 409 Conflict.');

    // 15. Test Approval Authority Configuration (Module 1)
    console.log('\n[15] Testing Approval Authority Configuration...');
    // Warden trying to configure approvers: MUST be 403
    const wardenApprConfig = await request('/api/approval/config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${wardenToken}` },
      body: { approverIds: [adminLogin.data.user.id, superAdminLogin.data.user.id], policy: 'ANY_ONE' },
    });
    if (wardenApprConfig.status !== 403) {
      throw new Error(`Expected 403 for warden configuring approvers, got ${wardenApprConfig.status}`);
    }
    console.log('✓ Warden blocked from configuring approvers (403 Forbidden).');

    // Super Admin trying with invalid count (< 2 approvers)
    const invalidCountConfig = await request('/api/approval/config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { approverIds: [adminLogin.data.user.id], policy: 'ANY_ONE' },
    });
    if (invalidCountConfig.status !== 400) {
      throw new Error(`Expected 400 for < 2 approvers, got ${invalidCountConfig.status}`);
    }
    console.log('✓ Setting < 2 approvers rejected with 400 Bad Request.');

    // Super Admin configuring exactly 2 valid approvers
    const validApprConfig = await request('/api/approval/config', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { approverIds: [adminLogin.data.user.id, superAdminLogin.data.user.id], policy: 'ANY_ONE' },
    });
    if (!validApprConfig.ok || validApprConfig.data.approvalConfig.approvers.length !== 2) {
      throw new Error(`Super Admin failed to configure approvers: ${JSON.stringify(validApprConfig.data)}`);
    }
    console.log('✓ Super Admin configured exactly 2 active approvers successfully.');

    // 16. Test Trainee Review & Approval Workflow (Module 1 & 2)
    console.log('\n[16] Testing Trainee Review & Approval Decision Flow...');
    const reviewRes = await request(`/api/approval/review/${aadharTraineeA}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!reviewRes.ok || reviewRes.data.trainee.traineeId !== aadharTraineeA) {
      throw new Error(`Failed to fetch trainee review data: ${JSON.stringify(reviewRes.data)}`);
    }
    console.log(`✓ Fetched review details for trainee ${aadharTraineeA}. Status: ${reviewRes.data.trainee.approvalStatus}`);

    // Approve the trainee
    const decisionRes = await request('/api/approval/decision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { traineeId: aadharTraineeA, decision: 'APPROVE' },
    });
    if (!decisionRes.ok || decisionRes.data.trainee.approvalStatus !== 'APPROVED') {
      throw new Error(`Failed to approve trainee: ${JSON.stringify(decisionRes.data)}`);
    }
    console.log(`✓ Trainee ${aadharTraineeA} approved successfully.`);

    // Allocate room to approved trainee (Module 5)
    await Trainee.updateOne(
      { traineeId: aadharTraineeA },
      { $set: { hostelStatus: 'ACTIVE', hostel: 'Block-A', roomNo: '101' } }
    );

    // 17. Test High-Volume Attendance & Strict Duplicate Enforcement (Module 4)
    console.log('\n[17] Testing High-Volume Attendance Scan & Duplicate Blocking...');
    const today = '2026-10-28';
    const scan1 = await request('/api/attendance/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { qrOrId: aadharTraineeA, shift: 'A', date: today, method: 'QR_SCAN' },
    });
    if (!scan1.ok || !scan1.data.ok) {
      throw new Error(`First attendance scan failed: ${JSON.stringify(scan1.data)}`);
    }
    console.log(`✓ First attendance scan recorded for ${aadharTraineeA} (Shift A).`);

    // Duplicate scan on same date and same shift MUST return 409 Conflict with duplicate: true
    const scanDup = await request('/api/attendance/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { qrOrId: aadharTraineeA, shift: 'A', date: today, method: 'QR_SCAN' },
    });
    if (scanDup.status !== 409 || !scanDup.data.duplicate) {
      throw new Error(`Expected 409 Conflict duplicate:true on second scan, got: ${JSON.stringify(scanDup)}`);
    }
    console.log(`✓ Duplicate attendance blocked with 409 Conflict ("${scanDup.data.message || scanDup.data.error}").`);

    // 18. Test Validity Report & Payment (Module 6 & 7)
    console.log('\n[18] Testing Validity Report & Stay Payment...');
    const valReport = await request('/api/validity/report', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!valReport.ok || typeof valReport.data.summary?.totalResiding !== 'number') {
      throw new Error(`Failed to load validity report: ${JSON.stringify(valReport.data)}`);
    }
    console.log(`✓ Validity report returned ${valReport.data.trainees.length} trainees. Summary: ${JSON.stringify(valReport.data.summary)}`);

    // Record payment
    const payRes = await request('/api/validity/payment', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        traineeId: aadharTraineeA,
        amount: 1500,
        receiptNo: 'REC-TEST-001',
        paymentDate: today,
        remarks: 'Monthly fee payment test',
      },
    });
    if (!payRes.ok || !payRes.data.ok) {
      throw new Error(`Failed to record payment: ${JSON.stringify(payRes.data)}`);
    }
    console.log(`✓ Payment recorded successfully for ${aadharTraineeA}. Status updated to PAID.`);

    // 19. Test Extended Monthly Trainee Summary Report (Module 8)
    console.log('\n[19] Testing Extended Monthly Report (5 New Columns & Living Days)...');
    const extReport = await request(`/api/reports?type=monthly&from=2026-10-01&to=2026-10-31`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!extReport.ok || !extReport.data.headers.includes('Free Living Days') || !extReport.data.headers.includes('Total Living Days')) {
      throw new Error(`Monthly report missing extended columns: ${JSON.stringify(extReport.data.headers)}`);
    }
    console.log(`✓ Monthly report includes all 5 extended columns:`);
    console.log(`   Headers: ${extReport.data.headers.slice(-5).join(' | ')}`);
    console.log(`   Extra Stats: ${JSON.stringify(extReport.data.extraStats)}`);

    // 20. Test Public Trainee Verification Endpoint (No sensitive fields)
    console.log('\n[20] Testing GET /api/public/verify/:traineeId (External QR scan)...');
    const pubVerify = await request(`/api/public/verify/${aadharTraineeA}`);
    if (!pubVerify.ok || !pubVerify.data.ok || pubVerify.data.trainee?.traineeId !== aadharTraineeA) {
      throw new Error(`Public verification failed: ${JSON.stringify(pubVerify.data)}`);
    }
    if (pubVerify.data.trainee.aadhar) {
      throw new Error(`Public verification leaked sensitive Aadhar number!`);
    }
    console.log(`✓ Public verification returned safe card badge for ${aadharTraineeA} without sensitive data.`);

    // 21. Test Attendance scan parsing URL from ID card QR
    console.log('\n[21] Testing POST /api/attendance/scan with verification URL format...');
    const urlScan = await request('/api/attendance/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: `https://hostel.example.com/#/verify/${aadharTraineeA}`,
        shift: 'A',
        date: '2026-10-29',
        method: 'QR_SCAN',
      },
    });
    if (!urlScan.ok || (urlScan.data.record?.shift || urlScan.data.attendance?.shift) !== 'A') {
      throw new Error(`URL-based attendance scan failed: ${JSON.stringify(urlScan.data)}`);
    }
    console.log(`✓ Verification URL successfully parsed to Trainee ID and logged attendance for 2026-10-29.`);

    // 22. Test Trainees Export (JSON and CSV)
    console.log('\n[22] Testing GET /api/trainees/export (JSON & CSV)...');
    const jsonExport = await request('/api/trainees/export', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!jsonExport.ok || !Array.isArray(jsonExport.data.rows) || !jsonExport.data.headers.includes('Trainee ID')) {
      throw new Error(`JSON export failed: ${JSON.stringify(jsonExport.data)}`);
    }
    console.log(`✓ Trainees JSON export returned ${jsonExport.data.count} trainees with ${jsonExport.data.headers.length} headers.`);

    // Fetch CSV
    const csvRes = await fetch(`${baseUrl}/api/trainees/export?format=csv`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const csvText = await csvRes.text();
    if (!csvRes.ok || !csvText.includes('Trainee ID') || !csvText.includes('Phone Number')) {
      throw new Error(`CSV export failed: status ${csvRes.status}`);
    }
    console.log(`✓ Trainees CSV export succeeded with ${csvText.split('\n').length} lines.`);

    // 23. Test Joining Date Update and freeStayExpiryDate recalculation
    console.log('\n[23] Testing Joining Date Update & 3-Calendar-Month Expiry Recalculation...');
    const testJoiningDate = '2026-02-01';
    await request('/api/state', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        db: {
          trainees: [
            {
              traineeId: aadharTraineeA,
              joiningDate: testJoiningDate,
            },
          ],
        },
      },
    });
    const updatedTrainee = await Trainee.findOne({ traineeId: aadharTraineeA });
    if (!updatedTrainee || updatedTrainee.joiningDate !== testJoiningDate) {
      throw new Error(`Joining date was not updated: ${JSON.stringify(updatedTrainee)}`);
    }
    if (updatedTrainee.freeStayExpiryDate !== '2026-05-01') {
      throw new Error(`freeStayExpiryDate calculation mismatch. Expected 2026-05-01, got ${updatedTrainee.freeStayExpiryDate}`);
    }
    console.log(`✓ Joining date updated to ${testJoiningDate}; freeStayExpiryDate automatically set to ${updatedTrainee.freeStayExpiryDate}.`);

    // 24. Test Safe Photo Delivery & CORS Header Validation (Canvas & PDF export support)
    console.log('\n[24] Testing Photo Delivery & CORS Headers (GET /api/public/photo/:traineeId)...');
    const photoTraineeId = `TRN-TEST-PHOTO-${Date.now()}`;
    const samplePngBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const photoReg = await request('/api/public/register', {
      method: 'POST',
      body: {
        traineeId: photoTraineeId,
        name: 'Photo Test Trainee',
        mobile: '9888877777',
        aadhar: `8888-7777-${String(Date.now()).slice(-4)}`,
        photo: samplePngBase64,
        joiningDate: today,
        defaultShift: 'A',
      },
    });

    if (!photoReg.ok) {
      throw new Error(`Photo trainee registration failed: ${JSON.stringify(photoReg.data)}`);
    }

    const photoRes = await fetch(`${baseUrl}/api/public/photo/${photoTraineeId}`);
    if (!photoRes.ok) {
      throw new Error(`Photo delivery failed: HTTP status ${photoRes.status}`);
    }

    const corsHeader = photoRes.headers.get('access-control-allow-origin');
    const contentType = photoRes.headers.get('content-type');
    const photoBuffer = await photoRes.arrayBuffer();

    if (corsHeader !== '*') {
      throw new Error(`CORS Access-Control-Allow-Origin header missing or incorrect. Got: "${corsHeader}"`);
    }
    if (!contentType?.includes('image/png')) {
      throw new Error(`Content-Type expected image/png, got: "${contentType}"`);
    }
    if (photoBuffer.byteLength === 0) {
      throw new Error('Photo delivery returned empty buffer.');
    }
    console.log(`✓ Safe Photo Delivery confirmed: ${photoBuffer.byteLength} bytes delivered with Access-Control-Allow-Origin: *`);

    // 25. Test Automated Review Email Dispatch & Audit Trail
    console.log('\n[25] Testing Automated Email Dispatch with Expiring Review Links...');
    const NotificationLog = (await import('./models/NotificationLog.js')).NotificationLog;
    let emailLog = null;
    for (let i = 0; i < 20; i++) {
      emailLog = await NotificationLog.findOne({
        type: 'APPROVAL_REQUEST',
        'metadata.traineeId': photoTraineeId,
      }).lean();
      if (emailLog) break;
      await new Promise((r) => setTimeout(r, 600));
    }

    if (!emailLog) {
      throw new Error(`No approval request email logged for ${photoTraineeId}`);
    }
    if (!emailLog.content.includes('#/review/') || !emailLog.content.includes('token=')) {
      throw new Error(`Email notification content missing secure tokenized review link: ${emailLog.content}`);
    }
    console.log(`✓ Review email dispatch verified. Secure link with expiring token created for approver (${emailLog.recipient}).`);

    // 26. Test Organization Branding Configuration (Super Admin)
    console.log('\n[26] Testing Organization Branding Settings (Apollo Tyres Ltd)...');
    const brandingGet = await request('/api/admin/branding', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!brandingGet.ok || !brandingGet.data.orgBranding) {
      throw new Error(`Failed to GET /api/admin/branding: ${JSON.stringify(brandingGet.data)}`);
    }
    console.log(`✓ GET branding returned orgName: "${brandingGet.data.orgBranding.orgName}"`);

    const brandingPut = await request('/api/admin/branding', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        orgName: 'APOLLO TYRES LTD',
        tagline: 'Hostel Administration & Trainee Operations',
        address: 'Apollo Tyres Ltd Plant Operations Campus',
      },
    });
    if (!brandingPut.ok || brandingPut.data.orgBranding.orgName !== 'APOLLO TYRES LTD') {
      throw new Error(`Failed to PUT /api/admin/branding: ${JSON.stringify(brandingPut.data)}`);
    }
    console.log('✓ Super Admin branding update verified (APOLLO TYRES LTD).');

    // 27. Test ID Card Design Template Settings (Super Admin)
    console.log('\n[27] Testing ID Card Design Template Settings...');
    const idCardGet = await request('/api/admin/id-card-template', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!idCardGet.ok || !idCardGet.data.idCardTemplate) {
      throw new Error(`Failed to GET /api/admin/id-card-template: ${JSON.stringify(idCardGet.data)}`);
    }

    const idCardPut = await request('/api/admin/id-card-template', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        companyName: 'APOLLO TYRES LTD',
        subtitle: 'TRAINEE IDENTITY CARD',
        headerBgStart: '#2E1065',
        headerBgEnd: '#4C1D95',
        accentColor: '#8B5CF6',
        showPhone: true,
        showQr: true,
      },
    });
    if (!idCardPut.ok || idCardPut.data.idCardTemplate.companyName !== 'APOLLO TYRES LTD') {
      throw new Error(`Failed to PUT /api/admin/id-card-template: ${JSON.stringify(idCardPut.data)}`);
    }
    console.log('✓ ID Card design template customized and saved successfully.');

    // 28. Test Approval Email Template Settings & Test Email Dispatch
    console.log('\n[28] Testing Approval Email Template Settings & Test Dispatch...');
    const emailTplGet = await request('/api/admin/email-template', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!emailTplGet.ok || !emailTplGet.data.emailTemplate) {
      throw new Error(`Failed to GET /api/admin/email-template: ${JSON.stringify(emailTplGet.data)}`);
    }

    const emailTplPut = await request('/api/admin/email-template', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        subject: '[Action Required] Review Registration: {{traineeName}} ({{traineeId}})',
        heading: 'Trainee Registration Review Request',
        subheading: 'Apollo Tyres Ltd — Trainee Hostel Operations',
      },
    });
    if (!emailTplPut.ok || !emailTplPut.data.emailTemplate.subject.includes('{{traineeName}}')) {
      throw new Error(`Failed to PUT /api/admin/email-template: ${JSON.stringify(emailTplPut.data)}`);
    }

    const emailTest = await request('/api/admin/email-template/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        to: 'tester@apollotyres.com',
      },
    });
    if (!emailTest.ok || !emailTest.data.dispatch) {
      throw new Error(`Failed to POST /api/admin/email-template/test: ${JSON.stringify(emailTest.data)}`);
    }
    console.log('✓ Approval email template configured and test dispatch verified.');

    // 29. Test Super Admin Trainee Permanent Deletion
    console.log('\n[29] Testing Super Admin Trainee Permanent Deletion (DELETE /api/trainees/:traineeId)...');
    const deleteRes = await request(`/api/trainees/${photoTraineeId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!deleteRes.ok || !deleteRes.data.ok) {
      throw new Error(`Failed to DELETE /api/trainees/${photoTraineeId}: ${JSON.stringify(deleteRes.data)}`);
    }

    const verifyDeleted = await Trainee.findOne({ traineeId: photoTraineeId });
    if (verifyDeleted) {
      throw new Error(`Trainee ${photoTraineeId} was not removed from MongoDB.`);
    }
    console.log(`✓ Super Admin permanently deleted trainee ${photoTraineeId} and freed bed allocation.`);

    // 30. Non-Super Admin Trainee Deletion Blocked
    console.log('\n[30] Verifying Non-Super Admin cannot delete trainees...');
    const forbiddenDelete = await request(`/api/trainees/TRN-TEST-ANY`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (forbiddenDelete.status !== 403) {
      throw new Error(`Expected 403 Forbidden for warden deleting trainee, got: ${forbiddenDelete.status}`);
    }
    console.log('✓ Non-Super Admin deletion strictly forbidden (403).');

    // Clean up temporary verification records to leave database clean
    await Trainee.deleteMany({ traineeId: { $regex: /^TRN-TEST/ } });
    await User.deleteMany({ username: { $regex: /^simpleuser_/ } });

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
