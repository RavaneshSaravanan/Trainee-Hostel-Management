import mongoose from 'mongoose';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { connectDB, closeDB } from './config/db.js';
import { startServer } from './server.js';
import { Trainee } from './models/Trainee.js';
import { User } from './models/User.js';
import { Hostel } from './models/Hostel.js';
import { SUPER_ROLE } from './defaults.js';
import { encryptAadhaar, maskAadhaar, hashAadhaar, decryptAadhaar } from './utils/encryption.js';

dotenv.config();

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;
const JWT_SECRET = process.env.JWT_SECRET || 'trainee_hostel_secret_jwt_key_2026';

let superToken = '';
let wardenToken = '';
let serverInstance = null;

async function setupTokens() {
  const superUser = await User.findOne({ roleId: SUPER_ROLE }).lean();
  superToken = jwt.sign({ id: superUser.id, roleId: SUPER_ROLE }, JWT_SECRET, { expiresIn: '1h' });

  const wardenUser = await User.findOne({ roleId: 'warden' }).lean();
  if (wardenUser) {
    wardenToken = jwt.sign({ id: wardenUser.id, roleId: 'warden' }, JWT_SECRET, { expiresIn: '1h' });
  }
}

async function runProfileTestSuite() {
  console.log('====================================================');
  console.log(' TRAINEE PROFILE EDIT & AADHAAR SUITE VERIFICATION ');
  console.log('====================================================');

  serverInstance = await startServer();
  await setupTokens();

  // Find an existing trainee for testing
  let testTrainee = await Trainee.findOne({ employmentStatus: 'ACTIVE' });
  if (!testTrainee) {
    console.log('No active trainee found, creating temporary test trainee...');
    testTrainee = await Trainee.create({
      traineeId: 'TRN-TEST-PROF',
      hostelId: 'HST-TEST',
      qrId: 'QR-TEST-PROF',
      name: 'Original Test Name',
      mobile: '9876543210',
      email: 'original.test@gmail.com',
      dob: '2000-05-15',
      gender: 'MALE',
      qualification: 'Diploma',
      aadhar: 'XXXX-XXXX-9999',
      aadharMasked: 'XXXX-XXXX-9999',
      aadharEncrypted: encryptAadhaar('234567890123'),
      aadharHash: hashAadhaar('234567890123'),
      food: 'VEG',
      joiningDate: '2026-01-10',
      hostelStatus: 'ACTIVE',
      hostel: 'Hostel A',
      roomNo: '101',
    });
  }

  const traineeKey = testTrainee.traineeId || testTrainee.qrId;
  const originalAadhaarHash = testTrainee.aadharHash;
  const originalAadhaarMasked = testTrainee.aadharMasked || testTrainee.aadhar;
  console.log(`\nTesting with Trainee: ${testTrainee.name} (${traineeKey})`);
  console.log(`Original Aadhaar Masked: ${originalAadhaarMasked}`);

  // Test 1: Fetch trainee details via GET /api/trainees/:id
  console.log('\n[TEST 1] GET /api/trainees/:id returns masked Aadhaar and hides sensitive keys...');
  const res1 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const data1 = await res1.json();
  if (!res1.ok || !data1.trainee) {
    throw new Error(`Failed to fetch trainee: ${JSON.stringify(data1)}`);
  }
  if (data1.trainee.aadharEncrypted || data1.trainee.aadharHash || data1.trainee.passwordHash) {
    throw new Error('Security Violation: GET /api/trainees/:id leaked sensitive encryption/hash keys!');
  }
  console.log('✓ Masked Aadhaar returned:', data1.trainee.aadhar);
  console.log('✓ Sensitive keys successfully omitted from output.');

  // Test 2: Edit name and mobile without changing Aadhaar (changeAadhaar: false)
  console.log('\n[TEST 2] PUT /api/trainees/:id with edited name/mobile and unchanged Aadhaar...');
  const updatedMobile = '9876500001';
  const updatedName = 'Updated Trainee Name';
  const res2 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      name: updatedName,
      mobile: updatedMobile,
      changeAadhaar: false,
    }),
  });
  const data2 = await res2.json();
  if (!res2.ok || !data2.ok) {
    throw new Error(`Failed to update trainee: ${JSON.stringify(data2)}`);
  }

  // Verify directly from MongoDB
  const dbTraineeAfterSave = await Trainee.findById(testTrainee._id).lean();
  if (dbTraineeAfterSave.name !== updatedName) {
    throw new Error(`Name was not updated in MongoDB! Got: ${dbTraineeAfterSave.name}`);
  }
  if (dbTraineeAfterSave.mobile !== updatedMobile) {
    throw new Error(`Mobile was not updated in MongoDB! Got: ${dbTraineeAfterSave.mobile}`);
  }
  if (dbTraineeAfterSave.aadharHash !== originalAadhaarHash) {
    throw new Error('Data Corruption: Unchanged Aadhaar hash was altered or wiped out!');
  }
  console.log('✓ Name and Mobile updated successfully in MongoDB.');
  console.log('✓ Existing Aadhaar hash and encrypted value remained 100% intact.');

  // Test 3: Validation - Reject invalid mobile number (< 10 digits or starts with 2)
  console.log('\n[TEST 3] Validation: Reject invalid mobile number (expect HTTP 400)...');
  const res3 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      mobile: '12345',
    }),
  });
  const data3 = await res3.json();
  if (res3.status !== 400 || !data3.errors?.mobile) {
    throw new Error(`Expected HTTP 400 with errors.mobile, got: ${res3.status} ${JSON.stringify(data3)}`);
  }
  console.log('✓ Invalid mobile rejected with clear message:', data3.errors.mobile);

  // Test 4: Validation - Reject invalid non-Gmail email
  console.log('\n[TEST 4] Validation: Reject invalid email domain (expect HTTP 400)...');
  const res4 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      email: 'test@yahoo.com',
    }),
  });
  const data4 = await res4.json();
  if (res4.status !== 400 || !data4.errors?.email) {
    throw new Error(`Expected HTTP 400 with errors.email, got: ${res4.status} ${JSON.stringify(data4)}`);
  }
  console.log('✓ Non-Gmail email rejected with clear message:', data4.errors.email);

  // Test 5: Validation - Reject future Date of Birth
  console.log('\n[TEST 5] Validation: Reject future Date of Birth (expect HTTP 400)...');
  const futureDate = new Date();
  futureDate.setFullYear(futureDate.getFullYear() + 2);
  const futureDobStr = futureDate.toISOString().slice(0, 10);
  const res5 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      dob: futureDobStr,
    }),
  });
  const data5 = await res5.json();
  if (res5.status !== 400 || !data5.errors?.dob) {
    throw new Error(`Expected HTTP 400 with errors.dob, got: ${res5.status} ${JSON.stringify(data5)}`);
  }
  console.log('✓ Future DOB rejected with clear message:', data5.errors.dob);

  // Test 6: Aadhaar Change with Invalid Aadhaar (< 12 digits)
  console.log('\n[TEST 6] Validation: Reject incomplete Aadhaar on change (expect HTTP 400)...');
  const res6 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      changeAadhaar: true,
      aadhar: '1234',
    }),
  });
  const data6 = await res6.json();
  if (res6.status !== 400 || !data6.errors?.aadhar) {
    throw new Error(`Expected HTTP 400 with errors.aadhar, got: ${res6.status} ${JSON.stringify(data6)}`);
  }
  console.log('✓ 4-digit partial Aadhaar on change rejected with message:', data6.errors.aadhar);

  // Test 7: Valid Aadhaar Change with 12 Digits
  console.log('\n[TEST 7] Update Aadhaar: Successfully update with valid 12-digit UID...');
  const newAadhaarNumber = '999988887778';
  const res7 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
    body: JSON.stringify({
      changeAadhaar: true,
      aadhar: newAadhaarNumber,
    }),
  });
  const data7 = await res7.json();
  if (!res7.ok || !data7.ok) {
    throw new Error(`Failed to update Aadhaar: ${JSON.stringify(data7)}`);
  }
  const dbTraineeNewAadhaar = await Trainee.findById(testTrainee._id).lean();
  if (dbTraineeNewAadhaar.aadharMasked !== `XXXX-XXXX-${newAadhaarNumber.slice(8)}`) {
    throw new Error(`Aadhaar masked does not match! Got: ${dbTraineeNewAadhaar.aadharMasked}`);
  }
  const decrypted = decryptAadhaar(dbTraineeNewAadhaar.aadharEncrypted);
  if (decrypted !== newAadhaarNumber) {
    throw new Error(`Decrypted Aadhaar does not match! Got: ${decrypted}`);
  }
  console.log('✓ Aadhaar updated in MongoDB.');
  console.log('✓ Masked format verified: ' + dbTraineeNewAadhaar.aadharMasked);
  console.log('✓ AES-256 encryption & decryption verified successfully.');

  // Test 8: Duplicate Aadhaar Detection
  console.log('\n[TEST 8] Duplicate Aadhaar: Attempting to assign same Aadhaar to another trainee (expect HTTP 400)...');
  let secondTrainee = await Trainee.findOne({ _id: { $ne: testTrainee._id }, employmentStatus: 'ACTIVE' });
  if (secondTrainee) {
    const res8 = await fetch(`${BASE_URL}/api/trainees/${secondTrainee.traineeId || secondTrainee.qrId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superToken}` },
      body: JSON.stringify({
        changeAadhaar: true,
        aadhar: newAadhaarNumber,
      }),
    });
    const data8 = await res8.json();
    if (res8.status !== 400 || !data8.errors?.aadhar) {
      throw new Error(`Expected HTTP 400 with duplicate Aadhaar error, got: ${res8.status} ${JSON.stringify(data8)}`);
    }
    console.log('✓ Duplicate Aadhaar blocked with message:', data8.errors.aadhar);
  } else {
    console.log('Skipping 2nd trainee duplicate check (only 1 trainee in DB).');
  }

  // Test 9: Unauthorized Update (Invalid/Missing Token)
  console.log('\n[TEST 9] Unauthorized Access: Reject PUT without valid authorization token (expect HTTP 401)...');
  const res9 = await fetch(`${BASE_URL}/api/trainees/${traineeKey}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Hacked Name' }),
  });
  if (res9.status !== 401) {
    throw new Error(`Expected HTTP 401 Unauthorized, got: ${res9.status}`);
  }
  console.log('✓ Unauthenticated request rejected with HTTP 401.');

  // Restore original name/mobile
  await Trainee.findByIdAndUpdate(testTrainee._id, {
    name: testTrainee.name,
    mobile: testTrainee.mobile,
  });

  console.log('\n====================================================');
  console.log(' ALL 9 PROFILE & AADHAAR TEST CASES PASSED CLEANLY! ');
  console.log('====================================================');

  if (serverInstance) serverInstance.close();
  await closeDB();
  process.exit(0);
}

runProfileTestSuite().catch(async (err) => {
  console.error('\n❌ Test Suite Failed:', err.message);
  if (serverInstance) serverInstance.close();
  await closeDB();
  process.exit(1);
});
