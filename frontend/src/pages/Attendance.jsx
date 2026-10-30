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

export default function Attendance() {
  const { route } = useStore();
  const [tab, setTab] = useState(route.params.tab || 'scan');
  return (
    <>
      <div className="tabbar">
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>
          <Icon name="scan" size={15} /> High-Volume Attendance
        </button>
        <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>
          <Icon name="bar" size={15} /> Daily Summary
        </button>
      </div>
      {tab === 'scan' ? <Scan /> : <Summary />}
    </>
  );
}
