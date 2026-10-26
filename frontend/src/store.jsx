// CENTRAL STORE
// All data lives in `db` (React state) and is synced to the backend (server/index.js):
//   - every change is saved automatically (debounced), and other devices are polled every few seconds
//   - config  = app name, theme, page labels, custom fields (Super Admin edits it in Admin Console)
//   - roles   = which pages each role can open
//   - users   = login members (Super Admin only)

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { nextId, todayStr, daysDiff } from './utils/dates.js';
import { api, getToken, setToken } from './utils/api.js';
import { applyTheme } from './utils/theme.js';
import { DEFAULT_CONFIG, DEFAULT_ROLES, SUPER_ROLE, withDefaults } from './data/defaults.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

const EMPTY_DB = { hostels: [], trainees: [], attendance: [], leaves: [], outingVacate: [], resignations: [], remarks: [], roomHistory: [], dailySummary: {} };

export function StoreProvider({ children }) {
  const [db, setDbRaw] = useState(EMPTY_DB);
  const [config, setConfigRaw] = useState(DEFAULT_CONFIG);
  const [roles, setRolesRaw] = useState(DEFAULT_ROLES);
  const [users, setUsers] = useState([]);
  const [session, setSession] = useState(null); // { id, name, username, roleId }
  const [booting, setBooting] = useState(true);
  const [route, setRoute] = useState({ view: 'dashboard', params: {} });
  const [toast, setToast] = useState('');
  const [syncError, setSyncError] = useState('');
  const timer = useRef(null);
  const dirty = useRef(false);
  const saving = useRef(false);
  const rev = useRef(0);
  const latest = useRef({});
  latest.current = { db, config, roles, session };

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(''), 2800);
  }, []);

  // Wrappers: any change made by the user marks the data "dirty" so it gets saved.
  const setDb = (f) => { dirty.current = true; setDbRaw(f); };
  const setConfig = (f) => { dirty.current = true; setConfigRaw(f); };
  const setRoles = (f) => { dirty.current = true; setRolesRaw(f); };

  const applyServer = (s) => {
    rev.current = s.rev;
    setDbRaw({ ...EMPTY_DB, ...s.db });
    setConfigRaw(withDefaults(s.config));
    setRolesRaw(s.roles);
    setUsers(s.users || []);
  };

  const dropSession = useCallback(() => { setToken(''); setSession(null); setRoute({ view: 'dashboard', params: {} }); }, []);

  // ---------- boot: restore login, or load public look (for the login screen) ----------
  useEffect(() => {
    (async () => {
      try {
        if (getToken()) {
          const s = await api('/api/state');
          const me = JSON.parse(localStorage.getItem('hostel_me') || 'null');
          if (me) { applyServer(s); setSession(me); }
        }
      } catch (e) { if (e.status === 401) setToken(''); }
      try {
        const p = await api('/api/public', { auth: false });
        if (!getToken()) setConfigRaw((c) => withDefaults({ ...c, ...p }));
      } catch { /* server offline: login screen shows the error on submit */ }
      setBooting(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { applyTheme(config.theme); }, [config.theme]);
  useEffect(() => { document.title = config.appName + ' ' + config.appSub; }, [config.appName, config.appSub]);

  // ---------- auto-save ----------
  const flush = useCallback(async () => {
    if (saving.current) { setTimeout(flush, 400); return; }
    const { db: d, config: c, roles: r, session: s } = latest.current;
    if (!s) return;
    saving.current = true; dirty.current = false;
    try {
      const body = { db: d };
      if (s.roleId === SUPER_ROLE) { body.config = c; body.roles = r; }
      const res = await api('/api/state', { method: 'PUT', body });
      rev.current = res.rev;
      setSyncError('');
      if (!dirty.current) { setDbRaw({ ...EMPTY_DB, ...res.db }); } // pick up rows other devices added
    } catch (e) {
      if (e.status === 401) dropSession();
      else { dirty.current = true; setSyncError(e.message); setTimeout(flush, 4000); }
    } finally { saving.current = false; }
  }, [dropSession]);

  useEffect(() => {
    if (!dirty.current || !session) return undefined;
    const h = setTimeout(flush, 350);
    return () => clearTimeout(h);
  }, [db, config, roles, session, flush]);

  // ---------- poll other devices ----------
  useEffect(() => {
    if (!session) return undefined;
    const id = setInterval(async () => {
      if (dirty.current || saving.current) return;
      try {
        const { rev: r } = await api('/api/rev');
        if (r !== rev.current && !dirty.current && !saving.current) applyServer(await api('/api/state'));
        setSyncError('');
      } catch (e) { if (e.status === 401) dropSession(); }
    }, 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ---------- auth + permissions ----------
  const role = session ? roles.find((r) => r.id === session.roleId) : null;
  const isSuper = !!session && session.roleId === SUPER_ROLE;
  const roleName = role ? role.name : '';
  const pageOf = (view) => (view === 'trainee-profile' ? 'trainees' : view);
  const can = (view) => {
    if (!session) return false;
    const p = pageOf(view);
    if (p === 'console') return isSuper;
    return isSuper || !!(role && role.pages.includes(p));
  };

  const login = async (username, password) => {
    const { token, user } = await api('/api/login', { method: 'POST', body: { username, password }, auth: false });
    setToken(token);
    const s = await api('/api/state');
    applyServer(s);
    const me = { id: user.id, name: user.name, username: user.username, roleId: user.roleId };
    localStorage.setItem('hostel_me', JSON.stringify(me));
    setSession(me);
    setRoute({ view: 'dashboard', params: {} });
  };
  const logout = () => { localStorage.removeItem('hostel_me'); dropSession(); };

  const navigate = useCallback((view, params = {}) => {
    setRoute({ view, params });
    window.scrollTo(0, 0);
  }, []);

  const getTrainee = (id) => db.trainees.find((t) => t.traineeId === id);
  const actor = () => (session ? `${session.name} (${roleName})` : 'System');

  // ---------- Trainees ----------
  // Every trainee gets a QR id the moment they are created (no waiting for approval).
  const addTrainee = (data) => {
    if (getTrainee(data.traineeId)) return { ok: false, error: 'This Trainee ID already exists.' };
    const hostelId = nextId('HST', db.trainees.map((t) => t.hostelId), 4);
    const qrId = nextId('QR', db.trainees.map((t) => t.qrId), 5);
    setDb((p) => ({
      ...p,
      trainees: [
        {
          ...data, hostelId, qrId, qrStatus: 'ACTIVE', employmentStatus: 'ACTIVE', hostelStatus: 'PENDING REVIEW',
          hostel: '', roomNo: '', remarks: '', submissionDate: todayStr(), approvedBy: '',
        },
        ...p.trainees,
      ],
    }));
    return { ok: true, hostelId, qrId };
  };

  const updateTrainee = (traineeId, patch) =>
    setDb((p) => ({ ...p, trainees: p.trainees.map((t) => (t.traineeId === traineeId ? { ...t, ...patch } : t)) }));

  // Approve a pending trainee: allocate room and activate (QR already exists).
  const approveTrainee = (traineeId, hostel, room) =>
    setDb((p) => {
      const qrId = nextId('QR', p.trainees.map((t) => t.qrId), 5);
      return {
        ...p,
        trainees: p.trainees.map((t) =>
          t.traineeId === traineeId
            ? { ...t, hostel, roomNo: room, hostelStatus: 'ACTIVE', qrStatus: 'ACTIVE', qrId: t.qrId || qrId, approvedBy: actor() }
            : t
        ),
        roomHistory: [
          ...p.roomHistory,
          { traineeId, prevHostel: '', prevRoom: '', newHostel: hostel, newRoom: room, changeDate: todayStr(), changedBy: actor() },
        ],
      };
    });

  const rejectTrainee = (traineeId) =>
    updateTrainee(traineeId, { hostelStatus: 'INACTIVE', qrStatus: 'INACTIVE', remarks: 'Registration rejected' });

  const changeRoom = (traineeId, newHostel, newRoom) =>
    setDb((p) => {
      const t = p.trainees.find((x) => x.traineeId === traineeId);
      return {
        ...p,
        trainees: p.trainees.map((x) => (x.traineeId === traineeId ? { ...x, hostel: newHostel, roomNo: newRoom } : x)),
        roomHistory: [
          ...p.roomHistory,
          { traineeId, prevHostel: t.hostel, prevRoom: t.roomNo, newHostel, newRoom, changeDate: todayStr(), changedBy: actor() },
        ],
      };
    });

  // ---------- Attendance (one record per trainee per date) ----------
  const saveAttendance = (traineeId, date, status) =>
    setDb((p) => {
      const exists = p.attendance.some((a) => a.traineeId === traineeId && a.date === date);
      return {
        ...p,
        attendance: exists
          ? p.attendance.map((a) => (a.traineeId === traineeId && a.date === date ? { ...a, status, markedBy: session.name } : a))
          : [...p.attendance, { traineeId, date, status, markedBy: session.name }],
      };
    });

  // Daily summary: db.dailySummary[date] = { started, startedBy, startedAt, manual: { A: 12, B: 8, ... } }
  const patchDay = (date, patch) =>
    setDb((p) => ({ ...p, dailySummary: { ...p.dailySummary, [date]: { ...(p.dailySummary[date] || {}), ...patch } } }));
  const startDay = (date) => patchDay(date, { started: true, startedBy: session.name, startedAt: new Date().toISOString() });
  const saveDaySummary = (date, manual) => patchDay(date, { manual, savedBy: session.name });

  // ---------- Generic upsert for Leave / OUTING_VACATE / Resignation / Remarks ----------
  const upsert = (key, prefix, data, id) =>
    setDb((p) => ({
      ...p,
      [key]: id
        ? p[key].map((r) => (r.id === id ? { ...r, ...data } : r))
        : [{ ...data, id: nextId(prefix, p[key].map((r) => r.id), 4) }, ...p[key]],
    }));

  const saveLeave = (data, id) => {
    const days = daysDiff(data.fromDate, data.toDate) + 1;
    upsert('leaves', 'LV', { ...data, days, leaveDate: data.leaveDate || todayStr() }, id);
    const t = getTrainee(data.traineeId);
    if (data.status === 'APPROVED' && t && t.hostelStatus === 'ACTIVE' && data.fromDate <= todayStr() && data.toDate >= todayStr()) {
      updateTrainee(t.traineeId, { hostelStatus: 'ON LEAVE' });
    }
  };

  const saveOutingVacate = (data, id) => {
    upsert('outingVacate', 'OV', { ...data, date: data.date || todayStr() }, id);
    if (data.status === 'APPROVED') {
      const patch = { hostelStatus: data.type };
      if (data.type === 'PERMANENT VACATE') patch.qrStatus = 'INACTIVE';
      updateTrainee(data.traineeId, patch);
    }
  };

  const saveResignation = (data, id) => {
    upsert('resignations', 'RS', data, id);
    if (data.status === 'APPROVED') {
      updateTrainee(data.traineeId, { employmentStatus: 'RESIGNED', hostelStatus: 'RESIGNED', qrStatus: 'INACTIVE' });
    }
  };
  const saveRemark = (data, id) => upsert('remarks', 'RM', data, id);

  // ---------- Hostels / rooms (Super Admin, Admin Console) ----------
  const addHostel = (name) => setDb((p) => ({ ...p, hostels: [...p.hostels, { id: nextId('H', p.hostels.map((h) => h.id), 1), name, rooms: [] }] }));
  const addRoom = (hostelId, no, capacity) =>
    setDb((p) => ({ ...p, hostels: p.hostels.map((h) => (h.id === hostelId ? { ...h, rooms: [...h.rooms, { no, capacity: Number(capacity) || 1 }] } : h)) }));
  const setRoomCapacity = (hostelId, no, capacity) =>
    setDb((p) => ({ ...p, hostels: p.hostels.map((h) => (h.id === hostelId ? { ...h, rooms: h.rooms.map((r) => (r.no === no ? { ...r, capacity: Number(capacity) || 1 } : r)) } : h)) }));

  // ---------- Super Admin: login members ----------
  const saveUser = async (user, password) => { const r = await api('/api/users', { method: 'POST', body: { action: 'save', user, password } }); setUsers(r.users); };
  const deleteUser = async (user) => { const r = await api('/api/users', { method: 'POST', body: { action: 'delete', user } }); setUsers(r.users); };
  const changePassword = (oldPassword, newPassword) => api('/api/me/password', { method: 'POST', body: { oldPassword, newPassword } });

  const value = {
    db, config, roles, users, session, route, toast, booting, syncError, isSuper, roleName, can,
    setConfig, setRoles,
    login, logout, navigate, notify,
    getTrainee, actor,
    addTrainee, updateTrainee, approveTrainee, rejectTrainee, changeRoom,
    saveAttendance, startDay, saveDaySummary, saveLeave, saveOutingVacate, saveResignation, saveRemark,
    addHostel, addRoom, setRoomCapacity, saveUser, deleteUser, changePassword,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
