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
 * Clamps to the last day of the target month when needed (e.g. Jan 31 -> Apr 30, Oct 31 -> Jan 31).
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
 * - 'EXPIRING_SOON' : Within 15 days of free stay expiry (still active free stay)
 * - 'EXPIRED_DUE'   : Free 3 months expired and payment not yet confirmed
 * - 'PAID'          : Confirmed payment recorded
 * - 'PENDING_DETAILS': Missing or invalid joining date
 */
export function computeValidity(joiningDate, paymentStatus = 'FREE', currentDate = todayStr(), paymentHistory = []) {
  const cleanDate = typeof joiningDate === 'string' ? joiningDate.trim().slice(0, 10) : '';
  if (!cleanDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return {
      expiryDate: '',
      status: 'PENDING_DETAILS',
      daysRemaining: null,
      isExpired: false,
      isFree: false,
      isPaid: false,
      isPending: true,
      label: 'Details Pending',
    };
  }

  const expiryDate = addThreeCalendarMonths(cleanDate);
  const hasPaid = paymentStatus === 'PAID' || (Array.isArray(paymentHistory) && paymentHistory.length > 0);
  if (hasPaid) {
    return {
      expiryDate,
      status: 'PAID',
      daysRemaining: null,
      isExpired: false,
      isFree: false,
      isPaid: true,
      isPending: false,
      label: 'Paid Trainee',
    };
  }

  const remaining = daysBetween(currentDate, expiryDate);

  if (remaining < 0) {
    return {
      expiryDate,
      status: 'EXPIRED_DUE',
      daysRemaining: remaining,
      isExpired: true,
      isFree: false,
      isPaid: false,
      isPending: false,
      label: 'Expired Free Stay (Payment Due)',
    };
  }

  if (remaining <= 15) {
    return {
      expiryDate,
      status: 'EXPIRING_SOON',
      daysRemaining: remaining,
      isExpired: false,
      isFree: true,
      isPaid: false,
      isExpiringSoon: true,
      isPending: false,
      label: 'Free Stay (Expiring Soon)',
    };
  }

  return {
    expiryDate,
    status: 'FREE',
    daysRemaining: remaining,
    isExpired: false,
    isFree: true,
    isPaid: false,
    isExpiringSoon: false,
    isPending: false,
    label: 'Free Trainee',
  };
}

/**
 * Centralized Trainee Stay Classifier reusing computeValidity.
 * Single source of truth for Dashboard, Reports, Validity Monitoring, Exports.
 */
export function classifyTrainee(trainee, currentDate = todayStr()) {
  if (!trainee || typeof trainee !== 'object') {
    return {
      category: 'UNKNOWN',
      validityStatus: 'UNKNOWN',
      expiryDate: '',
      daysRemaining: null,
      isFree: false,
      isPaid: false,
      isExpired: false,
      isPending: true,
      label: 'Unknown',
    };
  }

  const val = computeValidity(
    trainee.joiningDate,
    trainee.paymentStatus,
    currentDate,
    trainee.paymentHistory
  );

  let category = val.status;
  if (val.status === 'EXPIRING_SOON') {
    category = 'FREE'; // Active Free Stay (within 3 calendar months)
  }

  return {
    ...val,
    category, // 'FREE' | 'PAID' | 'EXPIRED_DUE' | 'PENDING_DETAILS'
  };
}
