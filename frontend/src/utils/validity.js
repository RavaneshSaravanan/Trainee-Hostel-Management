/**
 * Frontend Centralized Hostel Free-Stay Validity Calculator
 * 
 * Matches backend calculation rule exactly:
 * Each eligible trainee receives 3 calendar months of free accommodation from their joining date.
 */

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function addThreeCalendarMonths(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.trim().split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return '';
  
  const [year, month, day] = parts;
  const targetMonthIndex = (month - 1) + 3;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  
  const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const targetDay = Math.min(day, daysInTargetMonth);
  
  return `${targetYear}-${pad2(targetMonth + 1)}-${pad2(targetDay)}`;
}

export function daysBetween(d1, d2) {
  if (!d1 || !d2) return 0;
  const t1 = new Date(`${d1}T00:00:00Z`).getTime();
  const t2 = new Date(`${d2}T00:00:00Z`).getTime();
  return Math.round((t2 - t1) / 86400000);
}

/**
 * Computes Trainee Stay Category based strictly on registration/payment status.
 * Business Rule:
 * - Only two categories exist: 'FREE' (Free Trainees) and 'PAID' (Paid Trainees).
 * - Trainees who are not part of the paid category remain classified as Free Trainees
 *   and are never classified as expired, payment due, or unpaid paid trainees.
 */
export function computeValidity(joiningDate, paymentStatus = 'FREE', currentDate = todayStr(), paymentHistory = []) {
  const cleanDate = typeof joiningDate === 'string' ? joiningDate.trim().slice(0, 10) : '';
  const expiryDate = cleanDate && /^\d{4}-\d{2}-\d{2}$/.test(cleanDate) ? addThreeCalendarMonths(cleanDate) : '';
  const hasPaid = paymentStatus === 'PAID' || (Array.isArray(paymentHistory) && paymentHistory.length > 0);

  if (hasPaid) {
    return {
      expiryDate,
      status: 'PAID',
      daysRemaining: null,
      isExpired: false,
      isFree: false,
      isPaid: true,
      isExpiringSoon: false,
      isPending: false,
      label: 'Paid Trainee',
    };
  }

  return {
    expiryDate,
    status: 'FREE',
    daysRemaining: null,
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
 * Single source of truth for Dashboard, Reports, and Exports.
 */
export function classifyTrainee(trainee, currentDate = todayStr()) {
  if (!trainee || typeof trainee !== 'object') {
    return {
      category: 'FREE',
      status: 'FREE',
      validityStatus: 'FREE',
      expiryDate: '',
      daysRemaining: null,
      isFree: true,
      isPaid: false,
      isExpired: false,
      isExpiringSoon: false,
      isPending: false,
      label: 'Free Trainee',
    };
  }

  const val = computeValidity(
    trainee.joiningDate,
    trainee.paymentStatus,
    currentDate,
    trainee.paymentHistory
  );

  return {
    ...val,
    category: val.status, // 'FREE' | 'PAID'
    validityStatus: val.status,
  };
}
