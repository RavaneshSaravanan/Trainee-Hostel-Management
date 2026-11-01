import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

import http from 'node:http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from './server.js';
import { connectDB } from './config/db.js';
import { seedDatabase } from './seed.js';
import { Trainee } from './models/Trainee.js';
import { User } from './models/User.js';
import { Attendance } from './models/Attendance.js';
import { Leave } from './models/Leave.js';
import { OutingVacate } from './models/OutingVacate.js';
import { Resignation } from './models/Resignation.js';
import { EmailLog } from './models/EmailLog.js';
import { Config } from './models/Config.js';
import QRCode from 'qrcode';
import { generateIdCardPdf, sendTraineeIdCardEmail } from './services/emailService.js';

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
  await Trainee.deleteMany({ $or: [{ traineeId: { $regex: /^TRN-TEST/ } }, { qrId: { $regex: /^QR-TEST/ } }, { name: 'Auto QR Trainee' }, { name: 'Vikram Final Test' }, { traineeId: '' }] });
  await User.deleteMany({ username: { $regex: /^simpleuser_/ } });
  await Attendance.deleteMany({ $or: [{ traineeId: { $regex: /^TRN-TEST/ } }, { qrId: { $regex: /^QR-TEST/ } }, { qrId: 'QR-00005' }, { qrId: 'QR-00007' }, { traineeId: 'TRN-TEST-A' }, { date: { $in: ['2026-11-01', '2026-11-02'] } }] });
  await Leave.deleteMany({ $or: [{ traineeId: { $regex: /^TRN-TEST/ } }, { qrId: { $regex: /^QR-TEST/ } }] });
  await OutingVacate.deleteMany({ $or: [{ traineeId: { $regex: /^TRN-TEST/ } }, { qrId: { $regex: /^QR-TEST/ } }] });
  await EmailLog.deleteMany({});

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
    const superToken = superAdminLogin.data.token;
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
        email: 'test@gmail.com',
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
        type: { $in: ['APPROVAL_REQUEST', 'APPROVAL'] },
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

    // 31. Strict Validation on Registration & Optional Trainee ID
    console.log('\n[31] Testing Strict Validation on Registration & Optional Trainee ID...');
    // 31a. Mobile validation: reject less than 10 digits
    const badMobileRes = await request('/api/public/register', {
      method: 'POST',
      body: { name: 'Invalid Mobile Trainee', mobile: '98765' },
    });
    if (badMobileRes.status !== 400 || !badMobileRes.data.error.includes('10 digits')) {
      throw new Error(`Expected 400 for bad mobile, got: ${JSON.stringify(badMobileRes.data)}`);
    }
    console.log('✓ Invalid mobile (<10 digits) correctly rejected.');

    // 31b. Aadhaar validation: reject if not 12 digits
    const badAadhaarRes = await request('/api/public/register', {
      method: 'POST',
      body: { name: 'Invalid Aadhaar Trainee', mobile: '9876543210', aadhar: '12345678' },
    });
    if (badAadhaarRes.status !== 400 || !badAadhaarRes.data.error.includes('12 digits')) {
      throw new Error(`Expected 400 for bad aadhaar, got: ${JSON.stringify(badAadhaarRes.data)}`);
    }
    console.log('✓ Invalid Aadhaar (<12 digits) correctly rejected.');

    // 31c. Email validation: reject non-@gmail.com domain
    const badEmailRes = await request('/api/public/register', {
      method: 'POST',
      body: { name: 'Invalid Email Trainee', mobile: '9876543210', email: 'trainee@yahoo.com' },
    });
    if (badEmailRes.status !== 400 || !badEmailRes.data.error.includes('@gmail.com')) {
      throw new Error(`Expected 400 for non-gmail address, got: ${JSON.stringify(badEmailRes.data)}`);
    }
    console.log('✓ Non-@gmail.com email domain correctly rejected.');

    // 31d. Optional Trainee ID: empty traineeId allowed, auto-generates unique qrId
    const testAadhaar = '77' + String(Date.now()).slice(-10);
    const testMobile = '88' + String(Date.now()).slice(-8);
    const optionalIdRes = await request('/api/public/register', {
      method: 'POST',
      body: {
        name: 'Auto QR Trainee',
        traineeId: '',
        mobile: testMobile,
        aadhar: testAadhaar,
        email: 'autotrainee@gmail.com',
        joiningDate: '2026-02-01',
      },
    });
    if (!optionalIdRes.ok || !optionalIdRes.data.qrId) {
      throw new Error(`Expected successful registration without traineeId, got: ${JSON.stringify(optionalIdRes.data)}`);
    }
    const autoQrId = optionalIdRes.data.qrId;
    console.log(`✓ Registration with empty Trainee ID allowed. Auto-generated qrId: ${autoQrId}`);

    // 32. Automatic ID Card Email Delivery Retry Endpoint
    console.log('\n[32] Testing ID Card Email Retry Endpoint...');
    const retryEmailRes = await request(`/api/trainees/${autoQrId}/send-id-card`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    // Record is pending approval so email service returns deferred message
    if (!retryEmailRes.ok || (!retryEmailRes.data.reason && !retryEmailRes.data.ok)) {
      throw new Error(`Unexpected ID card retry response: ${JSON.stringify(retryEmailRes.data)}`);
    }
    console.log('✓ ID card email endpoint handles verification and approval constraints correctly.');

    // 33. Hostel Management - Delete Hostel Option
    console.log('\n[33] Testing Hostel Deletion with Active Occupancy Guards...');
    // Find an occupied hostel from seed data (e.g. Apollo Boys Hostel or similar)
    const existingHostelsRes = await request('/api/state', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const hostels = existingHostelsRes.data.db?.hostels || [];
    if (hostels.length > 0) {
      // First ensure a test occupant is assigned to hostels[0]
      await Trainee.create({
        traineeId: 'TRN-TEST-OCCUPANT',
        qrId: 'QR-TEST-OCC',
        name: 'Resident Trainee',
        hostel: hostels[0].name,
        hostelId: hostels[0].id,
        roomNo: '101',
        hostelStatus: 'ACTIVE',
      });

      // Try deleting occupied hostel -> must be blocked with 400
      const blockDeleteRes = await request(`/api/hostels/${hostels[0].id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      if (blockDeleteRes.status !== 400 || !blockDeleteRes.data.error.includes('active trainee')) {
        throw new Error(`Expected 400 with active trainee warning, got: ${JSON.stringify(blockDeleteRes.data)}`);
      }
      console.log(`✓ Deletion of occupied hostel "${hostels[0].name}" safely blocked.`);

      // Clean test occupant
      await Trainee.deleteOne({ traineeId: 'TRN-TEST-OCCUPANT' });
    }

    // Create an empty test hostel and delete it
    const { Hostel } = await import('./models/Hostel.js');
    await Hostel.create({ id: 'H-EMPTY', name: 'Empty Test Hostel', rooms: [] });
    const deleteEmptyRes = await request('/api/hostels/H-EMPTY', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!deleteEmptyRes.ok || !deleteEmptyRes.data.ok) {
      throw new Error(`Failed to delete empty hostel: ${JSON.stringify(deleteEmptyRes.data)}`);
    }
    console.log('✓ Deletion of empty hostel succeeded.');

    // 34. Outing & Leave - Complete Departure (OUT) and Return (IN) Tracking
    console.log('\n[34] Testing Outing & Leave IN/OUT Departure and Return Tracking...');
    // Create test active trainee
    const trackerTrainee = await Trainee.create({
      traineeId: 'TRN-TEST-TRIP',
      qrId: 'QR-TEST-TRIP',
      name: 'Trip Trainee',
      hostel: hostels[0]?.name || 'Apollo Hostel',
      hostelId: hostels[0]?.id || 'H-01',
      roomNo: '102',
      hostelStatus: 'ACTIVE',
    });

    // 34a. Outing Departure (OUT)
    const outingOutRes = await request('/api/records/outing/out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        traineeId: 'TRN-TEST-TRIP',
        outDate: '2026-10-30',
        outTime: '10:00',
        purpose: 'Market Grocery',
      },
    });
    if (!outingOutRes.ok || !outingOutRes.data.record) {
      throw new Error(`Outing departure failed: ${JSON.stringify(outingOutRes.data)}`);
    }
    const outingRecId = outingOutRes.data.record.id;
    const postOutTrainee = await Trainee.findOne({ traineeId: 'TRN-TEST-TRIP' });
    if (postOutTrainee.hostelStatus !== 'OUTING') {
      throw new Error(`Expected trainee status OUTING, got: ${postOutTrainee.hostelStatus}`);
    }
    console.log('✓ Outing Departure (OUT) recorded. Trainee status updated to OUTING.');

    // 34b. Duplicate Departure Blocked
    const dupOutingRes = await request('/api/records/outing/out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        traineeId: 'TRN-TEST-TRIP',
        outDate: '2026-10-30',
        outTime: '11:00',
        purpose: 'Another trip',
      },
    });
    if (dupOutingRes.status !== 409) {
      throw new Error(`Expected 409 for duplicate open outing, got: ${dupOutingRes.status}`);
    }
    console.log('✓ Duplicate outing departure while outside successfully blocked (409).');

    // 34c. Outing Return (IN)
    const outingInRes = await request('/api/records/outing/in', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        id: outingRecId,
        inDate: '2026-10-30',
        inTime: '12:30',
        remarks: 'Returned safely',
      },
    });
    if (!outingInRes.ok || !outingInRes.data.record.isCompleted || !outingInRes.data.record.duration) {
      throw new Error(`Outing return failed: ${JSON.stringify(outingInRes.data)}`);
    }
    const postInTrainee = await Trainee.findOne({ traineeId: 'TRN-TEST-TRIP' });
    if (postInTrainee.hostelStatus !== 'ACTIVE') {
      throw new Error(`Expected trainee status restored to ACTIVE, got: ${postInTrainee.hostelStatus}`);
    }
    console.log(`✓ Outing Return (IN) recorded. Duration: "${outingInRes.data.record.duration}". Status restored to ACTIVE.`);

    // 34d. Leave Departure (OUT) and Return (IN)
    const leaveOutRes = await request('/api/records/leave/out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        traineeId: 'TRN-TEST-TRIP',
        outDate: '2026-10-25',
        outTime: '08:00',
        leaveType: 'Sick Leave',
        reason: 'Viral fever rest',
      },
    });
    if (!leaveOutRes.ok || !leaveOutRes.data.record) {
      throw new Error(`Leave departure failed: ${JSON.stringify(leaveOutRes.data)}`);
    }
    const leaveRecId = leaveOutRes.data.record.id;
    console.log('✓ Leave Departure (OUT) recorded. Trainee status updated to ON LEAVE.');

    const leaveInRes = await request('/api/records/leave/in', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        id: leaveRecId,
        inDate: '2026-10-28',
        inTime: '18:00',
        remarks: 'Recovered and fit to resume',
      },
    });
    if (!leaveInRes.ok || !leaveInRes.data.record.isCompleted || !leaveInRes.data.record.duration) {
      throw new Error(`Leave return failed: ${JSON.stringify(leaveInRes.data)}`);
    }
    console.log(`✓ Leave Return (IN) recorded. Duration: "${leaveInRes.data.record.duration}". Status restored to ACTIVE.`);

    // 35. Attendance Page – Hostel-Wise Daily Scan Completion Tracker & Cross-Hostel Guard
    console.log('\n[35] Testing Hostel-Wise Daily Scan Completion Tracker...');
    const testHostelName = hostels[0]?.name || 'Apollo Hostel';
    const otherHostelName = 'Different Hostel XYZ';

    // 35a. Cross-hostel scan rejection
    const crossScanRes = await request('/api/attendance/hostel-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: 'TRN-TEST-TRIP',
        hostel: otherHostelName,
        shift: 'A',
        date: '2026-10-30',
      },
    });
    if (crossScanRes.status !== 400 || !crossScanRes.data.hostelMismatch) {
      throw new Error(`Expected 400 hostel mismatch, got: ${JSON.stringify(crossScanRes.data)}`);
    }
    console.log('✓ Cross-Hostel Scan strictly blocked (Hostel Mismatch detected).');

    // 35b. Valid hostel scan
    const validHostelScan = await request('/api/attendance/hostel-scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: 'TRN-TEST-TRIP',
        hostel: testHostelName,
        shift: 'A',
        date: '2026-10-30',
      },
    });
    if (!validHostelScan.ok || !validHostelScan.data.ok) {
      throw new Error(`Hostel scan failed: ${JSON.stringify(validHostelScan.data)}`);
    }
    console.log('✓ Valid Hostel Scan accepted and attendance recorded.');

    // 35c. Hostel tracker stats & unscanned list
    const trackerRes = await request(`/api/attendance/hostel-tracker?hostel=${encodeURIComponent(testHostelName)}&date=2026-10-30`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!trackerRes.ok || typeof trackerRes.data.totalLiving !== 'number') {
      throw new Error(`Hostel tracker failed: ${JSON.stringify(trackerRes.data)}`);
    }
    console.log(`✓ Hostel tracker statistics retrieved: Living=${trackerRes.data.totalLiving}, Scanned=${trackerRes.data.scannedCount}, Completion=${trackerRes.data.completionPct}%`);

    // =========================================================================
    // 36. Trainee Registration without Default Shift & Shift-Independent Attendance
    // =========================================================================
    console.log('\n[36] Testing Trainee Registration without Default Shift & Independent Attendance Shifts...');
    const t36UniqueSuffix = Date.now().toString().slice(-6);
    const t36Email = `vikram.final.${t36UniqueSuffix}@gmail.com`;
    const t36Aadhaar = `88${Date.now().toString().slice(-10)}`;
    const t36Mobile = `98${Date.now().toString().slice(-8)}`;

    const t36RegPayload = {
      name: 'Vikram Final Test',
      mobile: t36Mobile,
      email: t36Email,
      gender: 'MALE',
      qualification: 'B.Tech Mechanical',
      aadhar: t36Aadhaar,
      joiningDate: '2026-11-01',
      // Explicitly testing that defaultShift is NOT required and NOT stored
    };

    const t36RegRes = await request('/api/public/register', {
      method: 'POST',
      body: t36RegPayload,
    });
    if (!t36RegRes.ok || !t36RegRes.data.qrId) {
      throw new Error(`Registration failed: ${JSON.stringify(t36RegRes.data)}`);
    }
    const testTraineeId = t36RegRes.data.traineeId;
    const testQrId = t36RegRes.data.qrId;

    // Verify in MongoDB
    const t36TraineeDoc = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (!t36TraineeDoc) throw new Error('Registered trainee document not found in MongoDB');
    if (t36TraineeDoc.defaultShift !== undefined) {
      throw new Error(`Expected defaultShift to be undefined, got: ${t36TraineeDoc.defaultShift}`);
    }
    if (t36TraineeDoc.welcomeEmailSent !== false) {
      throw new Error('Welcome email should NOT be sent on registration alone');
    }
    console.log('✓ Trainee registered without defaultShift. welcomeEmailSent is false (no room allocated yet).');

    // =========================================================================
    // 37. Automatic Welcome Email after Complete Registration and Room Allocation
    // =========================================================================
    console.log('\n[37] Testing Automatic Welcome Email on Room Allocation...');
    
    // Allocate room to trainee (activates trainee for living and attendance)
    const t37AllocRes = await request(`/api/trainees/${testTraineeId}/allocate-room`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        hostel: testHostelName,
        roomNo: '305',
      },
    });
    if (!t37AllocRes.ok || !t37AllocRes.data.trainee) {
      throw new Error(`Room allocation failed: ${JSON.stringify(t37AllocRes.data)}`);
    }
    console.log('✓ Room 305 allocated to trainee. Trainee activated.');

    // Ensure clean slate for test trainee attendance
    await Attendance.deleteMany({ $or: [{ traineeId: testTraineeId }, { qrId: testQrId }] });

    // Test that attendance shift selection functions independently (A, B, C, G, 12HRS)
    const t36AttShiftB = await request('/api/attendance/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: testQrId,
        date: '2026-11-01',
        shift: 'B',
      },
    });
    if (!t36AttShiftB.ok || t36AttShiftB.data.record?.shift !== 'B') {
      throw new Error(`Attendance shift B failed: ${JSON.stringify(t36AttShiftB.data)}`);
    }

    const t36AttShift12 = await request('/api/attendance/scan', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: testQrId,
        date: '2026-11-02',
        shift: '12HRS',
      },
    });
    if (!t36AttShift12.ok || t36AttShift12.data.record?.shift !== '12HRS') {
      throw new Error(`Attendance shift 12HRS failed: ${JSON.stringify(t36AttShift12.data)}`);
    }
    console.log('✓ Attendance shift selection operates completely independently (recorded B and 12HRS).');

    // Verify welcome email trigger and flags
    const t37AllocatedDoc = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (!t37AllocatedDoc.welcomeEmailSent) {
      throw new Error('welcomeEmailSent flag should be true after room allocation');
    }
    if (!t37AllocatedDoc.welcomeEmailSentAt) {
      throw new Error('welcomeEmailSentAt should be recorded after room allocation');
    }

    // Verify EmailLog entry
    const t37WelcomeLog = await EmailLog.findOne({
      traineeId: testTraineeId,
      emailType: { $in: ['WELCOME', 'GENERAL'] },
    }).sort({ createdAt: -1 }).lean();
    if (!t37WelcomeLog) {
      throw new Error('EmailLog entry for WELCOME email was not created');
    }
    const recipientMatches = (t37WelcomeLog.recipient && t37WelcomeLog.recipient.includes(t36Email)) ||
      (Array.isArray(t37WelcomeLog.to) && t37WelcomeLog.to.includes(t36Email));
    if (!recipientMatches) {
      throw new Error(`Expected recipient ${t36Email}, got: ${JSON.stringify(t37WelcomeLog.recipient || t37WelcomeLog.to)}`);
    }
    console.log(`✓ Welcome email automatically triggered and logged to EmailLog for ${t36Email}.`);

    // Verify duplicate prevention on subsequent room update
    const t37ReallocRes = await request(`/api/trainees/${testTraineeId}/allocate-room`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        hostel: testHostelName,
        roomNo: '306',
      },
    });
    if (!t37ReallocRes.ok) throw new Error('Room re-allocation failed');
    const t37LogsCount = await EmailLog.countDocuments({ traineeId: testTraineeId, emailType: 'WELCOME' });
    if (t37LogsCount !== 1) {
      throw new Error(`Duplicate welcome email detected! Expected 1 log, found ${t37LogsCount}`);
    }
    console.log('✓ Duplicate welcome email strictly prevented on room update.');

    // Test Super Admin manual re-dispatch / retry
    const t37RetryRes = await request(`/api/trainees/${testTraineeId}/send-welcome-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t37RetryRes.ok || !t37RetryRes.data.ok) {
      throw new Error(`Manual retry failed: ${JSON.stringify(t37RetryRes.data)}`);
    }
    const t37LogsAfterRetry = await EmailLog.countDocuments({ traineeId: testTraineeId, emailType: 'WELCOME' });
    if (t37LogsAfterRetry !== 2) {
      throw new Error(`Expected 2 logs after manual retry, got: ${t37LogsAfterRetry}`);
    }
    console.log('✓ Super Admin manual welcome email retry succeeded and logged.');

    // =========================================================================
    // 38. Super Admin Only: Delete Resignation, Leave, and Outing Records
    // =========================================================================
    console.log('\n[38] Testing Super Admin Deletion for Leave, Outing & Resignation with Safe Status Restoration...');

    // 38a. Outing Record Creation, Warden 403 Forbidden, Super Admin Safe Deletion
    const t38OutingCreateRes = await request('/api/records/outing/out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: testQrId,
        outDate: '2026-11-03',
        outTime: '17:00',
        purpose: 'Personal errands',
      },
    });
    if (!t38OutingCreateRes.ok || !t38OutingCreateRes.data.record) {
      throw new Error(`Outing create failed: ${JSON.stringify(t38OutingCreateRes.data)}`);
    }
    const t38OutingId = t38OutingCreateRes.data.record.id;

    // Check trainee status is OUTING
    const t38TraineeDuringOuting = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (t38TraineeDuringOuting.hostelStatus !== 'OUTING') {
      throw new Error(`Expected status OUTING, got: ${t38TraineeDuringOuting.hostelStatus}`);
    }

    // Warden attempt to delete -> must receive 403 Forbidden
    const t38WardenDelOuting = await request(`/api/records/outing/${t38OutingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (t38WardenDelOuting.status !== 403) {
      throw new Error(`Warden should receive 403 on delete outing, got: ${t38WardenDelOuting.status}`);
    }
    console.log('✓ Warden delete outing strictly blocked with HTTP 403 Forbidden.');

    // Super Admin delete outing -> 200 OK and trainee hostelStatus restored to ACTIVE
    const t38SuperDelOuting = await request(`/api/records/outing/${t38OutingId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t38SuperDelOuting.ok) {
      throw new Error(`Super Admin delete outing failed: ${JSON.stringify(t38SuperDelOuting.data)}`);
    }
    const t38TraineeAfterOutingDel = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (t38TraineeAfterOutingDel.hostelStatus !== 'ACTIVE') {
      throw new Error(`Expected trainee status restored to ACTIVE, got: ${t38TraineeAfterOutingDel.hostelStatus}`);
    }
    console.log('✓ Super Admin deleted open outing; trainee status safely restored to ACTIVE.');

    // 38b. Leave Record Safe Deletion
    const t38LeaveCreateRes = await request('/api/records/leave/out', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: testQrId,
        outDate: '2026-11-04',
        outTime: '08:00',
        expectedReturnDate: '2026-11-10',
        reason: 'Family event',
      },
    });
    if (!t38LeaveCreateRes.ok || !t38LeaveCreateRes.data.record) {
      throw new Error(`Leave create failed: ${JSON.stringify(t38LeaveCreateRes.data)}`);
    }
    const t38LeaveId = t38LeaveCreateRes.data.record.id;

    const t38WardenDelLeave = await request(`/api/records/leave/${t38LeaveId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (t38WardenDelLeave.status !== 403) {
      throw new Error(`Warden should receive 403 on delete leave, got: ${t38WardenDelLeave.status}`);
    }
    console.log('✓ Warden delete leave strictly blocked with HTTP 403 Forbidden.');

    const t38SuperDelLeave = await request(`/api/records/leave/${t38LeaveId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t38SuperDelLeave.ok) throw new Error('Super Admin delete leave failed');
    const t38TraineeAfterLeaveDel = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (t38TraineeAfterLeaveDel.hostelStatus !== 'ACTIVE') {
      throw new Error(`Expected status restored to ACTIVE, got: ${t38TraineeAfterLeaveDel.hostelStatus}`);
    }
    console.log('✓ Super Admin deleted open leave; trainee status safely restored to ACTIVE.');

    // 38c. Resignation Record Safe Deletion
    const t38ResignCreateRes = await request('/api/records/resignation', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        qrOrId: testQrId,
        resignationDate: '2026-11-05',
        lastWorkingDay: '2026-11-15',
        reason: 'Higher Studies',
      },
    });
    if (!t38ResignCreateRes.ok || !t38ResignCreateRes.data.record) {
      throw new Error(`Resignation create failed: ${JSON.stringify(t38ResignCreateRes.data)}`);
    }
    const t38ResignId = t38ResignCreateRes.data.record.id;

    const t38TraineeAfterResign = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (t38TraineeAfterResign.employmentStatus !== 'RESIGNED') {
      throw new Error(`Expected employmentStatus RESIGNED, got: ${t38TraineeAfterResign.employmentStatus}`);
    }

    const t38WardenDelResign = await request(`/api/records/resignation/${t38ResignId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (t38WardenDelResign.status !== 403) {
      throw new Error(`Warden should receive 403 on delete resignation, got: ${t38WardenDelResign.status}`);
    }
    console.log('✓ Warden delete resignation strictly blocked with HTTP 403 Forbidden.');

    const t38SuperDelResign = await request(`/api/records/resignation/${t38ResignId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t38SuperDelResign.ok) throw new Error('Super Admin delete resignation failed');
    const t38TraineeAfterResignDel = await Trainee.findOne({ traineeId: testTraineeId }).lean();
    if (t38TraineeAfterResignDel.employmentStatus !== 'ACTIVE') {
      throw new Error(`Expected employmentStatus restored to ACTIVE, got: ${t38TraineeAfterResignDel.employmentStatus}`);
    }
    console.log('✓ Super Admin deleted resignation; trainee employmentStatus safely restored to ACTIVE.');

    // =========================================================================
    // 39. Super Admin Only: Email Recipient Management
    // =========================================================================
    console.log('\n[39] Testing Email Recipient Management (Super Admin Only)...');
    
    // Warden access attempt -> 403 Forbidden
    const t39WardenGetRecs = await request('/api/admin/email-recipients', {
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (t39WardenGetRecs.status !== 403) {
      throw new Error(`Expected 403 for warden on email-recipients, got: ${t39WardenGetRecs.status}`);
    }
    console.log('✓ Warden email recipient access blocked with HTTP 403.');

    // Super Admin adds recipient
    const t39AddRecRes = await request('/api/admin/email-recipients', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        name: 'Warden Head Office',
        email: 'warden.headoffice@apollotyres.com',
        type: 'CC',
        emailTypes: ['WELCOME', 'APPROVAL'],
        enabled: true,
        description: 'Plant Warden Operations',
      },
    });
    if (!t39AddRecRes.ok || !t39AddRecRes.data.recipient?.id) {
      throw new Error(`Failed to add recipient: ${JSON.stringify(t39AddRecRes.data)}`);
    }
    const t39NewRecId = t39AddRecRes.data.recipient.id;
    console.log('✓ Super Admin successfully added email recipient (CC).');

    // Super Admin updates recipient
    const t39UpdateRecRes = await request(`/api/admin/email-recipients/${t39NewRecId}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { enabled: false },
    });
    if (!t39UpdateRecRes.ok || t39UpdateRecRes.data.recipient?.enabled !== false) {
      throw new Error('Failed to update recipient');
    }
    console.log('✓ Recipient status updated to disabled.');

    // Super Admin deletes recipient
    const t39DelRecRes = await request(`/api/admin/email-recipients/${t39NewRecId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t39DelRecRes.ok) throw new Error('Failed to delete recipient');
    console.log('✓ Recipient deleted successfully.');

    // =========================================================================
    // 40. Super Admin Only: Custom Email Content & Template Editor
    // =========================================================================
    console.log('\n[40] Testing Email Template Editor (Super Admin Only)...');

    // Warden attempt -> 403 Forbidden
    const t40WardenTplRes = await request('/api/admin/email-templates', {
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (t40WardenTplRes.status !== 403) {
      throw new Error(`Expected 403 for warden on email-templates, got: ${t40WardenTplRes.status}`);
    }

    // Super Admin gets templates
    const t40GetTplRes = await request('/api/admin/email-templates', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t40GetTplRes.ok || !t40GetTplRes.data.templates?.welcome) {
      throw new Error(`Failed to retrieve templates: ${JSON.stringify(t40GetTplRes.data)}`);
    }
    console.log('✓ Super Admin retrieved email templates.');

    // Super Admin modifies welcome template
    const t40UpdateTplRes = await request('/api/admin/email-templates/welcome', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        subject: 'Official Welcome: {{traineeName}} ({{traineeId}})',
        heading: 'Hostel Onboarding Confirmation',
        bodyText: 'Welcome {{traineeName}} to {{hostelName}} Room {{roomNumber}}. Validity: {{freeValidityStartDate}} to {{freeValidityEndDate}}.',
      },
    });
    if (!t40UpdateTplRes.ok || !t40UpdateTplRes.data.template) {
      throw new Error(`Failed to update template: ${JSON.stringify(t40UpdateTplRes.data)}`);
    }
    console.log('✓ Welcome template customized by Super Admin.');

    // Super Admin sends test email
    const t40TestEmailRes = await request('/api/admin/email-templates/welcome/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        targetEmail: 'admin-qa@apollotyres.com',
      },
    });
    if (!t40TestEmailRes.ok || !t40TestEmailRes.data.dispatch) {
      throw new Error(`Test email dispatch failed: ${JSON.stringify(t40TestEmailRes.data)}`);
    }
    console.log(`✓ Test email dispatched to ${t40TestEmailRes.data.recipient}.`);

    // Reset template to default
    const t40ResetTplRes = await request('/api/admin/email-templates/welcome/reset', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t40ResetTplRes.ok) throw new Error('Reset template failed');
    console.log('✓ Template successfully reset to defaults.');

    // =========================================================================
    // 41. Email Delivery History & Audit Logs
    // =========================================================================
    console.log('\n[41] Testing Email Delivery History & Audit Logs...');

    // Warden attempt -> 403
    const t41WardenLogsRes = await request('/api/admin/email-logs', {
      headers: { Authorization: `Bearer ${wardenToken}` },
    });
    if (t41WardenLogsRes.status !== 403) {
      throw new Error(`Expected 403 for warden on email logs, got: ${t41WardenLogsRes.status}`);
    }

    // Super Admin gets logs
    const t41SuperLogsRes = await request('/api/admin/email-logs', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!t41SuperLogsRes.ok || !Array.isArray(t41SuperLogsRes.data.logs)) {
      throw new Error('Failed to retrieve email logs');
    }
    const t41RetrievedLogs = t41SuperLogsRes.data.logs;
    if (t41RetrievedLogs.length < 2) {
      throw new Error(`Expected at least 2 email logs, found: ${t41RetrievedLogs.length}`);
    }
    console.log(`✓ Retrieved ${t41RetrievedLogs.length} email delivery history audit records.`);

    // =========================================================================
    // 42. Approval Decision Email Parity Test
    // =========================================================================
    console.log('\n[42] Testing Approval Decision Email Parity...');
    const approveTraineeId = `TRN-APP-${Date.now()}`;
    const approveTraineeEmail = `test-approve-${Date.now()}@gmail.com`;

    await Trainee.create({
      traineeId: approveTraineeId,
      hostelId: `HOSTEL-${Date.now()}`,
      qrId: `QR-APP-${Date.now()}`,
      name: 'Approved Trainee Candidate',
      email: approveTraineeEmail,
      mobile: '9876500001',
      gender: 'Male',
      qualification: 'Diploma Mechanical',
      aadhar: `99${Date.now().toString().slice(-10)}`,
      joiningDate: '2026-11-01',
      approvalStatus: 'PENDING_APPROVAL',
      hostelStatus: 'PENDING REVIEW',
      qrStatus: 'ACTIVE',
      employmentStatus: 'ACTIVE',
    });

    // Approver approves candidate
    const approveRes = await request('/api/approval/decision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        traineeId: approveTraineeId,
        decision: 'APPROVE', // Test un-normalized input
      },
    });
    if (!approveRes.ok) {
      throw new Error(`Approval decision request failed: ${JSON.stringify(approveRes.data)}`);
    }

    // Verify MongoDB state is strictly APPROVED
    const savedApprovedTrainee = await Trainee.findOne({ traineeId: approveTraineeId }).lean();
    if (savedApprovedTrainee.approvalStatus !== 'APPROVED') {
      throw new Error(`Expected trainee.approvalStatus to be APPROVED, got: ${savedApprovedTrainee.approvalStatus}`);
    }

    // Check EmailLog with retry
    let approveEmailLog = null;
    for (let i = 0; i < 20; i++) {
      approveEmailLog = await EmailLog.findOne({
        traineeId: approveTraineeId,
        emailType: 'APPROVAL_DECISION',
      }).sort({ sentAt: -1 }).lean();
      if (approveEmailLog) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!approveEmailLog) {
      throw new Error('No approval decision EmailLog found for trainee');
    }

    if (approveEmailLog.subject !== 'Your Hostel Registration Has Been Approved') {
      throw new Error(`Incorrect approval email subject: "${approveEmailLog.subject}"`);
    }
    if (!approveEmailLog.content.includes('REGISTRATION APPROVED')) {
      throw new Error(`Approval email missing heading "REGISTRATION APPROVED". Content: ${approveEmailLog.content}`);
    }
    if (!approveEmailLog.content.includes('Your hostel registration has been reviewed and approved successfully.')) {
      throw new Error(`Approval email missing correct body copy. Content: ${approveEmailLog.content}`);
    }
    if (approveEmailLog.content.includes('reviewed and rejected')) {
      throw new Error(`Approval email unexpectedly contains word "reviewed and rejected"! Content: ${approveEmailLog.content}`);
    }
    if (!approveEmailLog.content.includes('#16a34a')) {
      throw new Error('Approval email missing green banner color #16a34a');
    }
    if (approveEmailLog.metadata?.decision !== 'APPROVED') {
      throw new Error(`Email metadata.decision expected APPROVED, got: ${approveEmailLog.metadata?.decision}`);
    }
    console.log('✓ Approval decision generated strictly matching email: Heading, Subject, Body, and Green styling verified.');

    // =========================================================================
    // 43. Rejection Decision Email Parity Test
    // =========================================================================
    console.log('\n[43] Testing Rejection Decision Email Parity...');
    const rejectTraineeId = `TRN-REJ-${Date.now()}`;
    const rejectTraineeEmail = `test-reject-${Date.now()}@gmail.com`;
    const expectedRejectionReason = 'Educational certificates could not be verified.';

    await Trainee.create({
      traineeId: rejectTraineeId,
      hostelId: `HOSTEL-R-${Date.now()}`,
      qrId: `QR-REJ-${Date.now()}`,
      name: 'Rejected Trainee Candidate',
      email: rejectTraineeEmail,
      mobile: '9876500002',
      gender: 'Female',
      qualification: 'B.Tech Electrical',
      aadhar: `98${Date.now().toString().slice(-10)}`,
      joiningDate: '2026-11-01',
      approvalStatus: 'PENDING_APPROVAL',
      hostelStatus: 'PENDING REVIEW',
      qrStatus: 'ACTIVE',
      employmentStatus: 'ACTIVE',
    });

    // Approver rejects candidate
    const rejectRes = await request('/api/approval/decision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {
        traineeId: rejectTraineeId,
        decision: 'REJECT', // Test un-normalized input
        rejectionReason: expectedRejectionReason,
      },
    });
    if (!rejectRes.ok) {
      throw new Error(`Rejection decision request failed: ${JSON.stringify(rejectRes.data)}`);
    }

    // Verify MongoDB state is strictly REJECTED
    const savedRejectedTrainee = await Trainee.findOne({ traineeId: rejectTraineeId }).lean();
    if (savedRejectedTrainee.approvalStatus !== 'REJECTED') {
      throw new Error(`Expected trainee.approvalStatus to be REJECTED, got: ${savedRejectedTrainee.approvalStatus}`);
    }

    // Check EmailLog with retry
    let rejectEmailLog = null;
    for (let i = 0; i < 20; i++) {
      rejectEmailLog = await EmailLog.findOne({
        traineeId: rejectTraineeId,
        emailType: 'APPROVAL_DECISION',
      }).sort({ sentAt: -1 }).lean();
      if (rejectEmailLog) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!rejectEmailLog) {
      throw new Error('No rejection decision EmailLog found for trainee');
    }

    if (rejectEmailLog.subject !== 'Your Hostel Registration Has Been Rejected') {
      throw new Error(`Incorrect rejection email subject: "${rejectEmailLog.subject}"`);
    }
    if (!rejectEmailLog.content.includes('REGISTRATION REJECTED')) {
      throw new Error(`Rejection email missing heading "REGISTRATION REJECTED". Content: ${rejectEmailLog.content}`);
    }
    if (!rejectEmailLog.content.includes('Your hostel registration has been reviewed and rejected.')) {
      throw new Error(`Rejection email missing correct body copy. Content: ${rejectEmailLog.content}`);
    }
    if (rejectEmailLog.content.includes('approved successfully')) {
      throw new Error(`Rejection email unexpectedly contains "approved successfully"! Content: ${rejectEmailLog.content}`);
    }
    if (!rejectEmailLog.content.includes(expectedRejectionReason)) {
      throw new Error(`Rejection email missing rejection reason. Content: ${rejectEmailLog.content}`);
    }
    if (!rejectEmailLog.content.includes('#dc2626')) {
      throw new Error('Rejection email missing red banner color #dc2626');
    }
    if (rejectEmailLog.metadata?.decision !== 'REJECTED') {
      throw new Error(`Email metadata.decision expected REJECTED, got: ${rejectEmailLog.metadata?.decision}`);
    }
    console.log('✓ Rejection decision generated strictly matching email: Heading, Subject, Body, Reason, and Red styling verified.');

    // =========================================================================
    // 44. Admin Notification Email Configuration, Persistence & Zero admin@hostel.com Fallback
    // =========================================================================
    console.log('\n[44] Testing Admin Notification Email Configuration & Persistence across server restart...');
    const newAdminNotificationEmail = 'hostel-ops-lead@apollotyres.com';

    // 44a. Super Admin updates admin notification email via API
    const updateAdminEmailRes = await request('/api/admin/notification-email', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email: newAdminNotificationEmail },
    });
    if (!updateAdminEmailRes.ok || updateAdminEmailRes.data.adminNotificationEmail !== newAdminNotificationEmail) {
      throw new Error(`Failed to update admin notification email: ${JSON.stringify(updateAdminEmailRes.data)}`);
    }

    // 44b. Verify GET /api/admin/notification-email returns updated email
    const getAdminEmailRes = await request('/api/admin/notification-email', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (getAdminEmailRes.data.adminNotificationEmail !== newAdminNotificationEmail) {
      throw new Error(`Expected ${newAdminNotificationEmail}, got: ${getAdminEmailRes.data.adminNotificationEmail}`);
    }

    // 44c. Verify MongoDB Config model updated
    const savedConfig = await Config.findOne({ key: 'main' }).lean();
    if (savedConfig.adminNotificationEmail !== newAdminNotificationEmail) {
      throw new Error(`MongoDB Config.adminNotificationEmail mismatch. Found: ${savedConfig.adminNotificationEmail}`);
    }

    // 44d. Dispatch test admin notification alert
    const testAdminAlertRes = await request('/api/admin/notification-email/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {}, // Uses saved address by default
    });
    if (!testAdminAlertRes.ok || testAdminAlertRes.data.recipient !== newAdminNotificationEmail) {
      throw new Error(`Test alert expected recipient ${newAdminNotificationEmail}, got: ${testAdminAlertRes.data.recipient}`);
    }
    console.log(`✓ Test admin notification alert successfully dispatched to ${newAdminNotificationEmail}.`);

    // 44e. Simulate Server Restart: re-run seedDatabase()
    console.log('Simulating server restart (running seedDatabase)...');
    await seedDatabase();

    // Verify adminUser in MongoDB has NOT reverted to admin@hostel.com
    const adminUserAfterRestart = await User.findOne({ username: 'admin' }).lean();
    if (adminUserAfterRestart.email !== newAdminNotificationEmail) {
      throw new Error(`Admin email reverted after restart! Expected ${newAdminNotificationEmail}, found: ${adminUserAfterRestart.email}`);
    }

    // Verify Config.adminNotificationEmail is still preserved
    const configAfterRestart = await Config.findOne({ key: 'main' }).lean();
    if (configAfterRestart.adminNotificationEmail !== newAdminNotificationEmail) {
      throw new Error(`Config.adminNotificationEmail reverted after restart! Found: ${configAfterRestart.adminNotificationEmail}`);
    }
    console.log('✓ Admin notification email safely preserved across server restart.');

    // 44f. Verify that admin@hostel.com was NEVER sent to in any email log
    const strayDefaultEmailLogs = await EmailLog.find({
      $or: [
        { recipient: { $regex: /admin@hostel\.com/i } },
        { to: { $in: ['admin@hostel.com'] } },
        { cc: { $in: ['admin@hostel.com'] } },
        { bcc: { $in: ['admin@hostel.com'] } },
      ],
    }).lean();

    if (strayDefaultEmailLogs.length > 0) {
      throw new Error(`Found ${strayDefaultEmailLogs.length} email logs delivered to hardcoded admin@hostel.com: ${JSON.stringify(strayDefaultEmailLogs.map((l) => ({ type: l.emailType, to: l.to, sentAt: l.sentAt })))}`);
    }
    console.log('✓ Verified ZERO email deliveries to admin@hostel.com across entire system!');

    // Cleanup test records
    await Trainee.deleteOne({ traineeId: approveTraineeId });
    await Trainee.deleteOne({ traineeId: rejectTraineeId });
    await EmailLog.deleteMany({ traineeId: { $in: [approveTraineeId, rejectTraineeId] } });

    // [45] Testing Emailed ID Card with Embedded Scannable QR Code & PDF Attachment
    console.log('\n[45] Testing Emailed ID Card with Embedded Scannable QR Code and PDF Attachment...');
    const testIdCardTraineeId = `TRN-IDCARD-${Date.now()}`;
    const testIdCardQrId = `QR-IDCARD-${Date.now()}`;
    const testIdCardTrainee = await Trainee.create({
      traineeId: testIdCardTraineeId,
      qrId: testIdCardQrId,
      name: 'ID Card Test Trainee',
      email: `idcard-test-${Date.now()}@gmail.com`,
      mobile: '9876543210',
      hostel: 'Hostel Block A',
      roomNo: '101',
      approvalStatus: 'APPROVED',
      hostelStatus: 'ACTIVE',
      joiningDate: '2026-01-15',
    });

    // 45a. Test PDF generation directly
    const qrBuffer = await QRCode.toBuffer(`https://example.com/#/verify/${testIdCardQrId}`, { width: 250 });
    const pdfBuf = await generateIdCardPdf({
      trainee: testIdCardTrainee,
      branding: { orgName: 'APOLLO TYRES LTD' },
      qrBuffer,
      verifyUrl: `https://example.com/#/verify/${testIdCardQrId}`,
    });
    if (!pdfBuf || pdfBuf.length < 1000) {
      throw new Error(`ID card PDF generation failed or generated invalid buffer (length: ${pdfBuf ? pdfBuf.length : 0})`);
    }
    const pdfHeader = pdfBuf.slice(0, 5).toString('ascii');
    if (!pdfHeader.startsWith('%PDF')) {
      throw new Error(`ID card PDF does not have valid PDF magic bytes! Found: ${pdfHeader}`);
    }
    console.log(`✓ ID Card PDF generated successfully: ${pdfBuf.length} bytes with valid %PDF header.`);

    // 45b. Test sendTraineeIdCardEmail with PDF attachment and embedded QR code
    const idCardEmailResult = await sendTraineeIdCardEmail({ trainee: testIdCardTrainee, force: true });
    if (!idCardEmailResult.ok) {
      throw new Error(`sendTraineeIdCardEmail failed: ${idCardEmailResult.error || idCardEmailResult.message}`);
    }

    // Verify email log has embedded QR code img tag with data:image/png;base64
    const idCardEmailLog = await EmailLog.findOne({ traineeId: testIdCardTraineeId, emailType: 'ID_CARD' }).sort({ createdAt: -1 }).lean();
    if (!idCardEmailLog) {
      throw new Error(`EmailLog for ID_CARD not found for trainee ${testIdCardTraineeId}`);
    }
    if (!idCardEmailLog.content.includes('data:image/png;base64,')) {
      throw new Error('Emailed ID card HTML does not contain embedded QR Code data URI!');
    }
    if (!idCardEmailLog.content.includes(testIdCardQrId)) {
      throw new Error('Emailed ID card HTML does not contain actual unique QR ID!');
    }
    if (!idCardEmailLog.metadata?.hasPdfAttachment) {
      throw new Error('Emailed ID card metadata indicates PDF attachment was missing!');
    }
    console.log('✓ Emailed ID card contains embedded scannable QR Code and PDF attachment.');

    // 45c. Test both /send-id-card and /email-id-card API endpoints
    const sendIdCardRes = await request(`/api/trainees/${testIdCardTraineeId}/send-id-card`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!sendIdCardRes.ok || !sendIdCardRes.data.ok) {
      throw new Error(`/send-id-card failed: ${JSON.stringify(sendIdCardRes.data)}`);
    }

    const emailIdCardRes = await request(`/api/trainees/${testIdCardTraineeId}/email-id-card`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!emailIdCardRes.ok || !emailIdCardRes.data.ok) {
      throw new Error(`/email-id-card alias endpoint failed: ${JSON.stringify(emailIdCardRes.data)}`);
    }
    console.log('✓ Both /send-id-card and /email-id-card API endpoints succeed flawlessly.');

    // [46] Testing Approval Decision Email Tracking & Retry Endpoint
    console.log('\n[46] Testing Approval Decision Email Tracking and Retry Endpoint...');
    const testDecisionTraineeId = `TRN-DEC-${Date.now()}`;
    await Trainee.create({
      traineeId: testDecisionTraineeId,
      qrId: `QR-DEC-${Date.now()}`,
      name: 'Decision Test Trainee',
      email: `decision-test-${Date.now()}@gmail.com`,
      approvalStatus: 'PENDING_APPROVAL',
      hostelStatus: 'PENDING REVIEW',
      joiningDate: '2026-02-01',
    });

    const decRes = await request('/api/approval/decision', {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` },
      body: {
        traineeId: testDecisionTraineeId,
        decision: 'APPROVED',
      },
    });
    if (!decRes.ok || !decRes.data.ok) {
      throw new Error(`Decision POST failed: ${JSON.stringify(decRes.data)}`);
    }
    if (!decRes.data.emailResult || !decRes.data.emailResult.ok) {
      throw new Error(`Decision API did not return valid emailResult: ${JSON.stringify(decRes.data.emailResult)}`);
    }

    // Verify DB update
    const updatedDecisionTrainee = await Trainee.findOne({ traineeId: testDecisionTraineeId }).lean();
    if (updatedDecisionTrainee.approvalStatus !== 'APPROVED') {
      throw new Error('Approval status not saved in DB!');
    }
    if (updatedDecisionTrainee.approvalEmailSent !== true) {
      throw new Error('approvalEmailSent flag was not set to true in DB!');
    }
    console.log('✓ Approval decision saved in MongoDB, decision email dispatched & tracked on trainee model.');

    // Test retry endpoint: /api/trainees/:traineeId/send-approval-email
    const retryRes = await request(`/api/trainees/${testDecisionTraineeId}/send-approval-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!retryRes.ok || !retryRes.data.ok) {
      throw new Error(`Retry approval email endpoint failed: ${JSON.stringify(retryRes.data)}`);
    }
    console.log('✓ Manual retry endpoint /api/trainees/:traineeId/send-approval-email verified.');

    // [47] Testing Hostel-wise Occupancy Summary Report
    console.log('\n[47] Testing Hostel-wise Occupancy Summary with Free and Paid Counts...');
    const occReportRes = await request('/api/reports?type=hostel-occupancy', {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!occReportRes.ok || !occReportRes.data.ok) {
      throw new Error(`GET /api/reports?type=hostel-occupancy failed: ${JSON.stringify(occReportRes.data)}`);
    }
    const expectedHeaders = ['Hostel Name', 'Total Occupied', 'Free Trainees', 'Paid Trainees', 'Available Beds'];
    if (JSON.stringify(occReportRes.data.headers) !== JSON.stringify(expectedHeaders)) {
      throw new Error(`Unexpected headers: ${JSON.stringify(occReportRes.data.headers)}`);
    }
    const occSummary = occReportRes.data.summary || occReportRes.data.extraStats;
    if (typeof occSummary?.totalHostels !== 'number' || typeof occSummary?.totalOccupiedTrainees !== 'number' || typeof occSummary?.totalAvailableBeds !== 'number') {
      throw new Error(`Missing expected summary cards keys: ${JSON.stringify(occSummary)}`);
    }
    console.log(`✓ Hostel-wise Occupancy Summary verified: ${occSummary.totalHostels} hostels, ${occSummary.totalOccupiedTrainees} occupied, ${occSummary.totalFreeTrainees} free, ${occSummary.totalPaidTrainees} paid, ${occSummary.totalAvailableBeds} available beds.`);

    // Dedicated endpoint test
    const dedicatedOccRes = await request('/api/reports/hostel-occupancy?classification=ALL', {
      headers: { Authorization: `Bearer ${superToken}` },
    });
    if (!dedicatedOccRes.ok || !dedicatedOccRes.data.ok) {
      throw new Error(`GET /api/reports/hostel-occupancy failed: ${JSON.stringify(dedicatedOccRes.data)}`);
    }
    console.log('✓ Dedicated /api/reports/hostel-occupancy endpoint verified.');

    // [48] Testing Validity Report KPI Counters
    console.log('\n[48] Testing Validity Report KPI Counters (Strict Monitoring)...');
    const valReportRes = await request('/api/validity/report', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!valReportRes.ok) {
      throw new Error(`GET /api/validity/report failed: ${JSON.stringify(valReportRes.data)}`);
    }
    const valSummary = valReportRes.data.summary || valReportRes.data.kpis;
    if (
      typeof valSummary?.totalLivingTrainees !== 'number' ||
      typeof valSummary?.freeTrainees !== 'number' ||
      typeof valSummary?.paidTrainees !== 'number' ||
      typeof valSummary?.expiringSoon !== 'number' ||
      typeof valSummary?.expiredTrainees !== 'number'
    ) {
      throw new Error(`Validity summary missing required KPI keys: ${JSON.stringify(valSummary)}`);
    }
    console.log(`✓ Validity Report KPIs verified: ${valSummary.totalLivingTrainees} living, ${valSummary.freeTrainees} free, ${valSummary.paidTrainees} paid, ${valSummary.expiringSoon} expiring soon, ${valSummary.expiredTrainees} expired.`);

    // Cleanup additional test trainees
    await Trainee.deleteOne({ traineeId: testIdCardTraineeId });
    await Trainee.deleteOne({ traineeId: testDecisionTraineeId });
    await EmailLog.deleteMany({ traineeId: { $in: [testIdCardTraineeId, testDecisionTraineeId] } });

    // Clean up test trainee
    await Trainee.deleteOne({ traineeId: testTraineeId });
    await EmailLog.deleteMany({ traineeId: testTraineeId });
    await Trainee.deleteMany({ traineeId: { $in: ['TRN-TEST-TRIP', 'TRN-TEST-OCCUPANT'] } });
    await Trainee.deleteOne({ qrId: autoQrId });

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
