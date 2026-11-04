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

export const DEFAULT_ORG_BRANDING = {
  orgName: 'APOLLO TYRES LTD',
  tagline: 'Hostel Administration & Trainee Operations',
  logo: '',
  address: 'Apollo Tyres Ltd Plant Operations Campus',
};

export const DEFAULT_IDCARD_TEMPLATE = {
  companyName: 'APOLLO TYRES LTD',
  subtitle: 'TRAINEE IDENTITY CARD',
  headerBgStart: '#2E1065',
  headerBgEnd: '#4C1D95',
  accentColor: '#8B5CF6',
  textColor: '#1E1B4B',
  cardBorderColor: '#7C3AED',
  footerText: 'Authorized Trainee ID Card · Apollo Tyres Ltd',
  showQualification: true,
  showPhone: true,
  showHostel: true,
  showRoom: true,
  showJoiningDate: true,
  showQr: true,
  photoShape: 'circle',
};

export const DEFAULT_EMAIL_TEMPLATE = {
  subject: '[Action Required] Review Registration: {{traineeName}} ({{traineeId}})',
  heading: 'Trainee Registration Review Request',
  subheading: 'Apollo Tyres Ltd — Trainee Hostel Operations',
  headerBg: '#2E1065',
  accentColor: '#7C3AED',
  fontFamily: 'Arial, sans-serif',
  bodyText: 'Dear Approver,\n\nA new trainee registration has been submitted for {{organizationName}} Trainee Hostel and requires your official review.\n\nPlease inspect the details below and record your decision:',
  footerText: 'Security Notice: This link contains a secure, single-use token expiring in 7 days. Apollo Tyres Ltd Trainee Hostel Management.',
  signatureImage: '',
  logoImage: '',
};

export const DEFAULT_EMAIL_TEMPLATES = {
  registrationConfirmation: {
    subject: 'Registration Successful – Application Under Review | Apollo Tyres Ltd',
    heading: 'REGISTRATION RECEIVED',
    subheading: 'Apollo Tyres Ltd — Trainee Hostel Operations',
    bodyText: 'Dear {{traineeName}},\n\nYour trainee registration application for the Apollo Tyres Ltd Hostel has been successfully received and submitted for administrative approval.\n\nOur Hostel Warden and HR Administration are currently verifying your details and will assign your hostel block and room number shortly.\n\nOnce approved, you will receive an official Approval Confirmation email with your Digital ID Card attached as a printable PDF, along with your Welcome Packet containing room accommodation details.',
    footerText: 'Apollo Tyres Ltd · Hostel Administration & Trainee Operations',
    logoUrl: '',
    headerBg: '#2E1065',
    accentColor: '#7C3AED',
  },
  welcome: {
    subject: 'Welcome to Apollo Tyres – Thanks for Joining Us!',
    heading: 'Welcome to Apollo Tyres Ltd',
    subheading: 'Official Hostel Admission & Room Allocation Confirmation',
    bodyText: 'Dear {{traineeName}},\n\nCongratulations on joining Apollo Tyres Ltd!\nWe are delighted to welcome you to our organization and trainee residential community.\n\nYour hostel room allocation and onboarding details are confirmed below.\nPlease review the accommodation rules and keep your Digital ID Card handy for campus and hostel access.',
    footerText: 'Apollo Tyres Ltd · Hostel Administration & Trainee Operations · Dedicated to Excellence and Safety',
    logoUrl: '',
    headerBg: '#2E1065',
    accentColor: '#7C3AED',
  },
  idCard: {
    subject: 'Approval Confirmation & Official Trainee ID Card — Apollo Tyres Ltd ({{traineeName}})',
    heading: 'APOLLO TYRES LTD',
    subheading: 'OFFICIAL TRAINEE IDENTITY CARD & APPROVAL CONFIRMATION',
    bodyText: 'Dear {{traineeName}},\n\nCongratulations! Your trainee registration with Apollo Tyres Ltd has been officially approved.\nYour official digital Trainee Identity Card is issued and attached below as a printable PDF.\nYou can use your secure QR code badge for hostel entry and daily attendance verification.',
    footerText: 'Authorized Trainee ID Card · Apollo Tyres Ltd · Hostel Operations',
    logoUrl: '',
    headerBg: '#2E1065',
    accentColor: '#7C3AED',
  },
  idCardUpdated: {
    subject: 'Updated Trainee Identity Card & Room Details — Apollo Tyres Ltd ({{traineeName}})',
    heading: 'APOLLO TYRES LTD',
    subheading: 'UPDATED TRAINEE IDENTITY CARD',
    bodyText: 'Dear {{traineeName}},\n\nYour hostel accommodation and ID card details have been updated.\nPlease find your updated digital ID Card with your latest room allocation below.',
    footerText: 'Authorized Trainee ID Card · Apollo Tyres Ltd · Hostel Operations',
    logoUrl: '',
    headerBg: '#2E1065',
    accentColor: '#7C3AED',
  },
  approval: {
    subject: '[Action Required] Review Registration: {{traineeName}} ({{traineeId}})',
    heading: 'Trainee Registration Review Request',
    subheading: 'Apollo Tyres Ltd — Trainee Hostel Operations',
    bodyText: 'Dear Approver,\n\nA new trainee registration has been submitted for {{organizationName}} Trainee Hostel and requires your official review.\n\nPlease inspect the details below and record your decision:',
    footerText: 'Security Notice: This link contains a secure, single-use token expiring in 7 days. Apollo Tyres Ltd Trainee Hostel Management.',
    logoUrl: '',
    headerBg: '#2E1065',
    accentColor: '#7C3AED',
  },
  approvalApproved: {
    subject: 'Your Hostel Registration Has Been Approved — Apollo Tyres Ltd ({{traineeName}})',
    heading: 'REGISTRATION APPROVED',
    subheading: 'Official Trainee Registration Review Decision',
    bodyText: 'Dear {{traineeName}},\n\nYour hostel registration has been reviewed and approved successfully.\n\nA hostel room and ID card will be allocated shortly. Upon room allocation, your official Trainee Identity Card and Welcome Package will be sent to this email address.',
    footerText: 'Apollo Tyres Ltd · Trainee Hostel Management System · Automated Notification',
    logoUrl: '',
    headerBg: '#16A34A',
    accentColor: '#16A34A',
  },
  approvalRejected: {
    subject: 'Your Hostel Registration Has Been Rejected — Apollo Tyres Ltd ({{traineeName}})',
    heading: 'REGISTRATION REJECTED',
    subheading: 'Official Trainee Registration Review Decision',
    bodyText: 'Dear {{traineeName}},\n\nYour hostel registration has been reviewed and rejected.\n\nIf you believe this decision was made in error or if you have questions regarding the rejection reason, please contact the Hostel Administration office.',
    footerText: 'Apollo Tyres Ltd · Trainee Hostel Management System · Automated Notification',
    logoUrl: '',
    headerBg: '#DC2626',
    accentColor: '#DC2626',
  },
};

export const DEFAULT_EMAIL_RECIPIENTS = [];

export const DEFAULT_CONFIG = {
  appName: 'Trainee Hostel',
  appSub: 'Management System',
  logo: '',
  orgBranding: DEFAULT_ORG_BRANDING,
  idCardTemplate: DEFAULT_IDCARD_TEMPLATE,
  emailTemplate: DEFAULT_EMAIL_TEMPLATE,
  emailTemplates: DEFAULT_EMAIL_TEMPLATES,
  emailRecipients: DEFAULT_EMAIL_RECIPIENTS,
  adminNotificationEmail: '',
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
  orgBranding: { ...DEFAULT_ORG_BRANDING, ...(c.orgBranding || {}) },
  idCardTemplate: { ...DEFAULT_IDCARD_TEMPLATE, ...(c.idCardTemplate || {}) },
  emailTemplate: { ...DEFAULT_EMAIL_TEMPLATE, ...(c.emailTemplate || {}) },
  emailTemplates: {
    ...DEFAULT_EMAIL_TEMPLATES,
    ...(c.emailTemplates || {}),
  },
  emailRecipients: Array.isArray(c.emailRecipients) ? c.emailRecipients : DEFAULT_EMAIL_RECIPIENTS,
  adminNotificationEmail: c.adminNotificationEmail || '',
  theme: { ...DEFAULT_CONFIG.theme, ...(c.theme || {}) },
  widgets: { ...DEFAULT_CONFIG.widgets, ...(c.widgets || {}) },
  pages: c.pages || {},
  customFields: c.customFields || [],
});
