// Small date + id helpers. All dates are plain 'YYYY-MM-DD' strings (local time).

export const pad = (n, len = 2) => String(n).padStart(len, '0');

const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayStr = () => iso(new Date());

export const addDays = (s, n) => {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const daysDiff = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

export const fmtDate = (d) => {
  if (!d) return '—';
  if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.slice(0, 10).split('-');
    return `${day}/${m}/${y}`;
  }
  const dateObj = new Date(d);
  if (isNaN(dateObj.getTime())) return String(d);
  return `${pad(dateObj.getDate())}/${pad(dateObj.getMonth() + 1)}/${dateObj.getFullYear()}`;
};

/** Next id like HST-0031 / QR-00031 / LV-0009 based on the highest existing number. */
export const nextId = (prefix, existing, len = 4) => {
  const max = existing.reduce((m, v) => {
    const n = parseInt(String(v || '').split('-').pop(), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${pad(max + 1, len)}`;
};

export const currentTimeStr = () => {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const calculateDuration = (outDate, outTime, inDate, inTime) => {
  if (!outDate || !outTime || !inDate || !inTime) return '—';
  try {
    const start = new Date(`${outDate}T${outTime}`);
    const end = new Date(`${inDate}T${inTime}`);
    const diffMs = end - start;
    if (isNaN(diffMs) || diffMs < 0) return '0 mins';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    if (totalMinutes < 60) return `${totalMinutes} mins`;
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours < 24) {
      return mins > 0 ? `${hours} hr${hours > 1 ? 's' : ''} ${mins} min${mins > 1 ? 's' : ''}` : `${hours} hr${hours > 1 ? 's' : ''}`;
    }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days} day${days > 1 ? 's' : ''} ${remHours} hr${remHours > 1 ? 's' : ''}`;
  } catch (e) {
    return '—';
  }
};

/** Last 6 months as {label, from, to} for the Reports month picker. */
export const monthOptions = () => {
  const out = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const last = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
    out.push({
      label: first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }),
      from: iso(first),
      to: iso(last),
    });
  }
  return out;
};
