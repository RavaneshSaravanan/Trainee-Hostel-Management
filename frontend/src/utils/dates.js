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

export const fmtDate = (d) =>
  d
    ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

/** Next id like HST-0031 / QR-00031 / LV-0009 based on the highest existing number. */
export const nextId = (prefix, existing, len = 4) => {
  const max = existing.reduce((m, v) => {
    const n = parseInt(String(v || '').split('-').pop(), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${pad(max + 1, len)}`;
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
