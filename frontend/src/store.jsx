// CENTRAL STORE
// All data lives in `db` (React state) and is synced to the backend (server/index.js):
//   - every change is saved automatically (debounced), and other devices are polled every few seconds
//   - config  = app name, theme, page labels, custom fields (Super Admin edits it in Admin Console)
//   - roles   = which pages each role can open
//   - users   = login members (Super Admin only)

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { nextId, todayStr, daysDiff } from './utils/dates.js';
import { addThreeCalendarMonths } from './utils/validity.js';
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
      if (e.status === 401) {
        dropSession();
      } else if (e.status === 400 || e.status === 403 || e.status === 404) {
        setSyncError(e.message);
      } else {
        dirty.current = true;
        setSyncError(e.message);
        setTimeout(flush, 5000);
      }
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
  const pageOf = (view) => (view === 'trainee-profile' || view === 'review' ? 'trainees' : view);
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

  const getTrainee = (id) =>
    db.trainees.find(
      (t) =>
        (t.traineeId && t.traineeId === id) ||
        (t.qrId && t.qrId === id) ||
        (t.hostelId && t.hostelId === id) ||
        (t._id && t._id === id)
    );
  const actor = () => (session ? `${session.name} (${roleName})` : 'System');

  // ---------- Trainees ----------
  // Every trainee gets a QR id the moment they are created (no waiting for approval).
  const addTrainee = (data) => {
    const cleanId = String(data.traineeId || '').trim().toUpperCase();

    // Trainee ID is optional; if provided, prevent duplicate
    if (cleanId && db.trainees.some((t) => (t.traineeId || '').trim().toUpperCase() === cleanId)) {
      return { ok: false, error: `Trainee ID "${cleanId}" already exists. Duplicate ID is not allowed.` };
    }

    // Check duplicate Aadhar card number
    const cleanAadhar = String(data.aadhar || '').replace(/\D/g, '');
    if (cleanAadhar.length > 0) {
      const dup = db.trainees.find((t) => {
        const other = String(t.aadhar || '').replace(/\D/g, '');
        return other.length > 0 && other === cleanAadhar;
      });
      if (dup) {
        return {
          ok: false,
          error: `Aadhar card number "${data.aadhar}" is already registered for trainee ${dup.name} (${dup.traineeId || dup.qrId}). Duplicate Aadhar is not allowed.`,
        };
      }
    }

    const hostelId = nextId('HST', db.trainees.map((t) => t.hostelId), 4);
    const qrId = nextId('QR', db.trainees.map((t) => t.qrId), 5);
    const joiningDate = data.joiningDate || todayStr();
    const freeStayExpiryDate = addThreeCalendarMonths(joiningDate);

    setDb((p) => ({
      ...p,
      trainees: [
        {
          ...data,
          traineeId: cleanId,
          hostelId,
          qrId,
          qrStatus: 'ACTIVE',
          employmentStatus: 'ACTIVE',
          hostelStatus: 'PENDING REVIEW',
          approvalStatus: 'PENDING_APPROVAL',
          paymentStatus: 'FREE',
          freeStayExpiryDate,
          paymentHistory: [],
          approvals: [],
          hostel: '',
          roomNo: '',
          remarks: '',
          submissionDate: todayStr(),
          approvedBy: '',
        },
        ...p.trainees,
      ],
    }));
    return { ok: true, hostelId, qrId };
  };

  const updateTrainee = (traineeId, patch) => {
    const match = (t) => (t.traineeId && t.traineeId === traineeId) || (t.qrId && t.qrId === traineeId);
    if (patch.aadhar !== undefined) {
      const cleanAadhar = String(patch.aadhar || '').replace(/\D/g, '');
      if (cleanAadhar.length > 0) {
        const dup = db.trainees.find((t) => {
          if (match(t)) return false;
          const other = String(t.aadhar || '').replace(/\D/g, '');
          return other.length > 0 && other === cleanAadhar;
        });
        if (dup) {
          notify(`Aadhar number is already registered for ${dup.name} (${dup.traineeId || dup.qrId}). Duplicate Aadhar is not allowed.`);
          return false;
        }
      }
    }

    const currentTrainee = db.trainees.find(match);
    let extraPatch = {};
    let auditLog = null;

    if (patch.joiningDate && currentTrainee && patch.joiningDate !== currentTrainee.joiningDate) {
      const newExpiry = addThreeCalendarMonths(patch.joiningDate);
      extraPatch = { freeStayExpiryDate: newExpiry };
      auditLog = {
        id: `aud_${Date.now().toString(36)}`,
        traineeId: currentTrainee.traineeId || currentTrainee.qrId,
        type: 'JOINING_DATE_CHANGE',
        date: todayStr(),
        note: `Joining date updated from ${currentTrainee.joiningDate || 'none'} to ${patch.joiningDate} by ${actor()}`,
        by: actor(),
      };
    }

    setDb((p) => ({
      ...p,
      trainees: p.trainees.map((t) => (match(t) ? { ...t, ...patch, ...extraPatch } : t)),
      remarks: auditLog ? [auditLog, ...p.remarks] : p.remarks,
    }));
    return true;
  };

  // Allocate room and activate an approved trainee (QR already exists).
  const approveTrainee = (traineeId, hostel, room) => {
    const target = db.trainees.find((t) => t.traineeId === traineeId);
    if (target && target.approvalStatus === 'REJECTED') {
      notify('Room allocation denied: Trainee registration is rejected.');
      return false;
    }
    if (target && (target.approvalStatus === 'PENDING_APPROVAL' || target.hostelStatus === 'PENDING REVIEW')) {
      notify('Room allocation denied: Trainee must be approved first.');
      return false;
    }

    // Immediately persist room allocation to backend and trigger official ID Card email delivery
    api('/api/approval/allocate-room', {
      method: 'POST',
      body: { traineeId, hostel, roomNo: room },
    }).catch((err) => console.warn('allocate-room backend sync notice:', err.message));

    setDb((p) => {
      const qrId = nextId('QR', p.trainees.map((t) => t.qrId), 5);
      return {
        ...p,
        trainees: p.trainees.map((t) =>
          t.traineeId === traineeId
            ? { ...t, hostel, roomNo: room, hostelStatus: 'ACTIVE', approvalStatus: 'APPROVED', qrStatus: 'ACTIVE', qrId: t.qrId || qrId, approvedBy: t.approvedBy || actor() }
            : t
        ),
        roomHistory: [
          ...p.roomHistory,
          { traineeId, prevHostel: '', prevRoom: '', newHostel: hostel, newRoom: room, changeDate: todayStr(), changedBy: actor() },
        ],
      };
    });
    return true;
  };

  const rejectTrainee = (traineeId) =>
    updateTrainee(traineeId, { hostelStatus: 'INACTIVE', qrStatus: 'INACTIVE', remarks: 'Registration rejected' });

  const deleteTrainee = async (traineeId) => {
    const cleanId = String(traineeId || '').trim().toUpperCase();
    try {
      const res = await api(`/api/trainees/${encodeURIComponent(cleanId)}`, { method: 'DELETE' });
      setDb((p) => ({
        ...p,
        trainees: p.trainees.filter((t) => t.traineeId !== cleanId),
        attendance: p.attendance.filter((a) => a.traineeId !== cleanId),
        leaves: p.leaves.filter((l) => l.traineeId !== cleanId),
        outingVacate: p.outingVacate.filter((o) => o.traineeId !== cleanId),
        resignations: p.resignations.filter((r) => r.traineeId !== cleanId),
      }));
      notify(res.message || `Trainee ${cleanId} permanently deleted.`);
      return true;
    } catch (err) {
      notify(`Deletion failed: ${err.message}`);
      return false;
    }
  };

  const changeRoom = (traineeId, newHostel, newRoom) => {
    // Immediately persist room change to backend and trigger updated ID Card email delivery
    api('/api/approval/allocate-room', {
      method: 'POST',
      body: { traineeId, hostel: newHostel, roomNo: newRoom },
    }).catch((err) => console.warn('allocate-room changeRoom backend sync notice:', err.message));

    return setDb((p) => {
      const t = p.trainees.find((x) => x.traineeId === traineeId);
      return {
        ...p,
        trainees: p.trainees.map((x) => (x.traineeId === traineeId ? { ...x, hostel: newHostel, roomNo: newRoom } : x)),
        roomHistory: [
          ...p.roomHistory,
          { traineeId, prevHostel: t ? t.hostel : '', prevRoom: t ? t.roomNo : '', newHostel, newRoom, changeDate: todayStr(), changedBy: actor() },
        ],
      };
    });
  };

  // ---------- Attendance (one record per trainee per date) ----------
  const saveAttendance = (traineeId, date, status, extra = {}) =>
    setDb((p) => {
      const match = (a) =>
        ((a.traineeId && a.traineeId === traineeId) || (a.qrId && (a.qrId === traineeId || a.qrId === extra.qrId))) &&
        a.date === date;
      const exists = p.attendance.some(match);
      const rec = {
        traineeId: extra.traineeId || traineeId || '',
        qrId: extra.qrId || '',
        hostel: extra.hostel || '',
        roomNo: extra.roomNo || '',
        shift: status || 'A',
        status: status || 'A',
        date,
        markedBy: session?.name || 'System',
        ...extra,
      };
      return {
        ...p,
        attendance: exists
          ? p.attendance.map((a) => (match(a) ? { ...a, ...rec } : a))
          : [...p.attendance, rec],
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
    const fromDate = data.outDate || data.fromDate || todayStr();
    const toDate = data.inDate || data.toDate || fromDate;
    const days = daysDiff(fromDate, toDate) + 1;
    const isCompleted = !!(data.inTime || data.isCompleted);
    const recData = {
      ...data,
      fromDate,
      toDate,
      days,
      leaveDate: data.leaveDate || fromDate,
      isCompleted,
    };
    upsert('leaves', 'LV', recData, id);
    const t = getTrainee(data.traineeId || data.qrId);
    if (t) {
      if (isCompleted) {
        updateTrainee(t.traineeId || t.qrId, { hostelStatus: 'ACTIVE' });
      } else {
        updateTrainee(t.traineeId || t.qrId, { hostelStatus: 'ON LEAVE' });
      }
    }
  };

  const saveOutingVacate = (data, id) => {
    const isCompleted = !!(data.inTime || data.isCompleted);
    const recData = {
      ...data,
      date: data.outDate || data.date || todayStr(),
      fromDate: data.outDate || data.fromDate || todayStr(),
      isCompleted,
    };
    upsert('outingVacate', 'OV', recData, id);
    const t = getTrainee(data.traineeId || data.qrId);
    if (t) {
      if (isCompleted) {
        updateTrainee(t.traineeId || t.qrId, { hostelStatus: 'ACTIVE' });
      } else if (data.type === 'PERMANENT VACATE') {
        updateTrainee(t.traineeId || t.qrId, { hostelStatus: 'PERMANENT VACATE', qrStatus: 'INACTIVE' });
      } else if (data.type === 'TEMPORARY VACATE') {
        updateTrainee(t.traineeId || t.qrId, { hostelStatus: 'TEMPORARY VACATE' });
      } else {
        updateTrainee(t.traineeId || t.qrId, { hostelStatus: 'OUTING' });
      }
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

  const deleteHostel = async (hostelId) => {
    try {
      const res = await api(`/api/hostels/${encodeURIComponent(hostelId)}`, { method: 'DELETE' });
      setDb((p) => ({
        ...p,
        hostels: p.hostels.filter((h) => h.id !== hostelId && h.name !== hostelId),
      }));
      notify(res.message || 'Hostel deleted successfully.');
      return { ok: true, message: res.message };
    } catch (err) {
      notify(err.message || 'Failed to delete hostel.');
      return { ok: false, error: err.message };
    }
  };

  const deleteRoom = async (hostelId, roomNo) => {
    try {
      const res = await api(`/api/hostels/${encodeURIComponent(hostelId)}/rooms/${encodeURIComponent(roomNo)}`, {
        method: 'DELETE',
      });
      setDb((p) => ({
        ...p,
        hostels: p.hostels.map((h) =>
          h.id === hostelId || h.name === hostelId
            ? { ...h, rooms: h.rooms.filter((r) => String(r.no) !== String(roomNo)) }
            : h
        ),
      }));
      notify(res.message || `Room ${roomNo} deleted successfully.`);
      return { ok: true, message: res.message };
    } catch (err) {
      notify(err.message || `Failed to delete room ${roomNo}.`);
      return { ok: false, error: err.message };
    }
  };

  // ---------- Super Admin: delete records (Leave / Outing / Resignation) ----------
  const deleteLeaveRecord = async (id) => {
    try {
      const res = await api(`/api/records/leave/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setDb((p) => {
        const rec = p.leaves.find((x) => x.id === id);
        let nextTrainees = p.trainees;
        if (rec && (!rec.isCompleted || !rec.inTime)) {
          nextTrainees = p.trainees.map((t) =>
            (t.traineeId === rec.traineeId || t.qrId === rec.qrId) && t.hostelStatus === 'ON LEAVE'
              ? { ...t, hostelStatus: 'ACTIVE' }
              : t
          );
        }
        return {
          ...p,
          leaves: p.leaves.filter((x) => x.id !== id),
          trainees: nextTrainees,
        };
      });
      notify(res.message || `Leave record ${id} deleted.`);
      return true;
    } catch (err) {
      notify(`Delete failed: ${err.message}`);
      return false;
    }
  };

  const deleteOutingRecord = async (id) => {
    try {
      const res = await api(`/api/records/outing/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setDb((p) => {
        const rec = p.outingVacate.find((x) => x.id === id);
        let nextTrainees = p.trainees;
        if (rec && (!rec.isCompleted || !rec.inTime)) {
          nextTrainees = p.trainees.map((t) =>
            (t.traineeId === rec.traineeId || t.qrId === rec.qrId) && ['OUTING', 'TEMPORARY VACATE'].includes(t.hostelStatus)
              ? { ...t, hostelStatus: 'ACTIVE' }
              : t
          );
        }
        return {
          ...p,
          outingVacate: p.outingVacate.filter((x) => x.id !== id),
          trainees: nextTrainees,
        };
      });
      notify(res.message || `Outing record ${id} deleted.`);
      return true;
    } catch (err) {
      notify(`Delete failed: ${err.message}`);
      return false;
    }
  };

  const deleteResignationRecord = async (id) => {
    try {
      const res = await api(`/api/records/resignation/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setDb((p) => {
        const rec = p.resignations.find((x) => x.id === id);
        let nextTrainees = p.trainees;
        if (rec) {
          const remainingRes = p.resignations.filter((x) => x.id !== id && x.traineeId === rec.traineeId);
          if (remainingRes.length === 0) {
            nextTrainees = p.trainees.map((t) =>
              t.traineeId === rec.traineeId && t.employmentStatus === 'RESIGNED'
                ? { ...t, employmentStatus: 'ACTIVE', hostelStatus: t.hostelStatus === 'RESIGNED' ? 'ACTIVE' : t.hostelStatus }
                : t
            );
          }
        }
        return {
          ...p,
          resignations: p.resignations.filter((x) => x.id !== id),
          trainees: nextTrainees,
        };
      });
      notify(res.message || `Resignation record ${id} deleted.`);
      return true;
    } catch (err) {
      notify(`Delete failed: ${err.message}`);
      return false;
    }
  };

  // ---------- Super Admin: login members ----------
  const saveUser = async (user, password) => { const r = await api('/api/users', { method: 'POST', body: { action: 'save', user, password } }); setUsers(r.users); };
  const deleteUser = async (user) => { const r = await api('/api/users', { method: 'POST', body: { action: 'delete', user } }); setUsers(r.users); };
  const changePassword = (oldPassword, newPassword) => api('/api/me/password', { method: 'POST', body: { oldPassword, newPassword } });

  const value = {
    db, config, roles, users, session, route, toast, booting, syncError, isSuper, roleName, can,
    setConfig, setRoles,
    login, logout, navigate, notify,
    getTrainee, actor,
    addTrainee, updateTrainee, approveTrainee, rejectTrainee, deleteTrainee, changeRoom,
    saveAttendance, startDay, saveDaySummary, saveLeave, saveOutingVacate, saveResignation, saveRemark,
    deleteLeaveRecord, deleteOutingRecord, deleteResignationRecord,
    addHostel, addRoom, setRoomCapacity, deleteHostel, deleteRoom, saveUser, deleteUser, changePassword,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
