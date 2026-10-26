// SAMPLE DATA — edit this file to change what the prototype starts with.
// Everything is fictional. Replace createSeed() with API calls to connect a real backend.

import { SHIFTS, QUALIFICATIONS } from './constants.js';
import { pad, todayStr, addDays, daysDiff } from '../utils/dates.js';

const FIRST = [
  'Arun', 'Vijay', 'Karthik', 'Suresh', 'Ramesh', 'Deepak', 'Manoj', 'Sanjay', 'Anil', 'Ravi',
  'Priya', 'Divya', 'Kavya', 'Sneha', 'Pooja', 'Anita', 'Neha', 'Swati', 'Meera', 'Lakshmi',
  'Arjun', 'Rahul', 'Vikram', 'Amit', 'Rohit', 'Nikhil', 'Varun', 'Siddharth', 'Harish', 'Gopal',
];
const LAST = ['Kumar', 'Sharma', 'Reddy', 'Nair', 'Iyer', 'Patel', 'Singh', 'Gupta', 'Rao', 'Menon'];
const PARENTS = ['Mohan', 'Raju', 'Sundar', 'Gopi', 'Kishore', 'Babu', 'Chandran', 'Dinesh', 'Elango', 'Ganesh'];
const FEMALE = new Set(['Priya', 'Divya', 'Kavya', 'Sneha', 'Pooja', 'Anita', 'Neha', 'Swati', 'Meera', 'Lakshmi']);
const PLACES = [
  ['Chittoor', 'Andhra Pradesh'], ['Coimbatore', 'Tamil Nadu'], ['Bengaluru Urban', 'Karnataka'],
  ['Krishna', 'Andhra Pradesh'], ['Warangal', 'Telangana'], ['Ernakulam', 'Kerala'],
  ['Nashik', 'Maharashtra'], ['Jaipur', 'Rajasthan'], ['Lucknow', 'Uttar Pradesh'], ['Patna', 'Bihar'],
];
const STREETS = ['Main Road', 'Gandhi Nagar', 'Temple Street', 'MG Road', 'Lake View Colony'];

export function createSeed() {
  const today = todayStr();
  const c = { hostel: 1, qr: 1, leave: 1, ov: 1, resign: 1, remark: 1 };
  const nid = (p, k, len) => `${p}-${pad(c[k]++, len)}`;

  const hostelNames = ['Hostel Aurora', 'Hostel Bhoomi', 'Hostel Chandra', 'Hostel Diya', 'Hostel Elan'];
  const hostels = hostelNames.map((name, hi) => ({
    id: `H${hi + 1}`,
    name,
    // Room numbers: Hostel 1 -> 101..108, Hostel 2 -> 201..208 ...  (no bed numbers, per spec)
    rooms: Array.from({ length: 8 }, (_, r) => ({ no: `${hi + 1}0${r + 1}`, capacity: 4 })),
  }));

  const db = {
    hostels,
    trainees: [],
    attendance: [],
    leaves: [],
    outingVacate: [],
    resignations: [],
    remarks: [],
    roomHistory: [],
  };

  // First N trainees get special statuses so every screen has data to show.
  const specials = [
    ...Array(3).fill('PENDING'),
    ...Array(2).fill('RESIGNED'),
    'PERMVACATE',
    ...Array(2).fill('ONLEAVE'),
    ...Array(2).fill('OUTING'),
    ...Array(2).fill('TEMPVACATE'),
  ];

  for (let i = 0; i < 30; i++) {
    const first = FIRST[i];
    const last = LAST[i % LAST.length];
    const gender = FEMALE.has(first) ? 'Female' : 'Male';
    const [district, state] = PLACES[i % PLACES.length];
    const hostel = hostels[i % hostels.length];
    const room = hostel.rooms[i % hostel.rooms.length];
    const special = specials[i] || null;
    const joiningDate = addDays(today, -(20 + i));

    let hostelStatus = 'ACTIVE';
    let employmentStatus = 'ACTIVE';
    let qrStatus = 'ACTIVE';
    let assignedHostel = hostel.name;
    let assignedRoom = room.no;
    let qrId = nid('QR', 'qr', 5);

    if (special === 'PENDING') {
      hostelStatus = 'PENDING REVIEW'; qrStatus = 'PENDING'; assignedHostel = ''; assignedRoom = ''; qrId = '';
      c.qr--; // QR number not consumed for pending trainees
    } else if (special === 'RESIGNED') {
      hostelStatus = 'RESIGNED'; employmentStatus = 'RESIGNED'; qrStatus = 'INACTIVE';
    } else if (special === 'PERMVACATE') {
      hostelStatus = 'PERMANENT VACATE'; qrStatus = 'INACTIVE';
    } else if (special === 'ONLEAVE') hostelStatus = 'ON LEAVE';
    else if (special === 'OUTING') hostelStatus = 'OUTING';
    else if (special === 'TEMPVACATE') hostelStatus = 'TEMPORARY VACATE';

    const approvedBy = special === 'PENDING' ? '' : i % 2 === 0 ? 'Hostel Incharge' : 'Admin';

    const t = {
      hostelId: nid('HST', 'hostel', 4),
      traineeId: 'TRN-' + pad(2000 + i + 1, 5),
      name: `${first} ${last}`,
      mobile: '9' + String(700000000 + i * 137 + 4211).slice(0, 9),
      email: `${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`,
      dob: addDays(today, -(19 * 365 + i * 40)),
      gender,
      qualification: QUALIFICATIONS[i % QUALIFICATIONS.length],
      aadhar: `XXXX-XXXX-${1000 + i}`,
      food: i % 2 === 0 ? 'VEG' : 'NON-VEG',
      joiningDate,
      address1: `${12 + i}, ${STREETS[i % 5]}`,
      district,
      state,
      guardianName: `${PARENTS[i % PARENTS.length]} ${last}`,
      guardianContact: '9' + String(600000000 + i * 211 + 3187).slice(0, 9),
      defaultShift: SHIFTS[i % SHIFTS.length],
      employmentStatus,
      hostelStatus,
      hostel: assignedHostel,
      roomNo: assignedRoom,
      qrId,
      qrStatus,
      photo: `https://i.pravatar.cc/160?img=${(i % 70) + 1}`,
      remarks: '',
      submissionDate: joiningDate,
      approvedBy,
    };
    db.trainees.push(t);

    if (assignedHostel) {
      db.roomHistory.push({
        traineeId: t.traineeId, prevHostel: '', prevRoom: '', newHostel: assignedHostel, newRoom: assignedRoom,
        changeDate: joiningDate, changedBy: approvedBy || 'Hostel Incharge',
      });
    }
  }

  // A few trainees have incomplete details so the red "pending" state is visible in the list.
  [4, 13, 21, 27].forEach((i) => { if (db.trainees[i]) { db.trainees[i].guardianName = ''; db.trainees[i].aadhar = '—'; } });

  // ---- Attendance: last 14 days for trainees who are currently living / working ----
  for (let d = 13; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = new Date(date + 'T00:00:00').getDay();
    db.trainees.forEach((t, i) => {
      if (['PENDING REVIEW', 'PERMANENT VACATE', 'TEMPORARY VACATE'].includes(t.hostelStatus)) return;
      if (t.employmentStatus === 'RESIGNED') return;
      let status;
      if (dow === 0 && i % 3 === 0) status = 'WO';
      else if (t.hostelStatus === 'ON LEAVE' && d < 3) status = 'L';
      else if (t.hostelStatus === 'OUTING' && d < 2) status = 'OUTING';
      else {
        const r = (i + d) % 17;
        status = r === 0 ? 'L' : r === 1 ? 'OUTING' : r === 2 ? 'WO' : t.defaultShift;
      }
      db.attendance.push({ traineeId: t.traineeId, date, status, markedBy: 'Hostel Incharge' });
    });
  }

  // ---- Leave ----
  [
    [0, -6, -4, 'Family function'], [3, -10, -8, 'Medical'], [7, -3, -1, 'Personal work'],
    [12, -15, -13, 'Festival at home'], [18, -2, 1, 'Family emergency'], [22, -20, -18, 'Wedding'],
  ].forEach(([idx, from, to, reason]) => {
    const t = db.trainees[idx];
    const fromDate = addDays(today, from);
    const toDate = addDays(today, to);
    db.leaves.push({
      id: nid('LV', 'leave', 4), traineeId: t.traineeId, leaveType: 'Casual Leave', fromDate, toDate,
      days: daysDiff(fromDate, toDate) + 1, reason, status: to < 0 ? 'APPROVED' : 'PENDING',
      remarks: '', leaveDate: addDays(fromDate, -2),
    });
  });
  db.trainees.filter((t) => t.hostelStatus === 'ON LEAVE').forEach((t) => {
    db.leaves.push({
      id: nid('LV', 'leave', 4), traineeId: t.traineeId, leaveType: 'Casual Leave',
      fromDate: addDays(today, -2), toDate: addDays(today, 1), days: 4, reason: 'Home visit',
      status: 'APPROVED', remarks: 'Approved by Hostel Incharge', leaveDate: addDays(today, -3),
    });
  });

  // ---- OUTING_VACATE (single source for OUTING / TEMPORARY VACATE / PERMANENT VACATE) ----
  db.trainees.filter((t) => t.hostelStatus === 'OUTING').forEach((t) => {
    db.outingVacate.push({
      id: nid('OV', 'ov', 4), traineeId: t.traineeId, date: today, type: 'OUTING', fromDate: today,
      expectedReturn: addDays(today, 1), reason: 'Local market visit', status: 'APPROVED', remarks: '',
    });
  });
  db.trainees.filter((t) => t.hostelStatus === 'TEMPORARY VACATE').forEach((t) => {
    db.outingVacate.push({
      id: nid('OV', 'ov', 4), traineeId: t.traineeId, date: addDays(today, -4), type: 'TEMPORARY VACATE',
      fromDate: addDays(today, -4), expectedReturn: addDays(today, 3), reason: 'Gone to hometown',
      status: 'APPROVED', remarks: 'Will return before month end',
    });
  });
  db.trainees.filter((t) => t.hostelStatus === 'PERMANENT VACATE').forEach((t) => {
    db.outingVacate.push({
      id: nid('OV', 'ov', 4), traineeId: t.traineeId, date: addDays(today, -10), type: 'PERMANENT VACATE',
      fromDate: addDays(today, -10), expectedReturn: '', reason: 'Relocated, will not return',
      status: 'APPROVED', remarks: 'Room vacated and inspected',
    });
  });
  [1, 5, 9].forEach((idx) => {
    const t = db.trainees[idx];
    db.outingVacate.push({
      id: nid('OV', 'ov', 4), traineeId: t.traineeId, date: addDays(today, -6), type: 'OUTING',
      fromDate: addDays(today, -6), expectedReturn: addDays(today, -6), reason: 'Bank work',
      status: 'APPROVED', remarks: '',
    });
  });

  // ---- Resignations ----
  db.trainees.filter((t) => t.employmentStatus === 'RESIGNED').forEach((t) => {
    db.resignations.push({
      id: nid('RS', 'resign', 4), traineeId: t.traineeId, resignationDate: addDays(today, -12),
      lastWorkingDate: addDays(today, -2), reason: 'Personal reasons', remarks: 'Exit formalities completed',
      status: 'APPROVED',
    });
  });

  // ---- Remarks / complaints ----
  [
    [2, 'COMPLAINT', 'Water leakage reported in bathroom', 'Plumber assigned', 'RESOLVED'],
    [4, 'REMARK', 'Trainee appreciated for punctuality', '—', 'RESOLVED'],
    [6, 'COMPLAINT', 'Noise complaint from adjacent room', 'Warned trainee, monitoring', 'OPEN'],
    [8, 'COMPLAINT', 'Electrical socket not working', 'Electrician informed', 'OPEN'],
    [11, 'REMARK', 'Requested room change due to allergy', 'Under review', 'OPEN'],
    [14, 'COMPLAINT', 'Mess food quality feedback', 'Forwarded to caterer', 'RESOLVED'],
    [16, 'REMARK', 'Volunteered for hostel cleanliness drive', '—', 'RESOLVED'],
    [20, 'COMPLAINT', 'WiFi connectivity issue in room', 'IT team notified', 'OPEN'],
  ].forEach(([idx, type, text, actionTaken, status]) => {
    db.remarks.push({
      id: nid('RM', 'remark', 4), traineeId: db.trainees[idx].traineeId,
      date: addDays(today, -(idx % 9) - 1), type, text, actionTaken, status,
      reportedBy: idx % 2 === 0 ? 'Hostel Incharge' : 'Admin',
    });
  });

  return db;
}
