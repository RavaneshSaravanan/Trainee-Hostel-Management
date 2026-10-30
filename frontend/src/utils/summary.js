import { daysDiff } from './dates.js';
import { addThreeCalendarMonths } from './validity.js';
import { ROOM_HOLDING_STATUSES, ATT_CODES } from '../data/constants.js';

const overlapDays = (recFrom, recTo, from, to) => {
  const start = recFrom > from ? recFrom : from;
  const end = recTo && recTo < to ? recTo : to;
  const d = daysDiff(start, end) + 1;
  return d > 0 ? d : 0;
};

export function computeSummary(db, traineeId, from, to) {
  const trainee = (db.trainees || []).find((t) => t.traineeId === traineeId);
  const att = (db.attendance || []).filter((a) => a.traineeId === traineeId && a.date >= from && a.date <= to);
  const count = (code) => att.filter((a) => a.status === code).length;
  const A = count('A'), B = count('B'), C = count('C'), G = count('G'), H12 = count('12HRS');
  const WO = count('WO'), L = count('L'), OUT = count('OUTING');

  const workingDays = A + B + C + G + H12;
  const livingDays = workingDays + WO + L + OUT;

  let tempVacateDays = 0;
  let permVacateDays = 0;
  (db.outingVacate || [])
    .filter((o) => o.traineeId === traineeId && (o.type === 'TEMPORARY VACATE' || o.type === 'PERMANENT VACATE'))
    .forEach((o) => {
      const days = overlapDays(o.fromDate, o.expectedReturn || to, from, to);
      if (o.type === 'TEMPORARY VACATE') tempVacateDays += days;
      else permVacateDays += days;
    });

  // Free vs Paid Living Days calculation (3 calendar months free period rule)
  const joiningDate = trainee?.joiningDate || '';
  const expiryDate = joiningDate ? addThreeCalendarMonths(joiningDate) : '';

  let freeLivingDays = 0;
  let paidLivingDays = 0;

  if (livingDays > 0) {
    if (!joiningDate || !expiryDate || expiryDate >= to) {
      freeLivingDays = livingDays;
      paidLivingDays = 0;
    } else if (expiryDate < from) {
      freeLivingDays = 0;
      paidLivingDays = livingDays;
    } else {
      // Expires partway through month
      let freeCount = 0;
      let paidCount = 0;
      for (const a of att) {
        if (['A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING'].includes(a.status)) {
          if (a.date <= expiryDate) freeCount++;
          else paidCount++;
        }
      }
      if (freeCount + paidCount === livingDays) {
        freeLivingDays = freeCount;
        paidLivingDays = paidCount;
      } else {
        const totalSpan = daysDiff(from, to) + 1;
        const freeSpan = Math.max(0, daysDiff(from, expiryDate) + 1);
        const freeRatio = Math.min(1, Math.max(0, freeSpan / totalSpan));
        freeLivingDays = Math.round(livingDays * freeRatio);
        paidLivingDays = livingDays - freeLivingDays;
      }
    }
  }

  return {
    A, B, C, G, H12, WO, L, OUT,
    workingDays, livingDays,
    tempVacateDays, permVacateDays,
    vacatedDays: tempVacateDays + permVacateDays,
    freeLivingDays,
    paidLivingDays,
    totalLivingDays: livingDays,
    isFreeTrainee: freeLivingDays > 0,
    isPaidTrainee: paidLivingDays > 0 || trainee?.paymentStatus === 'PAID',
  };
}

/** Trainees currently holding a place in a given room. */
export const occupantsOf = (db, hostel, roomNo) =>
  (db.trainees || []).filter(
    (t) => t.hostel === hostel && t.roomNo === roomNo && ROOM_HOLDING_STATUSES.includes(t.hostelStatus)
  );

export function dayCounts(db, date) {
  const marked = Object.fromEntries(ATT_CODES.map((c) => [c, 0]));
  (db.attendance || []).forEach((a) => {
    if (a.date === date && marked[a.status] !== undefined) marked[a.status]++;
  });
  const manual = ((db.dailySummary || {})[date] || {}).manual || {};
  const final = {};
  ATT_CODES.forEach((c) => {
    const m = manual[c];
    final[c] = m !== undefined && m !== '' && m !== null ? Number(m) : marked[c];
  });
  return { marked, manual, final, total: Object.values(final).reduce((a, b) => a + b, 0) };
}
