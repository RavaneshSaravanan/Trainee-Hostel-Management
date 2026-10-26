export const pad = (n, len = 2) => String(n).padStart(len, '0');

const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayStr = () => iso(new Date());

export const nextId = (prefix, existing, len = 4) => {
  const max = existing.reduce((m, v) => {
    const n = parseInt(String(v || '').split('-').pop(), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${pad(max + 1, len)}`;
};
