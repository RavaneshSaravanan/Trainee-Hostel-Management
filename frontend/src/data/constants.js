export const SHIFTS = ['A', 'B', 'C', 'G', '12HRS', 'WO', 'L'];

export const SHIFT_OPTIONS = [
  { id: 'A', label: 'A Shift', short: 'A' },
  { id: 'B', label: 'B Shift', short: 'B' },
  { id: 'C', label: 'C Shift', short: 'C' },
  { id: 'G', label: 'G Shift', short: 'G' },
  { id: '12HRS', label: '12HRS Shift', short: '12HRS' },
  { id: 'WO', label: 'Week Off', short: 'Week Off' },
  { id: 'L', label: 'Leave', short: 'Leave' },
];

export const ATT_CODES = ['A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING'];

export const ATT_LABELS = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  G: 'General',
  '12HRS': '12 Hrs Shift',
  WO: 'Week Off',
  L: 'Leave',
  OUTING: 'Outing',
};

export const QUALIFICATIONS = ['ITI', 'Diploma', 'B.Tech', 'B.Sc', 'B.Com', 'Polytechnic'];

export const HOSTEL_STATUSES = [
  'PENDING REVIEW',
  'ACTIVE',
  'ON LEAVE',
  'OUTING',
  'TEMPORARY VACATE',
  'PERMANENT VACATE',
  'RESIGNED',
  'INACTIVE',
];

// Statuses in which a trainee still occupies a bed/room.
export const ROOM_HOLDING_STATUSES = ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'];

export const STATUS_COLOR = {
  'PENDING REVIEW': 'gray',
  PENDING: 'gray',
  ACTIVE: 'green',
  'ON LEAVE': 'amber',
  OUTING: 'blue',
  'TEMPORARY VACATE': 'orange',
  'PERMANENT VACATE': 'red',
  RESIGNED: 'red',
  INACTIVE: 'gray',
  OPEN: 'amber',
  RESOLVED: 'green',
  APPROVED: 'green',
  REJECTED: 'red',
  SUBMITTED: 'gray',
  COMPLETE: 'green',
  'DETAILS PENDING': 'red',
  REMARK: 'blue',
  COMPLAINT: 'orange',
  PRESENT: 'green',
  'WEEK OFF': 'blue',
  LEAVE: 'amber',
  WO: 'blue',
  L: 'amber',
  'ALREADY SCANNED': 'orange',
};
