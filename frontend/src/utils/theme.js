// Turns config.theme into CSS variables + body background. Nothing here needs editing for a new look:
// the Super Admin changes it in Admin Console -> Appearance.
const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (a) => '#' + a.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export const mix = (c, w, p) => { const a = hex(c), b = hex(w); return toHex(a.map((v, i) => v + (b[i] - v) * p)); };

export function applyTheme(t) {
  const r = document.documentElement.style;
  r.setProperty('--purple-600', t.primary);
  r.setProperty('--purple-700', mix(t.primary, '#000000', 0.2));
  r.setProperty('--purple-500', mix(t.primary, '#ffffff', 0.18));
  r.setProperty('--purple-100', mix(t.primary, '#ffffff', 0.86));
  r.setProperty('--purple-50', mix(t.primary, '#ffffff', 0.95));
  r.setProperty('--purple-900', t.sidebar);
  r.setProperty('--radius-md', `${t.radius}px`);
  r.setProperty('--radius-sm', `${Math.round(t.radius * 0.66)}px`);
  r.setProperty('--radius-lg', `${Math.round(t.radius * 1.5)}px`);
  const f = t.font === 'system-ui' ? 'system-ui, sans-serif' : `'${t.font}', sans-serif`;
  r.setProperty('--font-body', f);
  r.setProperty('--font-head', t.font === 'Inter' ? "'Manrope', sans-serif" : f);
  if (t.font !== 'system-ui' && !document.getElementById('theme-font-' + t.font)) {
    const l = document.createElement('link');
    l.id = 'theme-font-' + t.font; l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${t.font.replace(' ', '+')}:wght@400;500;600;700;800&display=swap`;
    document.head.appendChild(l);
  }
  const b = document.body.style;
  b.backgroundAttachment = 'fixed';
  if (t.bgMode === 'image' && t.bgImage) { b.background = `url(${t.bgImage}) center/cover fixed`; }
  else if (t.bgMode === 'gradient') { b.background = `linear-gradient(${t.bgAngle}deg, ${t.bgColor}, ${t.bgColor2}) fixed`; }
  else b.background = t.bgColor;
}
