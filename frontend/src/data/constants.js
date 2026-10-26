export const SHIFTS = ['A', 'B', 'C', 'G'];

export const ATT_CODES = ['A', 'B', 'C', 'G', 'WO', 'L', 'OUTING', '12HRS'];

export const ATT_LABELS = {
  A: 'A Shift',
  B: 'B Shift',
  C: 'C Shift',
  G: 'General',
  WO: 'Week Off',
  L: 'Leave',
  OUTING: 'Outing',
  '12HRS': '12 Hrs Shift',
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
};
