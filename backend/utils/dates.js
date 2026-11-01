export const pad = (n, len = 2) => String(n).padStart(len, '0');

const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayStr = () => iso(new Date());

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

export const nextId = (prefix, existing, len = 4) => {
  const max = existing.reduce((m, v) => {
    const n = parseInt(String(v || '').split('-').pop(), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${pad(max + 1, len)}`;
};
