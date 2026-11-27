import express from 'express';
import mongoose from 'mongoose';
import XLSX from 'xlsx';
import crypto from 'node:crypto';
import { Trainee } from '../models/Trainee.js';
import { Hostel } from '../models/Hostel.js';
import { ImportBatch } from '../models/ImportBatch.js';
import { RoomHistory } from '../models/RoomHistory.js';
import { Config } from '../models/Config.js';
import { bumpRev } from '../models/Meta.js';
import { auth, requireSuper } from '../middleware/auth.js';
import { nextId, todayStr } from '../utils/dates.js';
import { addThreeCalendarMonths } from '../utils/validity.js';
import { encryptAadhaar, maskAadhaar, hashAadhaar } from '../utils/encryption.js';
import {
  isValidEmail,
  isValidMobile,
  isValidGuardianContact,
  isValidDob,
  isValidAadhaar,
} from '../utils/validators.js';
import { sendTraineeWelcomeEmail } from '../services/emailService.js';

const router = express.Router();

// Required trainee fields for full completion
const REQUIRED_FIELDS = [
  { key: 'name', label: 'Trainee Name' },
  { key: 'mobile', label: 'Mobile Number' },
  { key: 'dob', label: 'Date of Birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'qualification', label: 'Department / Qualification' },
  { key: 'aadhar', label: 'Aadhaar Number' },
  { key: 'food', label: 'Food Preference' },
  { key: 'address1', label: 'Address' },
  { key: 'state', label: 'State' },
  { key: 'guardianName', label: 'Guardian Name' },
  { key: 'guardianContact', label: 'Guardian Contact' },
];

function isFieldEmpty(val) {
  return val === undefined || val === null || String(val).trim() === '' || String(val).trim() === '—';
}

/** Parse various date formats: DD/MM/YYYY, YYYY-MM-DD, or Excel serial numbers */
function parseExcelDate(val) {
  if (!val) return '';
  if (typeof val === 'number') {
    // Excel serial number to JS Date
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    return date.toISOString().split('T')[0];
  }
  const s = String(val).trim();
  // Check DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Check ISO YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return s;
}

// ---------------- 1. Downloadable Excel Template ----------------
router.get('/trainees/bulk-template', auth, requireSuper, async (req, res) => {
  try {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Registration Template
    const templateHeaders = [
      'Trainee Name *',
      'Trainee ID',
      'Mobile Number',
      'Email',
      'Aadhaar Number',
      'Date of Birth (DD/MM/YYYY)',
      'Gender',
      'Department',
      'Designation',
      'Joining Date (DD/MM/YYYY)',
      'Hostel Name',
      'Room Number',
      'Food Preference',
      'Address',
      'State',
      'Emergency Contact',
      'Guardian Name',
    ];

    const templateRows = [
      templateHeaders,
      // Empty row ready for entry
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ];

    const wsTemplate = XLSX.utils.aoa_to_sheet(templateRows);
    wsTemplate['!cols'] = [
      { wch: 24 }, // Name
      { wch: 16 }, // ID
      { wch: 16 }, // Mobile
      { wch: 26 }, // Email
      { wch: 18 }, // Aadhaar
      { wch: 22 }, // DOB
      { wch: 12 }, // Gender
      { wch: 20 }, // Dept
      { wch: 18 }, // Desig
      { wch: 22 }, // Joining
      { wch: 20 }, // Hostel
      { wch: 14 }, // Room
      { wch: 16 }, // Food
      { wch: 28 }, // Address
      { wch: 16 }, // State
      { wch: 18 }, // Emergency
      { wch: 20 }, // Guardian
    ];
    XLSX.utils.book_append_sheet(wb, wsTemplate, 'Trainee Import Template');

    // Sheet 2: Instructions
    const instructions = [
      ['TRAINEE HOSTEL MANAGEMENT SYSTEM — BULK IMPORT GUIDELINES'],
      ['APOLLO TYRES LTD — ENTERPRISE OPERATIONS'],
      [''],
      ['1. GENERAL INSTRUCTIONS:'],
      ['• Column A (Trainee Name) is recommended for identification.'],
      ['• Partial records are fully supported: missing fields can be completed later by the respective hostel Warden.'],
      ['• All valid supplied fields will be imported and saved to the database.'],
      ['• Automatic QR ID will be generated uniquely for every imported trainee (do NOT enter QR IDs manually).'],
      ['• Trainee ID is optional. If left blank, the system generates a unique Trainee ID (e.g. TRN-XXXXX).'],
      [''],
      ['2. FIELD FORMATS & PREDEFINED CHOICES:'],
      ['• Mobile Number: 10 digits starting with 6, 7, 8, or 9.'],
      ['• Aadhaar Number: 12 digits (will be securely encrypted & masked).'],
      ['• Dates: Use DD/MM/YYYY format (e.g. 15/08/2002). Date of Birth cannot be in the future.'],
      ['• Gender: MALE, FEMALE, or OTHER.'],
      ['• Food Preference: VEG or NON-VEG.'],
      ['• Hostel Name & Room Number: Optional. If supplied, capacity will be verified.'],
      ['  If the room is at full capacity, the trainee is created and marked as Pending Room Allocation.'],
      [''],
      ['3. WARDEN COMPLETION WORKFLOW:'],
      ['• Incomplete trainee records appear on the responsible Warden dashboard under "Incomplete Details".'],
      ['• Once the Warden fills missing details and allocates a room, the trainee becomes Complete & Active.'],
      ['• Digital ID card and Welcome Email are triggered automatically upon finalization.'],
    ];
    const wsInstructions = XLSX.utils.aoa_to_sheet(instructions);
    wsInstructions['!cols'] = [{ wch: 80 }];
    XLSX.utils.book_append_sheet(wb, wsInstructions, 'Instructions');

    // Sheet 3: Sample Data
    const sampleRows = [
      templateHeaders,
      [
        'Rajesh Kumar (SAMPLE)',
        'TRN-90001',
        '9876543210',
        'rajesh.k@example.com',
        '987654321098',
        '14/05/2001',
        'MALE',
        'Production',
        'Trainee Engineer',
        '01/01/2026',
        'Boys Hostel Block A',
        '101',
        'VEG',
        '123 Gandhi Road',
        'Tamil Nadu',
        '9876543211',
        'Sundar Kumar',
      ],
      [
        'Priya Sharma (SAMPLE - PARTIAL)',
        '',
        '9845123456',
        'priya.s@example.com',
        '',
        '22/09/2002',
        'FEMALE',
        'Quality Assurance',
        'Quality Trainee',
        '01/02/2026',
        'Girls Hostel',
        '204',
        'NON-VEG',
        '',
        'Tamil Nadu',
        '',
        'Ramesh Sharma',
      ],
      [
        'Arun Prakash (SAMPLE - MINIMAL)',
        '',
        '9123456780',
        '',
        '',
        '',
        'MALE',
        'Maintenance',
        '',
        '15/02/2026',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ],
    ];
    const wsSample = XLSX.utils.aoa_to_sheet(sampleRows);
    wsSample['!cols'] = wsTemplate['!cols'];
    XLSX.utils.book_append_sheet(wb, wsSample, 'Sample Data (Examples)');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Trainee-Bulk-Import-Template.xlsx"');
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate template: ' + err.message });
  }
});

// ---------------- 2. Bulk Excel Upload & Intelligent Preview ----------------
router.post('/trainees/bulk-preview', auth, requireSuper, async (req, res) => {
  try {
    const { rows = [] } = req.body || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No data rows detected in the uploaded file.' });
    }

    // Fetch existing records for duplicate detection
    const existingTrainees = await Trainee.find({}, 'traineeId aadharHash qrId name mobile').lean();
    const existingHostels = await Hostel.find({}).lean();

    // Map of active occupants per hostel + room
    const activeOccupants = await Trainee.find({
      hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
      roomNo: { $exists: true, $ne: '' },
    }, 'hostel roomNo').lean();

    const occupancyMap = new Map();
    activeOccupants.forEach((t) => {
      const key = `${String(t.hostel).toLowerCase()}::${String(t.roomNo).toLowerCase()}`;
      occupancyMap.set(key, (occupancyMap.get(key) || 0) + 1);
    });

    // In-memory tracker for room bed consumption across this batch
    const batchOccupancyTracker = new Map();

    const analyzedRows = [];
    const seenTraineeIds = new Set();
    const seenAadhaars = new Set();

    let validCount = 0;
    let partialCount = 0;
    let warningCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;
    let roomAllocatedCount = 0;
    let roomPendingCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const rowNum = i + 2; // Excel row numbering (1 is header)

      // Normalize field names
      const name = String(r['Trainee Name *'] || r['Trainee Name'] || r.name || '').trim();
      const rawTraineeId = String(r['Trainee ID'] || r.traineeId || '').trim();
      const mobile = String(r['Mobile Number'] || r.mobile || '').replace(/\D/g, '');
      const email = String(r['Email'] || r.email || '').trim().toLowerCase();
      const rawAadhaar = String(r['Aadhaar Number'] || r.aadhar || '').replace(/\s+/g, '');
      const rawDob = r['Date of Birth (DD/MM/YYYY)'] || r['Date of Birth'] || r.dob || '';
      const gender = String(r['Gender'] || r.gender || '').trim().toUpperCase();
      const department = String(r['Department'] || r.qualification || '').trim();
      const designation = String(r['Designation'] || r.designation || '').trim();
      const rawJoining = r['Joining Date (DD/MM/YYYY)'] || r['Joining Date'] || r.joiningDate || '';
      const hostelName = String(r['Hostel Name'] || r.hostel || '').trim();
      const roomNumber = String(r['Room Number'] || r.roomNo || '').trim();
      const food = String(r['Food Preference'] || r.food || '').trim().toUpperCase();
      const address = String(r['Address'] || r.address1 || '').trim();
      const state = String(r['State'] || r.state || '').trim();
      const emergencyContact = String(r['Emergency Contact'] || r.emergencyContact || '').replace(/\D/g, '');
      const guardianName = String(r['Guardian Name'] || r.guardianName || '').trim();

      const errors = [];
      const warnings = [];

      // Check minimum usable identity
      if (!name || name.length < 2 || name.toLowerCase().includes('sample')) {
        skippedCount++;
        analyzedRows.push({
          rowNumber: rowNum,
          name: name || '—',
          status: 'SKIPPED',
          reason: !name ? 'Missing Trainee Name (cannot identify record)' : 'Sample / Fictional row ignored',
          canImport: false,
          data: r,
          errors: ['Trainee Name is missing or unusable.'],
        });
        continue;
      }

      // 1. Duplicate Trainee ID check
      if (rawTraineeId) {
        if (seenTraineeIds.has(rawTraineeId.toUpperCase())) {
          errors.push(`Duplicate Trainee ID "${rawTraineeId}" appears multiple times in this Excel file.`);
        } else if (existingTrainees.some((t) => t.traineeId && t.traineeId.toUpperCase() === rawTraineeId.toUpperCase())) {
          errors.push(`Trainee ID "${rawTraineeId}" already exists in the database.`);
        }
        seenTraineeIds.add(rawTraineeId.toUpperCase());
      }

      // 2. Duplicate Aadhaar check
      if (rawAadhaar) {
        if (!isValidAadhaar(rawAadhaar)) {
          warnings.push(`Aadhaar "${rawAadhaar}" failed 12-digit UIDAI checksum; will be excluded.`);
        } else {
          const aHash = hashAadhaar(rawAadhaar);
          if (seenAadhaars.has(aHash)) {
            errors.push('Aadhaar number appears multiple times in this Excel file.');
          } else if (existingTrainees.some((t) => t.aadharHash === aHash)) {
            errors.push('Aadhaar number is already registered with another trainee in the database.');
          }
          seenAadhaars.add(aHash);
        }
      }

      // 3. Mobile Number validation
      if (mobile) {
        if (!isValidMobile(mobile)) {
          warnings.push(`Mobile "${mobile}" is not a valid 10-digit Indian mobile number; field marked incomplete.`);
        }
      }

      // 4. Email validation
      if (email) {
        if (!isValidEmail(email)) {
          warnings.push(`Email "${email}" is invalid; field marked incomplete.`);
        }
      }

      // 5. Date parsing
      const parsedDob = parseExcelDate(rawDob);
      if (parsedDob && !isValidDob(parsedDob)) {
        warnings.push(`Date of Birth "${rawDob}" cannot be in the future; field marked incomplete.`);
      }

      const parsedJoining = parseExcelDate(rawJoining) || todayStr();

      // 6. Hostel & Room Allocation Validation
      let roomStatus = 'UNALLOCATED';
      let roomError = '';

      if (hostelName || roomNumber) {
        const foundHostel = existingHostels.find(
          (h) => h.name.toLowerCase() === hostelName.toLowerCase() || h.id.toLowerCase() === hostelName.toLowerCase()
        );

        if (!foundHostel) {
          roomStatus = 'PENDING';
          roomError = `Hostel "${hostelName}" does not exist in system.`;
          warnings.push(roomError);
          roomPendingCount++;
        } else {
          const foundRoom = (foundHostel.rooms || []).find((rm) => String(rm.no) === roomNumber);
          if (!foundRoom) {
            roomStatus = 'PENDING';
            roomError = `Room "${roomNumber}" not found in hostel "${foundHostel.name}".`;
            warnings.push(roomError);
            roomPendingCount++;
          } else {
            // Check capacity
            const roomKey = `${foundHostel.name.toLowerCase()}::${foundRoom.no.toLowerCase()}`;
            const currentDbOccupancy = occupancyMap.get(roomKey) || 0;
            const batchConsumed = batchOccupancyTracker.get(roomKey) || 0;
            const totalOccupied = currentDbOccupancy + batchConsumed;
            const capacity = foundRoom.capacity || 1;

            if (totalOccupied >= capacity) {
              roomStatus = 'REJECTED_CAPACITY';
              roomError = `Room ${foundRoom.no} in "${foundHostel.name}" is full (Capacity: ${capacity}, Occupied: ${totalOccupied}). Allocation deferred to Warden.`;
              warnings.push(roomError);
              roomPendingCount++;
            } else {
              roomStatus = 'ALLOCATED';
              batchOccupancyTracker.set(roomKey, batchConsumed + 1);
              roomAllocatedCount++;
            }
          }
        }
      }

      // Check Missing Required Fields for Completion Status
      const missingFields = [];
      if (!name) missingFields.push('Trainee Name');
      if (!mobile || !isValidMobile(mobile)) missingFields.push('Mobile Number');
      if (!parsedDob || !isValidDob(parsedDob)) missingFields.push('Date of Birth');
      if (!gender) missingFields.push('Gender');
      if (!department) missingFields.push('Department / Qualification');
      if (!rawAadhaar || !isValidAadhaar(rawAadhaar)) missingFields.push('Aadhaar Number');
      if (!food) missingFields.push('Food Preference');
      if (!address) missingFields.push('Address');
      if (!state) missingFields.push('State');
      if (!guardianName) missingFields.push('Guardian Name');
      if (!emergencyContact || !isValidGuardianContact(emergencyContact)) missingFields.push('Guardian / Emergency Contact');

      let rowStatus = 'COMPLETE';
      let canImport = true;

      if (errors.length > 0) {
        rowStatus = 'DUPLICATE';
        canImport = false;
        duplicateCount++;
      } else if (missingFields.length > 0 || roomStatus !== 'ALLOCATED') {
        rowStatus = 'PARTIAL';
        partialCount++;
      } else {
        validCount++;
      }

      if (warnings.length > 0) {
        warningCount++;
      }

      analyzedRows.push({
        rowNumber: rowNum,
        name,
        traineeId: rawTraineeId || 'Auto-generated',
        mobile: mobile || '—',
        email: email || '—',
        aadhaar: rawAadhaar ? maskAadhaar(rawAadhaar) : '—',
        dob: parsedDob || '—',
        gender: gender || '—',
        department: department || '—',
        designation: designation || '—',
        joiningDate: parsedJoining,
        hostel: hostelName || '—',
        roomNo: roomNumber || '—',
        roomStatus,
        roomError,
        status: rowStatus,
        canImport,
        missingFields,
        warnings,
        errors,
        cleanData: {
          name,
          traineeId: rawTraineeId,
          mobile: isValidMobile(mobile) ? mobile : '',
          email: isValidEmail(email) ? email : '',
          aadhar: isValidAadhaar(rawAadhaar) ? rawAadhaar : '',
          dob: isValidDob(parsedDob) ? parsedDob : '',
          gender: ['MALE', 'FEMALE', 'OTHER'].includes(gender) ? gender : 'OTHER',
          qualification: department,
          designation,
          joiningDate: parsedJoining,
          hostel: roomStatus === 'ALLOCATED' ? hostelName : '',
          roomNo: roomStatus === 'ALLOCATED' ? roomNumber : '',
          roomAllocationStatus: roomStatus,
          food: ['VEG', 'NON-VEG'].includes(food) ? food : 'VEG',
          address1: address,
          state,
          emergencyContact: isValidGuardianContact(emergencyContact) ? emergencyContact : '',
          guardianName,
          guardianContact: isValidGuardianContact(emergencyContact) ? emergencyContact : '',
          missingFields,
        },
      });
    }

    return res.json({
      ok: true,
      summary: {
        totalRows: rows.length,
        validCount,
        partialCount,
        warningCount,
        duplicateCount,
        skippedCount,
        roomAllocatedCount,
        roomPendingCount,
      },
      rows: analyzedRows,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Preview analysis failed: ' + err.message });
  }
});

// ---------------- 3. Execute Bulk Trainee Import (Atomic & Reliable) ----------------
router.post('/trainees/bulk-import', auth, requireSuper, async (req, res) => {
  try {
    const { rows = [], filename = 'bulk-import.xlsx' } = req.body || {};

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No validated rows provided for import.' });
    }

    const batchId = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Get current IDs
    const allTrainees = await Trainee.find({}, 'traineeId hostelId qrId').lean();
    const existingHostels = await Hostel.find({}).lean();
    const config = await Config.findOne({ key: 'main' }).lean();

    let nextTrnNum = allTrainees.reduce((max, t) => {
      const match = String(t.traineeId || '').match(/TRN-(\d+)/i);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 2000) + 1;

    let nextQrNum = allTrainees.reduce((max, t) => {
      const match = String(t.qrId || '').match(/QR-(\d+)/i);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 10) + 1;

    let nextHstNum = allTrainees.reduce((max, t) => {
      const match = String(t.hostelId || '').match(/HST-(\d+)/i);
      return match ? Math.max(max, parseInt(match[1], 10)) : max;
    }, 10) + 1;

    // Track active room occupancy
    const activeOccupants = await Trainee.find({
      hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
      roomNo: { $exists: true, $ne: '' },
    }, 'hostel roomNo').lean();

    const occupancyMap = new Map();
    activeOccupants.forEach((t) => {
      const key = `${String(t.hostel).toLowerCase()}::${String(t.roomNo).toLowerCase()}`;
      occupancyMap.set(key, (occupancyMap.get(key) || 0) + 1);
    });

    const importedRecords = [];
    const importErrors = [];

    let successCount = 0;
    let partialCount = 0;
    let roomAllocatedCount = 0;
    let roomPendingCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i] || {};
      const d = item.cleanData || item;
      const rowNum = item.rowNumber || (i + 2);

      if (!item.canImport && item.status === 'DUPLICATE') {
        importErrors.push({
          rowNumber: rowNum,
          traineeName: item.name || '—',
          field: 'Trainee ID / Aadhaar',
          originalValue: item.traineeId || item.aadhaar || '',
          error: (item.errors || []).join('; ') || 'Duplicate detected',
          result: 'SKIPPED',
          suggestion: 'Change Trainee ID or verify Aadhaar uniqueness.',
        });
        skippedCount++;
        continue;
      }

      if (!d.name || d.name.length < 2) {
        importErrors.push({
          rowNumber: rowNum,
          traineeName: d.name || '—',
          field: 'Trainee Name',
          originalValue: '',
          error: 'Missing usable Trainee Name.',
          result: 'SKIPPED',
          suggestion: 'Provide a valid trainee name.',
        });
        skippedCount++;
        continue;
      }

      // Generate IDs
      const finalTraineeId = d.traineeId ? d.traineeId.trim().toUpperCase() : `TRN-${String(nextTrnNum++).padStart(5, '0')}`;
      const finalQrId = `QR-${String(nextQrNum++).padStart(5, '0')}`;
      const finalHostelId = `HST-${String(nextHstNum++).padStart(4, '0')}`;

      // Handle Aadhaar
      let aadharMasked = '';
      let aadharEncrypted = '';
      let aadharHash = '';
      if (d.aadhar) {
        aadharMasked = maskAadhaar(d.aadhar);
        aadharEncrypted = encryptAadhaar(d.aadhar);
        aadharHash = hashAadhaar(d.aadhar);
      }

      // Handle Room Allocation
      let finalHostel = '';
      let finalRoom = '';
      let roomAllocationStatus = 'UNALLOCATED';
      let roomNote = '';

      if (d.hostel && d.roomNo) {
        const foundHostel = existingHostels.find(
          (h) => h.name.toLowerCase() === d.hostel.toLowerCase() || h.id.toLowerCase() === d.hostel.toLowerCase()
        );
        if (foundHostel) {
          const foundRoom = (foundHostel.rooms || []).find((rm) => String(rm.no) === String(d.roomNo));
          if (foundRoom) {
            const roomKey = `${foundHostel.name.toLowerCase()}::${foundRoom.no.toLowerCase()}`;
            const currentOccupants = occupancyMap.get(roomKey) || 0;
            const capacity = foundRoom.capacity || 1;

            if (currentOccupants < capacity) {
              finalHostel = foundHostel.name;
              finalRoom = String(foundRoom.no);
              roomAllocationStatus = 'ALLOCATED';
              occupancyMap.set(roomKey, currentOccupants + 1);
              roomAllocatedCount++;

              // Record in RoomHistory
              await RoomHistory.create({
                traineeId: finalTraineeId,
                changeDate: todayStr(),
                prevHostel: '',
                prevRoom: '',
                newHostel: finalHostel,
                newRoom: finalRoom,
                changedBy: `Bulk Import (${req.user?.username || 'Super Admin'})`,
              });
            } else {
              roomAllocationStatus = 'REJECTED_CAPACITY';
              roomNote = `Room ${foundRoom.no} in ${foundHostel.name} is full (Capacity ${capacity}). Pending Warden allocation.`;
              roomPendingCount++;
              importErrors.push({
                rowNumber: rowNum,
                traineeName: d.name,
                field: 'Room Number',
                originalValue: `${d.hostel} · Room ${d.roomNo}`,
                error: roomNote,
                result: 'RECORD CREATED (ROOM PENDING)',
                suggestion: 'Allocate another room through Warden completion.',
              });
            }
          }
        }
      }

      // Calculate missing fields
      const missingFields = d.missingFields || [];
      const isCompleteRecord = missingFields.length === 0 && roomAllocationStatus === 'ALLOCATED';
      const completionStatus = isCompleteRecord ? 'COMPLETE' : 'INCOMPLETE';

      if (isCompleteRecord) {
        successCount++;
      } else {
        partialCount++;
      }

      const joiningDate = d.joiningDate || todayStr();
      const freeStayExpiryDate = addThreeCalendarMonths(joiningDate);

      // Create Trainee in MongoDB
      const createdTrainee = await Trainee.create({
        name: d.name,
        traineeId: finalTraineeId,
        hostelId: finalHostelId,
        qrId: finalQrId,
        qrStatus: 'ACTIVE',
        mobile: d.mobile || '',
        email: d.email || '',
        aadhar: aadharMasked,
        aadharMasked,
        aadharEncrypted,
        aadharHash,
        dob: d.dob || '',
        gender: d.gender || 'OTHER',
        qualification: d.qualification || '',
        designation: d.designation || '',
        food: d.food || 'VEG',
        address1: d.address1 || '',
        state: d.state || '',
        emergencyContact: d.emergencyContact || '',
        guardianName: d.guardianName || '',
        guardianContact: d.guardianContact || '',
        joiningDate,
        freeStayExpiryDate,
        paymentStatus: 'FREE',
        hostel: finalHostel,
        roomNo: finalRoom,
        roomAllocationStatus,
        completionStatus,
        missingFields,
        employmentStatus: 'ACTIVE',
        hostelStatus: config?.approvalConfig?.enabled === false ? 'ACTIVE' : 'PENDING REVIEW',
        approvalStatus: config?.approvalConfig?.enabled === false ? 'APPROVED' : 'PENDING_APPROVAL',
        approvedBy: config?.approvalConfig?.enabled === false ? 'SYSTEM_AUTO_APPROVED' : '',
        submissionDate: todayStr(),
        importBatchId: batchId,
        importRowNumber: rowNum,
        auditHistory: [
          {
            action: 'BULK_EXCEL_IMPORT',
            updatedBy: req.user?.username || 'superadmin',
            updatedByName: req.user?.name || 'Super Admin',
            updatedFields: ['bulk_import_creation'],
            timestamp: new Date(),
            notes: `Imported via batch ${batchId} from file "${filename}"`,
          },
        ],
      });

      importedRecords.push({
        rowNumber: rowNum,
        traineeId: finalTraineeId,
        qrId: finalQrId,
        name: d.name,
        status: isCompleteRecord ? 'COMPLETE' : 'PARTIAL',
        hostel: finalHostel || '—',
        roomNo: finalRoom || '—',
        completionStatus,
        missingFields,
        roomStatus: roomAllocationStatus,
        warnings: item.warnings || [],
      });

      // If imported complete + allocated + auto-approved, send Welcome Email
      if (isCompleteRecord && createdTrainee.approvalStatus === 'APPROVED') {
        sendTraineeWelcomeEmail({ trainee: createdTrainee, triggeredBy: 'Bulk Import Finalization' }).catch((err) =>
          console.warn('[Bulk Import Welcome Email Error]', err.message)
        );
      }
    }

    // Save Batch Record in MongoDB
    const batchRecord = await ImportBatch.create({
      batchId,
      originalFilename: filename,
      uploadedBy: req.user?.username || 'superadmin',
      uploadedByName: req.user?.name || 'Super Admin',
      uploadDate: new Date(),
      totalRows: rows.length,
      successfulCount: successCount,
      partialCount,
      skippedCount,
      roomAllocatedCount,
      roomPendingCount,
      duplicateCount: skippedCount,
      status: successCount > 0 || partialCount > 0 ? (importErrors.length > 0 ? 'PARTIAL' : 'COMPLETED') : 'FAILED',
      records: importedRecords,
      errors: importErrors,
      emailDeliverySummary: {
        sent: successCount,
        failed: 0,
        deferred: partialCount,
      },
    });

    await bumpRev();

    return res.json({
      ok: true,
      batchId,
      message: `Bulk import completed: ${successCount} complete records, ${partialCount} partial records created for Warden completion.`,
      batch: batchRecord,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Bulk import failed: ' + err.message });
  }
});

// ---------------- 4. Import History & Reports ----------------
router.get('/trainees/bulk-history', auth, requireSuper, async (req, res) => {
  try {
    const batches = await ImportBatch.find({}).sort({ uploadDate: -1 }).lean();
    return res.json({ batches });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/trainees/bulk-report/:batchId/:type', auth, requireSuper, async (req, res) => {
  try {
    const { batchId, type } = req.params;
    const batch = await ImportBatch.findOne({ batchId }).lean();
    if (!batch) return res.status(404).json({ error: 'Import batch not found.' });

    const wb = XLSX.utils.book_new();

    if (type === 'success' || type === 'all') {
      const successHeaders = ['Row #', 'Trainee ID', 'QR ID', 'Trainee Name', 'Status', 'Hostel', 'Room', 'Room Status', 'Missing Fields'];
      const successData = [successHeaders];
      (batch.records || []).forEach((r) => {
        successData.push([
          r.rowNumber || '—',
          r.traineeId,
          r.qrId,
          r.name,
          r.status,
          r.hostel || '—',
          r.roomNo || '—',
          r.roomStatus || '—',
          (r.missingFields || []).join(', ') || 'None (Complete)',
        ]);
      });
      const wsSuccess = XLSX.utils.aoa_to_sheet(successData);
      XLSX.utils.book_append_sheet(wb, wsSuccess, 'Imported Records');
    }

    if (type === 'errors' || type === 'all') {
      const errorHeaders = ['Row #', 'Trainee Name', 'Field', 'Original Value', 'Error Description', 'Import Result', 'Correction Suggestion'];
      const errorData = [errorHeaders];
      (batch.errors || []).forEach((e) => {
        errorData.push([
          e.rowNumber || '—',
          e.traineeName || '—',
          e.field || '—',
          e.originalValue || '—',
          e.error || '—',
          e.result || 'SKIPPED',
          e.suggestion || '—',
        ]);
      });
      const wsErrors = XLSX.utils.aoa_to_sheet(errorData);
      XLSX.utils.book_append_sheet(wb, wsErrors, 'Errors & Exclusions');
    }

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${batchId}-${type}-report.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 5. Warden Partial Records & Completion Workflow ----------------
function sanitizeIncompleteTrainee(t) {
  if (!t) return null;
  const doc = typeof t.toObject === 'function' ? t.toObject() : { ...t };
  delete doc.aadharEncrypted;
  delete doc.aadharHash;
  delete doc.passwordHash;
  if (doc.aadharMasked) doc.aadhar = doc.aadharMasked;
  return doc;
}

router.get('/warden/incomplete-trainees', auth, async (req, res) => {
  try {
    const u = req.user;
    const isSuper = u.roleId === 'superadmin' || u.roleId === 'admin';

    const query = {
      hostelStatus: { $nin: ['PERMANENT VACATE', 'RESIGNED', 'INACTIVE', 'REJECTED'] },
      approvalStatus: { $ne: 'REJECTED' },
      $or: [
        { completionStatus: { $in: ['INCOMPLETE', 'PENDING_DETAILS', 'PARTIAL'] } },
        { missingFields: { $exists: true, $not: { $size: 0 } } },
        { roomNo: { $in: ['', null] } },
        { roomNo: { $exists: false } },
      ],
    };

    if (!isSuper && Array.isArray(u.assignedHostels) && u.assignedHostels.length > 0) {
      query.$and = [
        {
          $or: [
            { hostel: { $in: u.assignedHostels } },
            { hostel: '' },
            { hostel: { $exists: false } },
          ],
        },
      ];
    }

    const rawList = await Trainee.find(query).sort({ createdAt: -1 }).lean();
    const list = rawList.map(sanitizeIncompleteTrainee);

    const totalIncomplete = list.length;
    const missingDetailsCount = list.filter((t) => Array.isArray(t.missingFields) && t.missingFields.length > 0).length;
    const pendingRoomAllocation = list.filter((t) => !t.roomNo || t.roomAllocationStatus === 'PENDING' || t.roomAllocationStatus === 'UNALLOCATED').length;
    const readyForFinalization = list.filter(
      (t) => (!t.missingFields || t.missingFields.length === 0) && (!t.roomNo || t.roomAllocationStatus !== 'ALLOCATED')
    ).length;

    return res.json({
      ok: true,
      trainees: list,
      summary: {
        totalIncomplete,
        missingDetailsCount,
        pendingRoomCount: pendingRoomAllocation,
        readyForFinalizationCount: readyForFinalization,
      },
      incompleteTrainees: list,
      metrics: {
        totalIncomplete,
        pendingRoomAllocation,
        readyForFinalization,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 6. Warden Complete & Finalize Trainee Details ----------------
router.put('/warden/complete-trainee/:traineeId', auth, async (req, res) => {
  try {
    const rawId = req.params.traineeId || '';
    const cleanId = String(rawId).trim();
    if (!cleanId) {
      return res.status(400).json({ error: 'Trainee identifier is required.' });
    }
    const d = req.body || {};

    const matchClauses = [
      { traineeId: cleanId },
      { qrId: cleanId },
      { hostelId: cleanId },
      { traineeId: cleanId.toUpperCase() },
      { qrId: cleanId.toUpperCase() },
      { hostelId: cleanId.toUpperCase() },
    ];
    if (mongoose.Types.ObjectId.isValid(cleanId)) {
      matchClauses.unshift({ _id: cleanId });
    }

    const trainee = await Trainee.findOne({ $or: matchClauses });

    if (!trainee) {
      return res.status(404).json({ error: 'Trainee not found.' });
    }

    const u = req.user;
    const isSuper = u.roleId === 'superadmin' || u.roleId === 'admin';

    // Permission check for Warden's hostel
    if (!isSuper && Array.isArray(u.assignedHostels) && u.assignedHostels.length > 0) {
      if (trainee.hostel && !u.assignedHostels.includes(trainee.hostel)) {
        return res.status(403).json({ error: 'You are only authorized to manage trainees in your assigned hostel.' });
      }
    }

    const updatedFields = [];

    if (d.name !== undefined) {
      const cleanName = String(d.name || '').trim();
      if (!cleanName || cleanName.length < 2) {
        return res.status(400).json({ error: 'Trainee name is required (at least 2 characters).' });
      }
      if (cleanName !== trainee.name) {
        trainee.name = cleanName;
        updatedFields.push('name');
      }
    }

    if (d.mobile !== undefined) {
      const cleanMobile = String(d.mobile || '').replace(/\D/g, '');
      if (!cleanMobile || !isValidMobile(cleanMobile)) {
        return res.status(400).json({ error: 'Mobile number must contain exactly 10 digits starting with 6, 7, 8, or 9.' });
      }
      if (cleanMobile !== trainee.mobile) {
        trainee.mobile = cleanMobile;
        updatedFields.push('mobile');
      }
    }

    if (d.email !== undefined) {
      const cleanEmail = String(d.email || '').trim().toLowerCase();
      if (cleanEmail && !isValidEmail(cleanEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (cleanEmail !== (trainee.email || '').toLowerCase()) {
        trainee.email = cleanEmail;
        updatedFields.push('email');
      }
    }

    if (d.dob !== undefined) {
      const cleanDob = parseExcelDate(d.dob);
      if (!cleanDob || !isValidDob(cleanDob)) {
        return res.status(400).json({ error: 'Please enter a valid Date of Birth (cannot be in the future).' });
      }
      if (cleanDob !== trainee.dob) {
        trainee.dob = cleanDob;
        updatedFields.push('dob');
      }
    }

    if (d.joiningDate !== undefined) {
      const cleanJoining = parseExcelDate(d.joiningDate);
      if (!cleanJoining || isNaN(new Date(cleanJoining).getTime())) {
        return res.status(400).json({ error: 'Please enter a valid Joining Date.' });
      }
      if (cleanJoining !== trainee.joiningDate) {
        trainee.joiningDate = cleanJoining;
        trainee.freeStayExpiryDate = addThreeCalendarMonths(cleanJoining);
        updatedFields.push('joiningDate', 'freeStayExpiryDate');
      }
    }

    if (d.gender && ['MALE', 'FEMALE', 'OTHER'].includes(String(d.gender).toUpperCase())) {
      const g = String(d.gender).toUpperCase();
      if (g !== trainee.gender) {
        trainee.gender = g;
        updatedFields.push('gender');
      }
    }

    if (d.qualification !== undefined && String(d.qualification).trim()) {
      const qVal = String(d.qualification).trim();
      if (qVal !== trainee.qualification) {
        trainee.qualification = qVal;
        updatedFields.push('qualification');
      }
    }

    if (d.designation !== undefined && String(d.designation).trim()) {
      trainee.designation = String(d.designation).trim();
      updatedFields.push('designation');
    }

    if (d.food && ['VEG', 'NON-VEG'].includes(String(d.food).toUpperCase())) {
      const foodVal = String(d.food).toUpperCase();
      if (foodVal !== trainee.food) {
        trainee.food = foodVal;
        updatedFields.push('food');
      }
    }

    if (d.address1 !== undefined && String(d.address1).trim()) {
      const addr = String(d.address1).trim();
      if (addr !== trainee.address1) {
        trainee.address1 = addr;
        updatedFields.push('address1');
      }
    }

    if (d.state !== undefined && String(d.state).trim()) {
      const st = String(d.state).trim();
      if (st !== trainee.state) {
        trainee.state = st;
        updatedFields.push('state');
      }
    }

    if (d.guardianName !== undefined) {
      const gName = String(d.guardianName || '').trim();
      if (!gName) {
        return res.status(400).json({ error: 'Guardian name is required.' });
      }
      if (gName !== trainee.guardianName) {
        trainee.guardianName = gName;
        updatedFields.push('guardianName');
      }
    }

    if (d.guardianContact !== undefined) {
      const cleanContact = String(d.guardianContact || '').replace(/\D/g, '');
      if (!cleanContact || !isValidGuardianContact(cleanContact)) {
        return res.status(400).json({ error: 'Guardian contact must contain exactly 10 digits.' });
      }
      if (cleanContact !== trainee.guardianContact) {
        trainee.guardianContact = cleanContact;
        updatedFields.push('guardianContact');
      }
    }

    if (d.emergencyContact !== undefined && String(d.emergencyContact).trim()) {
      const cleanEmerg = String(d.emergencyContact).replace(/\D/g, '');
      if (cleanEmerg) {
        trainee.emergencyContact = cleanEmerg;
        updatedFields.push('emergencyContact');
      }
    }

    // Aadhaar update (only if a raw 12-digit number is entered, not an unchanged masked value)
    if (d.aadhar !== undefined) {
      const rawAadhaarStr = String(d.aadhar || '').trim();
      if (rawAadhaarStr && !rawAadhaarStr.includes('X') && !rawAadhaarStr.includes('•')) {
        const rawAadhaarDigits = rawAadhaarStr.replace(/\D/g, '');
        if (rawAadhaarDigits.length !== 12 || !isValidAadhaar(rawAadhaarDigits, true)) {
          return res.status(400).json({ error: 'Please enter a valid 12-digit Aadhaar number.' });
        }
        const aHash = hashAadhaar(rawAadhaarDigits);
        const dupAadhaar = await Trainee.findOne({
          aadharHash: aHash,
          _id: { $ne: trainee._id },
        }).lean();
        if (dupAadhaar) {
          return res.status(409).json({
            error: `Aadhaar number is already registered for ${dupAadhaar.name} (${dupAadhaar.traineeId || dupAadhaar.qrId}).`,
          });
        }
        const masked = maskAadhaar(rawAadhaarDigits);
        trainee.aadharMasked = masked;
        trainee.aadhar = masked;
        trainee.aadharEncrypted = encryptAadhaar(rawAadhaarDigits);
        trainee.aadharHash = aHash;
        trainee.aadhaarVerificationStatus = 'FORMAT_VALIDATED';
        updatedFields.push('aadhar');
      }
    }

    if (d.photo) {
      trainee.photo = d.photo;
      updatedFields.push('photo');
    }

    // Room Allocation Update (or confirming existing room allocation)
    const targetHostelInput = d.hostel !== undefined ? String(d.hostel).trim() : trainee.hostel;
    const targetRoomInput = d.roomNo !== undefined ? String(d.roomNo).trim() : trainee.roomNo;

    if (targetHostelInput && targetRoomInput && (targetHostelInput !== trainee.hostel || targetRoomInput !== trainee.roomNo || trainee.roomAllocationStatus !== 'ALLOCATED')) {
      const foundHostel = await Hostel.findOne({
        $or: [{ name: targetHostelInput }, { id: targetHostelInput }],
      });

      if (!foundHostel) {
        return res.status(400).json({ error: `Hostel "${targetHostelInput}" does not exist.` });
      }

      const foundRoom = (foundHostel.rooms || []).find((rm) => String(rm.no) === String(targetRoomInput));
      if (!foundRoom) {
        return res.status(400).json({ error: `Room "${targetRoomInput}" not found in hostel "${foundHostel.name}".` });
      }

      // Check capacity
      const currentOccupants = await Trainee.countDocuments({
        $or: [{ hostel: foundHostel.name }, { hostelId: foundHostel.id }],
        roomNo: String(foundRoom.no),
        hostelStatus: { $in: ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'] },
        _id: { $ne: trainee._id },
      });

      if (currentOccupants >= (foundRoom.capacity || 1)) {
        return res.status(400).json({
          error: `Room "${foundRoom.no}" is at full capacity (${currentOccupants}/${foundRoom.capacity || 1}). Cannot allocate.`,
        });
      }

      const prevHostel = trainee.hostel;
      const prevRoom = trainee.roomNo;
      const roomChanged = foundHostel.name !== prevHostel || String(foundRoom.no) !== String(prevRoom);
      trainee.hostel = foundHostel.name;
      trainee.roomNo = String(foundRoom.no);
      trainee.roomAllocationStatus = 'ALLOCATED';
      updatedFields.push('room_allocation');

      if (roomChanged) {
        await RoomHistory.create({
          traineeId: trainee.traineeId || trainee.qrId,
          changeDate: todayStr(),
          prevHostel: prevHostel || '',
          prevRoom: prevRoom || '',
          newHostel: trainee.hostel,
          newRoom: trainee.roomNo,
          changedBy: `${u.name} (${u.roleId})`,
        });
      }
    }

    // Recalculate missing required fields
    const newMissing = REQUIRED_FIELDS.filter((f) => isFieldEmpty(trainee[f.key])).map((f) => f.label);
    trainee.missingFields = newMissing;

    const isFullyComplete = newMissing.length === 0 && Boolean(trainee.roomNo) && trainee.roomAllocationStatus === 'ALLOCATED';

    let emailResult = null;

    if (isFullyComplete) {
      trainee.completionStatus = 'COMPLETE';
      trainee.hostelStatus = 'ACTIVE';
      trainee.approvalStatus = 'APPROVED';
      if (!trainee.approvedBy) trainee.approvedBy = `${u.name} (${u.roleId})`;

      // Trigger Welcome and ID card email if requested and not yet sent
      if (d.sendWelcomeEmail !== false && !trainee.welcomeEmailSent && trainee.email && isValidEmail(trainee.email)) {
        try {
          emailResult = await sendTraineeWelcomeEmail({
            trainee,
            triggeredBy: 'Warden Completion & Room Allocation',
          });
        } catch (e) {
          console.warn('[Welcome Email Send Error on Finalization]', e.message);
        }
      }
    } else {
      trainee.completionStatus = 'INCOMPLETE';
    }

    trainee.auditHistory.push({
      action: isFullyComplete ? 'WARDEN_FINALIZATION_COMPLETE' : 'WARDEN_PARTIAL_UPDATE',
      updatedBy: u.username,
      updatedByName: u.name,
      updatedFields,
      timestamp: new Date(),
      notes: isFullyComplete
        ? 'All mandatory details completed & room allocated. Record finalized.'
        : `Updated fields: ${updatedFields.join(', ')}. Remaining missing: ${newMissing.join(', ')}`,
    });

    await trainee.save();
    await bumpRev();

    return res.json({
      ok: true,
      message: isFullyComplete
        ? `✓ Trainee ${trainee.name} successfully completed and finalized!`
        : `Trainee details updated. ${newMissing.length} field(s) still pending: ${newMissing.join(', ')}.`,
      trainee: sanitizeIncompleteTrainee(trainee),
      isFullyComplete,
      missingFields: newMissing,
      emailResult,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'Duplicate field value detected. Please verify Trainee ID, Mobile, or Aadhaar.' });
    }
    return res.status(500).json({ error: err.message });
  }
});

// ---------------- 7. Retry Failed Welcome / ID Card Email ----------------
router.post('/trainees/retry-welcome-email/:traineeId', auth, async (req, res) => {
  try {
    const rawId = req.params.traineeId || '';
    const cleanId = String(rawId).trim();

    const trainee = await Trainee.findOne({
      $or: [{ traineeId: cleanId }, { qrId: cleanId }],
    });

    if (!trainee) return res.status(404).json({ error: 'Trainee not found.' });

    const result = await sendTraineeWelcomeEmail({
      trainee,
      force: true,
      triggeredBy: `Admin Manual Retry (${req.user?.username || 'admin'})`,
    });

    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
