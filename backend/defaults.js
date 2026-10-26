// backend/defaults.js
// Synchronized with frontend defaults

export const PAGES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'trainees', label: 'Trainees', icon: 'users' },
  { id: 'trainee-new', label: 'New Trainee', icon: 'userPlus' },
  { id: 'attendance', label: 'Attendance', icon: 'checkSquare' },
  { id: 'leave', label: 'Leave', icon: 'calendarX' },
  { id: 'outing-vacate', label: 'Outing / Vacate', icon: 'arrowBox' },
  { id: 'resignation', label: 'Resignation', icon: 'doorExit' },
  { id: 'remarks', label: 'Remarks / Complaints', icon: 'message' },
  { id: 'reports', label: 'Reports', icon: 'bar' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
export const CONSOLE_PAGE = { id: 'console', label: 'Admin Console', icon: 'sliders' };
export const ASSIGNABLE_PAGES = PAGES.map((p) => p.id);

export const SUPER_ROLE = 'superadmin';

export const DEFAULT_ROLES = [
  { id: 'superadmin', name: 'Super Admin', system: true, pages: ASSIGNABLE_PAGES },
  // Warden: everything except Reports
  { id: 'warden', name: 'Warden', system: true, pages: ASSIGNABLE_PAGES.filter((p) => p !== 'reports') },
];

export const THEME_PRESETS = {
  Purple: { primary: '#7C3AED', sidebar: '#3B0F63' },
  Blue: { primary: '#2563EB', sidebar: '#12295E' },
  Teal: { primary: '#0D9488', sidebar: '#0B3B38' },
  Green: { primary: '#16A34A', sidebar: '#0F3D22' },
  Rose: { primary: '#E11D48', sidebar: '#4C0A1E' },
  Orange: { primary: '#EA580C', sidebar: '#4A1D07' },
  Slate: { primary: '#334155', sidebar: '#0F172A' },
};

export const FONTS = ['Inter', 'Poppins', 'Nunito', 'Roboto', 'Manrope', 'system-ui'];

export const DEFAULT_CONFIG = {
  appName: 'Trainee Hostel',
  appSub: 'Management System',
  logo: '',
  theme: {
    primary: '#7C3AED', sidebar: '#3B0F63',
    bgMode: 'color', // color | gradient | image
    bgColor: '#FBFAFD', bgColor2: '#EDE9FE', bgAngle: 135, bgImage: '',
    font: 'Inter', radius: 12,
  },
  pages: {}, // pageId -> { label, visible, order }
  widgets: {
    filters: true, kpis: true, attendanceToday: true, occupancy: true, shifts: true,
    registrations: true, resignations: true, complaints: true, outing: true,
  },
  customFields: [], // { id, label, type: text|number|date|select, options: 'a,b', required }
  registrationOpen: true,
};

export const WIDGET_LABELS = {
  filters: 'Filter bar', kpis: 'KPI cards', attendanceToday: "Today's attendance summary", occupancy: 'Hostel occupancy',
  shifts: 'Shift distribution', registrations: 'Recent registrations', resignations: 'Recent resignations',
  complaints: 'Recent complaints', outing: 'Recent outing / vacate',
};

/** Merge saved config over defaults so newly added options always exist. */
export const withDefaults = (c = {}) => ({
  ...DEFAULT_CONFIG, ...c,
  theme: { ...DEFAULT_CONFIG.theme, ...(c.theme || {}) },
  widgets: { ...DEFAULT_CONFIG.widgets, ...(c.widgets || {}) },
  pages: c.pages || {},
  customFields: c.customFields || [],
});
