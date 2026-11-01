import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { ATT_CODES, ATT_LABELS, SHIFTS } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Table } from '../components/ui.jsx';
import QrScanner from '../components/QrScanner.jsx';
import { fmtDate, todayStr } from '../utils/dates.js';
import { dayCounts } from '../utils/summary.js';
import { api } from '../utils/api.js';

// Web Audio API beep synthesizer for rapid feedback (no audio asset files needed)
function playBeep(type = 'success') {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(880, ctx.currentTime); // High pitch (A5)
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === 'duplicate') {
      osc.frequency.setValueAtTime(320, ctx.currentTime); // Medium alert tone
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else {
      osc.frequency.setValueAtTime(180, ctx.currentTime); // Low error buzz
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    // Gracefully handle browser autoplay policies
  }
}

/* ---------------- High-Volume Attendance Scanner (Modes 1 & 2) ---------------- */
function Scan() {
  const { notify } = useStore();
  const today = todayStr();

  // Persistent settings across hundreds of scans
  const [shift, setShift] = useState('A');
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState('camera'); // 'camera' | 'manual'
  const [cameraActive, setCameraActive] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Live session statistics
  const [stats, setStats] = useState({ total: 0, success: 0, duplicate: 0, error: 0 });
  const [lastResult, setLastResult] = useState(null); // { ok, type, trainee, message, time }
  const [sessionScans, setSessionScans] = useState([]);

  const inputRef = useRef(null);

  // Auto-focus on input in manual mode
  useEffect(() => {
    if (mode === 'manual' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  // Core high-volume scan processor
  const handleProcessScan = async (qrOrId, method = 'QR_SCAN') => {
    let cleanInput = String(qrOrId || '').trim();
    const urlMatch = cleanInput.match(/#\/verify\/([A-Za-z0-9_-]+)/);
    if (urlMatch) {
      cleanInput = urlMatch[1];
    }
    if (!cleanInput) return;

    setSubmitting(true);
    try {
      const res = await api('/api/attendance/scan', {
        method: 'POST',
        body: {
          qrOrId: cleanInput,
          shift,
          date,
          method,
        },
      });

      // Successful Attendance Recorded
      playBeep('success');
      setStats((s) => ({ ...s, total: s.total + 1, success: s.success + 1 }));
      const timeStr = new Date().toLocaleTimeString('en-IN');
      setLastResult({
        ok: true,
        type: 'SUCCESS',
        trainee: res.trainee,
        message: `Marked Present (${shift} Shift)`,
        time: timeStr,
      });

      setSessionScans((prev) => [
        {
          id: Date.now(),
          time: timeStr,
          traineeId: res.trainee.traineeId,
          name: res.trainee.name,
          photo: res.trainee.photo,
          room: res.trainee.roomNo ? `${res.trainee.hostel} · Room ${res.trainee.roomNo}` : '—',
          shift,
          status: 'PRESENT',
          method: method === 'QR_SCAN' ? 'Camera' : 'Manual / Scanner Gun',
        },
        ...prev.slice(0, 49),
      ]);
    } catch (err) {
      const timeStr = new Date().toLocaleTimeString('en-IN');
      if (err.data?.duplicate) {
        // Duplicate Attendance (Already Scanned)
        playBeep('duplicate');
        setStats((s) => ({ ...s, total: s.total + 1, duplicate: s.duplicate + 1 }));
        setLastResult({
          ok: false,
          type: 'DUPLICATE',
          trainee: err.data?.trainee,
          message: err.message || `Already Scanned for ${shift} Shift today`,
          time: timeStr,
        });

        setSessionScans((prev) => [
          {
            id: Date.now(),
            time: timeStr,
            traineeId: err.data?.trainee?.traineeId || cleanInput,
            name: err.data?.trainee?.name || 'Trainee',
            photo: err.data?.trainee?.photo || '',
            room: '—',
            shift,
            status: 'ALREADY SCANNED',
            method: method === 'QR_SCAN' ? 'Camera' : 'Manual / Scanner Gun',
          },
          ...prev.slice(0, 49),
        ]);
      } else {
        // Invalid QR or Ineligible Trainee
        playBeep('error');
        setStats((s) => ({ ...s, total: s.total + 1, error: s.error + 1 }));
        setLastResult({
          ok: false,
          type: 'DENIED',
          trainee: err.data?.trainee,
          message: err.message || 'Attendance Denied: Ineligible or invalid ID',
          time: timeStr,
        });

        setSessionScans((prev) => [
          {
            id: Date.now(),
            time: timeStr,
            traineeId: err.data?.trainee?.traineeId || cleanInput,
            name: err.data?.trainee?.name || 'Invalid / Denied',
            photo: err.data?.trainee?.photo || '',
            room: '—',
            shift,
            status: 'DENIED',
            method: method === 'QR_SCAN' ? 'Camera' : 'Manual / Scanner Gun',
          },
          ...prev.slice(0, 49),
        ]);
      }
    } finally {
      setSubmitting(false);
      // Auto re-focus immediately for fast repetitive scanning
      if (mode === 'manual' && inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    handleProcessScan(manualQuery.trim(), 'MANUAL_ENTRY');
    setManualQuery('');
  };

  return (
    <>
      {/* Session Settings Bar: Persistent Shift and Date */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            <div>
              <label className="field-label" style={{ fontWeight: 600 }}>Active Attendance Shift *</label>
              <div className="seg">
                {['A', 'B', 'C', 'G', '12HRS'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`seg-btn ${shift === s ? 'on' : ''}`}
                    onClick={() => {
                      setShift(s);
                      notify(`Active Shift set to ${s} Shift.`);
                    }}
                  >
                    {s} Shift
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="field-label" style={{ fontWeight: 600 }}>Attendance Date</label>
              <input
                className="input"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value || today)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${mode === 'camera' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setMode('camera'); setCameraActive(true); }}
            >
              <Icon name="camera" size={16} /> Mode 1: Continuous Camera
            </button>
            <button
              className={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setMode('manual'); setCameraActive(false); }}
            >
              <Icon name="scan" size={16} /> Mode 2: Fast ID Entry
            </button>
          </div>
        </div>
      </div>

      {/* Real-time Session KPI Tiles */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-card">
          <div className="kpi-label">Session Total Scanned</div>
          <div className="kpi-value">{stats.total}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #16a34a' }}>
          <div className="kpi-label" style={{ color: '#16a34a' }}>Successfully Marked</div>
          <div className="kpi-value" style={{ color: '#16a34a' }}>{stats.success}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #ea580c' }}>
          <div className="kpi-label" style={{ color: '#ea580c' }}>Duplicates Blocked</div>
          <div className="kpi-value" style={{ color: '#ea580c' }}>{stats.duplicate}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #dc2626' }}>
          <div className="kpi-label" style={{ color: '#dc2626' }}>Denied / Invalids</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>{stats.error}</div>
        </div>
      </div>

      <div className="grid-2">
        {/* Active Scanning Box */}
        <Card title={mode === 'camera' ? 'Mode 1 — Continuous QR Scanner' : 'Mode 2 — High-Speed Manual ID / Barcode Gun'}>
          {mode === 'camera' ? (
            <div>
              <div style={{ marginBottom: 12 }}>
                {!cameraActive ? (
                  <button className="btn btn-primary btn-block" onClick={() => setCameraActive(true)}>
                    <Icon name="camera" size={16} /> Start Continuous Camera Scanner
                  </button>
                ) : (
                  <QrScanner
                    onScan={(text) => handleProcessScan(text, 'QR_SCAN')}
                    onClose={() => setCameraActive(false)}
                  />
                )}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                💡 Position the trainee attendance QR card in front of the camera. The scanner continuously records attendance for <strong>Shift {shift}</strong> with instant audio feedback.
              </p>
            </div>
          ) : (
            <form onSubmit={handleManualSubmit}>
              <label className="field-label">Trainee ID / QR ID (Barcode Gun or Keyboard Entry)</label>
              <div className="scan-row" style={{ marginTop: 6 }}>
                <input
                  ref={inputRef}
                  className="input"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder="e.g. TRN-02031 or scan barcode gun..."
                  disabled={submitting}
                  autoFocus
                />
                <button className="btn btn-primary" type="submit" disabled={submitting || !manualQuery.trim()}>
                  {submitting ? 'Marking…' : 'Submit'}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                ⚡ Auto-refocus is active. USB scanner guns or typing + Enter will submit instantly and prepare for the next trainee.
              </p>
            </form>
          )}

          {/* Flash Feedback Card for Last Scanned Trainee */}
          {lastResult && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                border: '1px solid',
                borderColor:
                  lastResult.type === 'SUCCESS' ? '#16a34a' : lastResult.type === 'DUPLICATE' ? '#ea580c' : '#dc2626',
                background:
                  lastResult.type === 'SUCCESS'
                    ? 'rgba(22, 163, 74, 0.08)'
                    : lastResult.type === 'DUPLICATE'
                    ? 'rgba(234, 88, 12, 0.08)'
                    : 'rgba(220, 38, 38, 0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {lastResult.trainee?.photo ? (
                  <img
                    src={lastResult.trainee.photo}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: '#cbd5e1',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {lastResult.trainee?.name ? lastResult.trainee.name.slice(0, 2).toUpperCase() : 'TR'}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: 16 }}>{lastResult.trainee?.name || 'Trainee ID Scan'}</strong>
                    <span style={{ fontSize: 12, color: '#64748b' }}>{lastResult.time}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 2 }}>{lastResult.message}</div>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Live Session Recent Scans Log Table */}
        <Card title={`Live Scans Log (${sessionScans.length} logged)`} noPad>
          <Table
            headers={['Time', 'Trainee ID', 'Name', 'Room', 'Shift', 'Status', 'Method']}
            empty="No scans in this session yet. Begin scanning or entering IDs above."
            rows={sessionScans.map((s) => [
              s.time,
              <strong>{s.traineeId}</strong>,
              s.name,
              s.room,
              <span className="chip">{s.shift} Shift</span>,
              <span
                className={`chip ${
                  s.status === 'PRESENT'
                    ? 'chip-green'
                    : s.status === 'ALREADY SCANNED'
                    ? 'chip-orange'
                    : 'chip-red'
                }`}
              >
                {s.status}
              </span>,
              s.method,
            ])}
          />
        </Card>
      </div>
    </>
  );
}

/* ---------------- Tab 2: Daily Attendance Summary (Counts Per Code) ---------------- */
function Summary() {
  const { db, startDay, saveDaySummary, notify } = useStore();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const day = (db.dailySummary || {})[date] || {};
  const c = dayCounts(db, date);
  const [manual, setManual] = useState({});

  useEffect(() => {
    setManual({ ...(day.manual || {}) });
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const BLOCKED = ['PENDING REVIEW', 'RESIGNED', 'PERMANENT VACATE', 'INACTIVE'];
  const expected = db.trainees.filter(
    (t) => !BLOCKED.includes(t.hostelStatus) && t.employmentStatus === 'ACTIVE'
  ).length;

  const typed = (code) => manual[code] !== undefined && manual[code] !== '';
  const finalOf = (code) => (typed(code) ? Number(manual[code]) : c.marked[code]);
  const total = ATT_CODES.reduce((s, k) => s + finalOf(k), 0);

  const save = () => {
    saveDaySummary(date, manual);
    notify(`Summary saved for ${fmtDate(date)}.`);
  };

  return (
    <>
      <Card title="Daily Attendance Summary" sub="Type how many trainees are in each code — no need to mark every person.">
        <div className="att-tools">
          <div style={{ minWidth: 170 }}>
            <label className="field-label">Date</label>
            <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
          </div>
          {day.started ? (
            <div className="notice" style={{ margin: 0 }}>
              Attendance started by <strong>{day.startedBy}</strong> at{' '}
              {new Date(day.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          ) : (
            <button className="btn btn-primary" onClick={() => { startDay(date); notify(`Attendance started for ${fmtDate(date)}.`); }}>
              <Icon name="check" size={15} /> Start attendance for {date === today ? 'today' : fmtDate(date)}
            </button>
          )}
        </div>

        <div className="sum-tiles">
          {ATT_CODES.map((k) => (
            <div className="sum-tile" key={k}>
              <div className="sum-tile-code">{k}</div>
              <div className="sum-tile-n">{finalOf(k)}</div>
              <div className="sum-tile-l">{ATT_LABELS[k]}</div>
            </div>
          ))}
          <div className="sum-tile total">
            <div className="sum-tile-code">TOTAL</div>
            <div className="sum-tile-n">{total}</div>
            <div className="sum-tile-l">
              of {expected} in hostel{expected > total ? ` · ${expected - total} not counted` : ''}
            </div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Marked individually</th>
                <th>Type count</th>
                <th>Final</th>
              </tr>
            </thead>
            <tbody>
              {ATT_CODES.map((k) => (
                <tr key={k}>
                  <td><strong>{k}</strong> <span className="muted">{ATT_LABELS[k]}</span></td>
                  <td>{c.marked[k]}</td>
                  <td>
                    <input
                      className="input num-input"
                      type="number"
                      min="0"
                      inputMode="numeric"
                      value={manual[k] ?? ''}
                      placeholder={String(c.marked[k])}
                      onChange={(e) => setManual({ ...manual, [k]: e.target.value })}
                    />
                  </td>
                  <td><strong>{finalOf(k)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="qr-actions" style={{ justifyContent: 'flex-start', marginTop: 14 }}>
          <button className="btn btn-primary" onClick={save}><Icon name="check" size={15} /> Save summary</button>
          <button className="btn btn-ghost" onClick={() => setManual({ ...c.marked })}>Use marked counts</button>
          <button className="btn btn-ghost" onClick={() => setManual({})}>Clear typed counts</button>
        </div>
      </Card>
    </>
  );
}

/* ---------------- Tab 3: Hostel-Wise Daily Scan Completion Tracker ---------------- */
function HostelTracker() {
  const { db, saveAttendance, notify } = useStore();
  const today = todayStr();

  // Top Controls
  const [selectedHostel, setSelectedHostel] = useState(db.hostels[0]?.name || '');
  const [date, setDate] = useState(today);
  const [shift, setShift] = useState('A');
  const [mode, setMode] = useState('camera'); // 'camera' | 'manual'
  const [cameraActive, setCameraActive] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const inputRef = useRef(null);

  useEffect(() => {
    if (!selectedHostel && db.hostels.length > 0) {
      setSelectedHostel(db.hostels[0].name);
    }
  }, [db.hostels, selectedHostel]);

  useEffect(() => {
    if (mode === 'manual' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  // 1. Living Member Count: Trainees active with room in that hostel (includes temporary outing/leave)
  const livingMembers = db.trainees.filter(
    (t) =>
      (t.hostel === selectedHostel || t.hostelId === selectedHostel) &&
      ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'].includes(t.hostelStatus) &&
      t.roomNo
  );

  // 2. Attendance matched
  const isScanned = (t) =>
    db.attendance.some(
      (a) =>
        a.date === date &&
        ((a.qrId && a.qrId === t.qrId) || (a.traineeId && a.traineeId === t.traineeId))
    );

  const scannedMembers = livingMembers.filter(isScanned);
  const notScannedMembers = livingMembers.filter((t) => !isScanned(t));

  const totalLiving = livingMembers.length;
  const scannedCount = scannedMembers.length;
  const notScannedCount = notScannedMembers.length;
  const completionPct = totalLiving === 0 ? 100 : Math.round((scannedCount / totalLiving) * 100);
  const isCompleted = totalLiving > 0 && scannedCount === totalLiving;

  // Process hostel-specific scan
  const handleHostelScan = async (qrOrId, method = 'QR_SCAN') => {
    let cleanInput = String(qrOrId || '').trim();
    const urlMatch = cleanInput.match(/#\/verify\/([A-Za-z0-9_-]+)/);
    if (urlMatch) cleanInput = urlMatch[1];
    cleanInput = cleanInput.toUpperCase();
    if (!cleanInput) return;

    setSubmitting(true);
    const timeStr = new Date().toLocaleTimeString('en-IN');

    // 1. Find trainee
    const trainee = db.trainees.find(
      (t) =>
        (t.traineeId && t.traineeId.toUpperCase() === cleanInput) ||
        (t.qrId && t.qrId.toUpperCase() === cleanInput) ||
        (t.hostelId && t.hostelId.toUpperCase() === cleanInput)
    );

    if (!trainee) {
      playBeep('error');
      setLastResult({
        ok: false,
        type: 'ERROR',
        message: `Invalid ID: "${cleanInput}". No trainee found.`,
        time: timeStr,
      });
      setSubmitting(false);
      return;
    }

    // 2. Check Hostel Mismatch
    const matchesHostel =
      (selectedHostel && trainee.hostel && trainee.hostel.toLowerCase() === selectedHostel.toLowerCase()) ||
      (selectedHostel && trainee.hostelId && trainee.hostelId.toLowerCase() === selectedHostel.toLowerCase());

    if (!matchesHostel) {
      playBeep('error');
      setLastResult({
        ok: false,
        type: 'ERROR',
        trainee,
        message: `Hostel Mismatch: Trainee "${trainee.name}" belongs to "${trainee.hostel || 'Unallocated'}", not "${selectedHostel}". Attendance rejected.`,
        time: timeStr,
      });
      setSubmitting(false);
      return;
    }

    // 3. Check Duplicate
    if (isScanned(trainee)) {
      playBeep('duplicate');
      setLastResult({
        ok: false,
        type: 'DUPLICATE',
        trainee,
        message: `Already Scanned: ${trainee.name} is already marked for today (${fmtDate(date)}).`,
        time: timeStr,
      });
      setSubmitting(false);
      return;
    }

    // 4. Record attendance
    try {
      await api('/api/attendance/hostel-scan', {
        method: 'POST',
        body: {
          qrOrId: cleanInput,
          hostel: selectedHostel,
          shift,
          date,
          method,
        },
      });
    } catch (e) {
      // Backend error fallback
    }

    saveAttendance(trainee.traineeId || trainee.qrId, date, shift, {
      qrId: trainee.qrId,
      traineeId: trainee.traineeId || '',
      hostel: selectedHostel,
      roomNo: trainee.roomNo,
      shift,
    });

    playBeep('success');
    setLastResult({
      ok: true,
      type: 'SUCCESS',
      trainee,
      message: `✓ Attendance Recorded: ${trainee.name} (Room ${trainee.roomNo}) marked for ${shift} Shift`,
      time: timeStr,
    });
    setSubmitting(false);
    if (mode === 'manual' && inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    handleHostelScan(manualQuery.trim(), 'MANUAL_ENTRY');
    setManualQuery('');
  };

  return (
    <>
      {/* Top Controls: Hostel dropdown, Date selector (DD/MM/YYYY), Shift */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
            <div>
              <label className="field-label" style={{ fontWeight: 600 }}>Select Hostel *</label>
              <select
                className="input"
                style={{ minWidth: 200, fontWeight: 600 }}
                value={selectedHostel}
                onChange={(e) => setSelectedHostel(e.target.value)}
              >
                {db.hostels.map((h) => (
                  <option key={h.id || h.name} value={h.name}>
                    {h.name} ({h.rooms?.length || 0} rooms)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="field-label" style={{ fontWeight: 600 }}>
                Attendance Date ({fmtDate(date)})
              </label>
              <input
                className="input"
                type="date"
                value={date}
                max={today}
                onChange={(e) => setDate(e.target.value || today)}
              />
            </div>

            <div>
              <label className="field-label" style={{ fontWeight: 600 }}>Shift</label>
              <div className="seg">
                {['A', 'B', 'C', 'G', '12HRS'].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`seg-btn ${shift === s ? 'on' : ''}`}
                    onClick={() => setShift(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${mode === 'camera' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setMode('camera'); setCameraActive(true); }}
            >
              <Icon name="camera" size={16} /> Mode 1: Camera Scanner
            </button>
            <button
              className={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setMode('manual'); setCameraActive(false); }}
            >
              <Icon name="scan" size={16} /> Mode 2: Scanner Gun / ID
            </button>
          </div>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-card">
          <div className="kpi-label">Total Living Members</div>
          <div className="kpi-value">{totalLiving}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Active in {selectedHostel}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #16a34a' }}>
          <div className="kpi-label" style={{ color: '#16a34a' }}>Successfully Scanned</div>
          <div className="kpi-value" style={{ color: '#16a34a' }}>{scannedCount}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Present on {fmtDate(date)}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #ea580c' }}>
          <div className="kpi-label" style={{ color: '#ea580c' }}>Not Yet Scanned</div>
          <div className="kpi-value" style={{ color: '#ea580c' }}>{notScannedCount}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Pending check-in</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #7c3aed' }}>
          <div className="kpi-label" style={{ color: '#7c3aed' }}>Completion %</div>
          <div className="kpi-value" style={{ color: '#7c3aed' }}>{completionPct}%</div>
          <div style={{ background: '#e2e8f0', borderRadius: 4, height: 6, marginTop: 6, overflow: 'hidden' }}>
            <div style={{ background: completionPct === 100 ? '#16a34a' : 'var(--primary, #7c3aed)', height: '100%', width: `${completionPct}%`, transition: 'width 0.3s' }} />
          </div>
        </div>
      </div>

      {/* 100% Completion Banner */}
      {isCompleted && (
        <div
          className="card"
          style={{
            marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(22, 163, 74, 0.12), rgba(22, 163, 74, 0.04))',
            borderColor: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: 16,
          }}
        >
          <div style={{ background: '#16a34a', color: '#fff', borderRadius: '50%', width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={22} />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#15803d' }}>
              Hostel Daily Attendance Completed
            </div>
            <div style={{ fontSize: 13, color: '#166534', marginTop: 2 }}>
              All {totalLiving} living members of <strong>{selectedHostel}</strong> have been successfully scanned and marked present for {fmtDate(date)}.
            </div>
          </div>
        </div>
      )}

      {/* Scanner & Feedback Row */}
      <div className="grid-2" style={{ marginBottom: 16 }}>
        <Card title={`Hostel Scanner — ${selectedHostel}`}>
          {mode === 'camera' ? (
            <div>
              <div style={{ marginBottom: 12 }}>
                {!cameraActive ? (
                  <button className="btn btn-primary btn-block" onClick={() => setCameraActive(true)}>
                    <Icon name="camera" size={16} /> Start Camera Scanner
                  </button>
                ) : (
                  <QrScanner
                    onScan={(text) => handleHostelScan(text, 'QR_SCAN')}
                    onClose={() => setCameraActive(false)}
                  />
                )}
              </div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                💡 Position the trainee ID card QR code in front of the camera. The scanner ensures the trainee belongs to <strong>{selectedHostel}</strong> and flags any mismatch.
              </p>
            </div>
          ) : (
            <form onSubmit={handleManualSubmit}>
              <label className="field-label">Trainee ID / QR ID (Barcode Gun or Manual Entry)</label>
              <div className="scan-row" style={{ marginTop: 6 }}>
                <input
                  ref={inputRef}
                  className="input"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                  placeholder={`Scan or enter ID for ${selectedHostel}...`}
                  disabled={submitting}
                  autoFocus
                />
                <button className="btn btn-primary" type="submit" disabled={submitting || !manualQuery.trim()}>
                  {submitting ? 'Marking…' : 'Submit'}
                </button>
              </div>
              <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
                ⚡ Auto-refocus is active. Scans are immediately verified against {selectedHostel} living residents.
              </p>
            </form>
          )}

          {/* Flash Feedback */}
          {lastResult && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 8,
                border: '1px solid',
                borderColor:
                  lastResult.type === 'SUCCESS' ? '#16a34a' : lastResult.type === 'DUPLICATE' ? '#ea580c' : '#dc2626',
                background:
                  lastResult.type === 'SUCCESS'
                    ? 'rgba(22, 163, 74, 0.08)'
                    : lastResult.type === 'DUPLICATE'
                    ? 'rgba(234, 88, 12, 0.08)'
                    : 'rgba(220, 38, 38, 0.08)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>{lastResult.trainee?.name || 'Scan Result'}</strong>
                <span style={{ fontSize: 11, color: '#64748b' }}>{lastResult.time}</span>
              </div>
              <div style={{ fontSize: 13, marginTop: 2 }}>{lastResult.message}</div>
            </div>
          )}
        </Card>

        {/* Members Not Yet Scanned Live Table */}
        <Card title={`Members Not Yet Scanned (${notScannedCount} remaining)`} noPad>
          <Table
            headers={['S.No', 'Trainee Name', 'Trainee ID', 'QR ID', 'Hostel Name', 'Room Number', 'Department', 'Attendance Status']}
            empty="✓ All living members of this hostel have been successfully scanned!"
            rows={notScannedMembers.map((t, idx) => [
              idx + 1,
              <strong>{t.name}</strong>,
              t.traineeId || '—',
              t.qrId || '—',
              t.hostel,
              `Room ${t.roomNo}`,
              t.qualification || '—',
              <span className="chip chip-orange">Not Yet Scanned</span>,
            ])}
          />
        </Card>
      </div>
    </>
  );
}

export default function Attendance() {
  const { route } = useStore();
  const [tab, setTab] = useState(route.params.tab || 'hostel-tracker');
  return (
    <>
      <div className="tabbar">
        <button className={`tab ${tab === 'hostel-tracker' ? 'active' : ''}`} onClick={() => setTab('hostel-tracker')}>
          <Icon name="building" size={15} /> Hostel Daily Scan Tracker
        </button>
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
          <Icon name="scan" size={15} /> High-Volume Attendance
        </button>
        <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
          <Icon name="bar" size={15} /> Daily Summary
        </button>
      </div>
      {tab === 'hostel-tracker' ? <HostelTracker /> : tab === 'scan' ? <Scan /> : <Summary />}
    </>
  );
}
