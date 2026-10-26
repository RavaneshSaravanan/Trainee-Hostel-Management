// BUSINESS RULES live here, in one place.
//
//   WORKING DAYS = A + B + C + G (+ 12HRS, treated as a working classification)
//   LIVING DAYS  = WORKING DAYS + WO + L + OUTING
//   VACATED DAYS = TEMPORARY VACATE + PERMANENT VACATE
//   Vacated days are NEVER counted as living days.

import { daysDiff } from './dates.js';
import { ROOM_HOLDING_STATUSES, ATT_CODES } from '../data/constants.js';

const overlapDays = (recFrom, recTo, from, to) => {
  const start = recFrom > from ? recFrom : from;
  const end = recTo && recTo < to ? recTo : to;
  const d = daysDiff(start, end) + 1;
  return d > 0 ? d : 0;
};

export function computeSummary(db, traineeId, from, to) {
  const att = db.attendance.filter((a) => a.traineeId === traineeId && a.date >= from && a.date <= to);
  const count = (code) => att.filter((a) => a.status === code).length;
  const A = count('A'), B = count('B'), C = count('C'), G = count('G'), H12 = count('12HRS');
  const WO = count('WO'), L = count('L'), OUT = count('OUTING');

  const workingDays = A + B + C + G + H12;
  const livingDays = workingDays + WO + L + OUT;

  let tempVacateDays = 0;
  let permVacateDays = 0;
  db.outingVacate
    .filter((o) => o.traineeId === traineeId && (o.type === 'TEMPORARY VACATE' || o.type === 'PERMANENT VACATE'))
    .forEach((o) => {
      // Permanent vacate has no return date: it runs to the end of the selected period.
      const days = overlapDays(o.fromDate, o.expectedReturn || to, from, to);
      if (o.type === 'TEMPORARY VACATE') tempVacateDays += days;
      else permVacateDays += days;
    });

  return {
    A, B, C, G, H12, WO, L, OUT,
    workingDays, livingDays,
    tempVacateDays, permVacateDays,
    vacatedDays: tempVacateDays + permVacateDays,
  };
}

/** Trainees currently holding a place in a given room. */
export const occupantsOf = (db, hostel, roomNo) =>
  db.trainees.filter(
    (t) => t.hostel === hostel && t.roomNo === roomNo && ROOM_HOLDING_STATUSES.includes(t.hostelStatus)
  );

/** One day's head-count per attendance code.
 *  marked = from individual QR / ID marks; manual = counts typed in the Daily Summary;
 *  final  = the typed count if there is one, otherwise the marked count. */
export function dayCounts(db, date) {
  const marked = Object.fromEntries(ATT_CODES.map((c) => [c, 0]));
  db.attendance.forEach((a) => { if (a.date === date && marked[a.status] !== undefined) marked[a.status]++; });
  const manual = ((db.dailySummary || {})[date] || {}).manual || {};
  const final = {};
  ATT_CODES.forEach((c) => { const m = manual[c]; final[c] = m !== undefined && m !== '' && m !== null ? Number(m) : marked[c]; });
  return { marked, manual, final, total: Object.values(final).reduce((a, b) => a + b, 0) };
}
