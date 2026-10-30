/**
 * Centralized Hostel Free-Stay Validity Calculator
 * 
 * Business Rule:
 * Each eligible trainee receives three calendar months of free accommodation from their joining date.
 * Handles month-end rollovers and leap years correctly.
 */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Adds exactly 3 calendar months to a 'YYYY-MM-DD' date string.
 * Clamps to the last day of the target month when needed (e.g. Jan 31 -> Apr 30).
 */
export function addThreeCalendarMonths(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '';
  
  const [year, month, day] = parts;
  const targetMonthIndex = (month - 1) + 3; // 0-based month index + 3
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12; // 0 to 11
  
  // Last day of target month (passing 0 as day gets last day of previous month)
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(day, daysInTargetMonth);
  
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(targetDay)}`;
}

/**
 * Difference in days between two 'YYYY-MM-DD' dates (d2 - d1)
 */
export function daysBetween(d1, d2) {
  if (!d1 || !d2) return 0;
  const t1 = new Date(`${d1}T00:00:00Z`).getTime();
  const t2 = new Date(`${d2}T00:00:00Z`).getTime();
  return Math.round((t2 - t1) / 86400000);
}

/**
 * Computes Free-Stay validity status based on joining date and payment record.
 * Statuses:
 * - 'FREE'          : Within the 3 calendar months free period (> 15 days remaining)
 * - 'EXPIRING_SOON' : Within 15 days of free stay expiry
 * - 'EXPIRED_DUE'   : Free 3 months expired and payment not yet confirmed
 * - 'PAID'          : Confirmed payment recorded
 */
export function computeValidity(joiningDate, paymentStatus = 'FREE', currentDate = todayStr()) {
  if (!joiningDate) {
    return {
      expiryDate: '',
      status: 'FREE',
      daysRemaining: 0,
      isExpired: false,
    };
  }

  const expiryDate = addThreeCalendarMonths(joiningDate);
  if (paymentStatus === 'PAID') {
    return {
      expiryDate,
      status: 'PAID',
      daysRemaining: 0,
      isExpired: false,
    };
  }

  const remaining = daysBetween(currentDate, expiryDate);

  if (remaining < 0) {
    return {
      expiryDate,
      status: 'EXPIRED_DUE',
      daysRemaining: remaining,
      isExpired: true,
    };
  }

  if (remaining <= 15) {
    return {
      expiryDate,
      status: 'EXPIRING_SOON',
      daysRemaining: remaining,
      isExpired: false,
    };
  }

  return {
    expiryDate,
    status: 'FREE',
    daysRemaining: remaining,
    isExpired: false,
  };
}
