export const ATT_CODES = ['A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING'];
export const ROOM_HOLDING_STATUSES = ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'];

export const daysDiff = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

export const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const fmtDate = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const overlapDays = (recFrom, recTo, from, to) => {
  const start = recFrom > from ? recFrom : from;
  const end = recTo && recTo < to ? recTo : to;
  const d = daysDiff(start, end) + 1;
  return d > 0 ? d : 0;
};

export function computeSummary(db, traineeId, from, to) {
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

  return {
    A, B, C, G, H12, WO, L, OUT,
    workingDays, livingDays,
    tempVacateDays, permVacateDays,
    vacatedDays: tempVacateDays + permVacateDays,
  };
}

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
