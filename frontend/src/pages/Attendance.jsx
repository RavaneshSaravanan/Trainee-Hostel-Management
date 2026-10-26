import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.jsx';
import { ATT_CODES, ATT_LABELS } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Table } from '../components/ui.jsx';
import QrScanner from '../components/QrScanner.jsx';
import { fmtDate, todayStr } from '../utils/dates.js';
import { dayCounts } from '../utils/summary.js';

const BLOCKED = ['PENDING REVIEW', 'RESIGNED', 'PERMANENT VACATE', 'INACTIVE'];

/* ---------------- Tab 1: scan QR (camera / scanner gun) or type ID ---------------- */
// Flow: SCAN QR (camera, hardware scanner, or type Trainee ID) -> trainee + default shift appear -> pick status -> SUBMIT.
// "Auto-mark" skips the middle step: a scan instantly marks the trainee's default shift.
// One record per trainee per date: submitting again for the same date UPDATES it (no duplicates).
function Scan() {
  const { db, route, saveAttendance, navigate, notify } = useStore();
  const today = todayStr();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [date, setDate] = useState(today);
  const [sel, setSel] = useState('');
  const [camera, setCamera] = useState(false);
  const [auto, setAuto] = useState(false);
  const [last, setLast] = useState(null); // { ok, text }
  const inputRef = useRef(null);

  const trainee = found ? db.trainees.find((t) => t.traineeId === found) : null;
  const existing = trainee ? db.attendance.find((a) => a.traineeId === found && a.date === date) : null;
  const blocked = !!trainee && BLOCKED.includes(trainee.hostelStatus);

  useEffect(() => {
    if (route.params.traineeId) { setFound(route.params.traineeId); setDate(route.params.date || today); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!trainee) { setSel(''); return; }
    setSel(existing ? existing.status : date === today ? trainee.defaultShift : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, date, existing && existing.status]);

  const lookup = (text, exactOnly) => {
    const q = text.trim().toLowerCase();
    if (!q) return null;
    return db.trainees.find((x) => x.traineeId.toLowerCase() === q || (x.qrId && x.qrId.toLowerCase() === q) || (x.hostelId || '').toLowerCase() === q)
      || (exactOnly ? null : db.trainees.find((x) => x.name.toLowerCase().includes(q)));
  };

  const find = (e) => {
    e.preventDefault();
    const t = lookup(query);
    if (!t) { notify('No trainee found for that ID / QR / name.'); return; }
    setFound(t.traineeId); setQuery('');
  };

  // A camera scan: show the trainee, or (auto-mark) save the default shift straight away.
  const onCameraScan = (text) => {
    const t = lookup(text, true);
    if (!t) { setLast({ ok: false, text: `Unknown QR: ${text.slice(0, 30)}` }); return; }
    if (BLOCKED.includes(t.hostelStatus)) { setLast({ ok: false, text: `${t.name}: attendance not allowed (${t.hostelStatus})` }); return; }
    if (auto) {
      const ex = db.attendance.find((a) => a.traineeId === t.traineeId && a.date === today);
      if (ex) { setLast({ ok: true, text: `${t.name} already marked ${ex.status} today` }); return; }
      saveAttendance(t.traineeId, today, t.defaultShift);
      setLast({ ok: true, text: `✓ ${t.name} marked ${t.defaultShift}` });
    } else {
      setFound(t.traineeId); setDate(today); setCamera(false);
    }
  };

  const submit = () => {
    if (!sel) { notify('Please select an attendance status.'); return; }
    if (blocked) { notify('Attendance cannot be marked for this trainee.'); return; }
    saveAttendance(trainee.traineeId, date, sel);
    notify(`${existing ? 'Updated' : 'Marked'} ${sel} for ${trainee.name} on ${fmtDate(date)}.`);
    setFound(null); setDate(today);
    if (inputRef.current) inputRef.current.focus();
  };

  const todays = db.attendance.filter((a) => a.date === today);

  return (
    <div className="grid-2">
      <Card title={<><Icon name="scan" size={17} /> Scan / Search Trainee</>}>
        <div className="att-tools">
          <button className={`btn ${camera ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCamera(!camera)}>
            <Icon name="camera" size={16} /> {camera ? 'Camera on' : 'Scan with camera'}
          </button>
          <label className="switch-row">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <span>Auto-mark default shift on scan</span>
          </label>
        </div>
        {camera && <QrScanner onScan={onCameraScan} onClose={() => setCamera(false)} />}
        {last && <div className={`scan-result ${last.ok ? 'ok' : 'bad'}`}>{last.text}</div>}

        <form onSubmit={find}>
          <label className="field-label">Or scan with a scanner / type Trainee ID, QR ID, name</label>
          <div className="scan-row">
            <input ref={inputRef} className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Trainee ID / QR ID…" />
            <button className="btn btn-primary" type="submit">Find</button>
          </div>
        </form>
        <div style={{ marginTop: 12 }}>
          <label className="field-label">Attendance date</label>
          <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </div>

        {!trainee ? (
          <div className="empty-state small">Scan a trainee's QR code or search by ID to mark attendance.</div>
        ) : (
          <>
            <div className="scan-found">
              <Avatar trainee={trainee} size="md" />
              <div className="scan-found-info">
                <div className="scan-found-name">{trainee.name}</div>
                <div className="scan-found-sub">{trainee.traineeId} · {trainee.hostel || 'Not allocated'}{trainee.roomNo ? ` · Room ${trainee.roomNo}` : ''}</div>
                <div className="scan-found-shift">
                  Default Shift: <strong>{trainee.defaultShift}</strong> · Marking for <strong>{fmtDate(date)}</strong>{date === today ? ' (today)' : ''}
                </div>
              </div>
            </div>
            {existing && <div className="notice">Already marked for {fmtDate(date)} as <Badge status={existing.status} />. Choosing a new status will update it — no duplicate is created.</div>}
            {blocked && <div className="notice">This trainee is not currently living in the hostel ({trainee.hostelStatus}), so attendance can't be marked.</div>}
            <div className="att-status-grid">
              {ATT_CODES.map((c) => (
                <button key={c} type="button" className={`att-status-btn ${sel === c ? 'selected' : ''}`} onClick={() => setSel(c)}>
                  {c}<span>{ATT_LABELS[c]}</span>
                </button>
              ))}
            </div>
            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} onClick={submit} disabled={blocked}>
              <Icon name="check" size={15} /> {existing ? 'Update Attendance' : 'Submit Attendance'}
            </button>
          </>
        )}
      </Card>

      <Card title={`Today's Attendance — ${fmtDate(today)}`} sub={`${todays.length} marked`} noPad>
        <Table
          headers={['Photo', 'Trainee ID', 'Name', 'Status', 'Marked By', '']}
          empty="No attendance marked yet today."
          rows={todays.map((a) => {
            const t = db.trainees.find((x) => x.traineeId === a.traineeId);
            return [
              t && <Avatar trainee={t} />,
              <a className="link" onClick={() => navigate('trainee-profile', { id: a.traineeId })}>{a.traineeId}</a>,
              t ? t.name : '', <Badge status={a.status} />, a.markedBy || '—',
              <button className="btn btn-ghost btn-xs" onClick={() => { setFound(a.traineeId); setDate(today); }}><Icon name="edit" size={13} /> Edit</button>,
            ];
          })}
        />
      </Card>
    </div>
  );
}

/* ---------------- Tab 2: daily summary (just type how many people per code) ---------------- */
function Summary() {
  const { db, startDay, saveDaySummary, notify } = useStore();
  const today = todayStr();
  const [date, setDate] = useState(today);
  const day = (db.dailySummary || {})[date] || {};
  const c = dayCounts(db, date);
  const [manual, setManual] = useState({});

  useEffect(() => { setManual({ ...(day.manual || {}) }); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const expected = db.trainees.filter((t) => !BLOCKED.includes(t.hostelStatus) && t.employmentStatus === 'ACTIVE').length;
  const typed = (code) => manual[code] !== undefined && manual[code] !== '';
  const finalOf = (code) => (typed(code) ? Number(manual[code]) : c.marked[code]);
  const total = ATT_CODES.reduce((s, k) => s + finalOf(k), 0);

  const save = () => { saveDaySummary(date, manual); notify(`Summary saved for ${fmtDate(date)}.`); };

  return (
    <>
      <Card title="Daily Attendance Summary" sub="Type how many trainees are in each code — no need to mark every person.">
        <div className="att-tools">
          <div style={{ minWidth: 170 }}>
            <label className="field-label">Date</label>
            <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
          </div>
          {day.started ? (
            <div className="notice" style={{ margin: 0 }}>Attendance started by <strong>{day.startedBy}</strong> at {new Date(day.startedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
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
            <div className="sum-tile-l">of {expected} in hostel{expected > total ? ` · ${expected - total} not counted` : ''}</div>
          </div>
        </div>

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>Code</th><th>Marked individually</th><th>Type count</th><th>Final</th></tr></thead>
            <tbody>
              {ATT_CODES.map((k) => (
                <tr key={k}>
                  <td><strong>{k}</strong> <span className="muted">{ATT_LABELS[k]}</span></td>
                  <td>{c.marked[k]}</td>
                  <td><input className="input num-input" type="number" min="0" inputMode="numeric" value={manual[k] ?? ''} placeholder={String(c.marked[k])}
                    onChange={(e) => setManual({ ...manual, [k]: e.target.value })} /></td>
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
        <button className={`tab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}><Icon name="scan" size={15} /> Scan / Mark</button>
        <button className={`tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}><Icon name="bar" size={15} /> Daily Summary</button>
      </div>
      {tab === 'scan' ? <Scan /> : <Summary />}
    </>
  );
}
