import { useState } from 'react';
import { useStore } from '../store.jsx';
import { SHIFTS, HOSTEL_STATUSES, ATT_CODES, ATT_LABELS } from '../data/constants.js';
import { Badge, Card, Icon, Table } from '../components/ui.jsx';
import { fmtDate, todayStr } from '../utils/dates.js';
import { dayCounts, occupantsOf } from '../utils/summary.js';
import { isComplete } from '../utils/details.js';

const EMPTY = { hostel: '', from: '', to: '', employmentStatus: '', hostelStatus: '', shift: '' };

export default function Dashboard() {
  const { db, navigate, config } = useStore();
  const W = (k) => config.widgets[k] !== false;
  const [f, setF] = useState(EMPTY);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const filtered = Object.values(f).some(Boolean);

  // Every number on this page is computed from the filtered trainee list.
  const ts = db.trainees.filter((t) =>
    (!f.hostel || t.hostel === f.hostel) &&
    (!f.employmentStatus || t.employmentStatus === f.employmentStatus) &&
    (!f.hostelStatus || t.hostelStatus === f.hostelStatus) &&
    (!f.shift || t.defaultShift === f.shift) &&
    (!f.from || t.joiningDate >= f.from) &&
    (!f.to || t.joiningDate <= f.to)
  );
  const ids = new Set(ts.map((t) => t.traineeId));
  const nameOf = (id) => (db.trainees.find((t) => t.traineeId === id) || {}).name || '';
  const count = (fn) => ts.filter(fn).length;

  const kpis = [
    ['Total Trainees', ts.length, 'users'],
    ['Active Trainees', count((t) => t.employmentStatus === 'ACTIVE'), 'checkSquare'],
    ['Currently In Hostel', count((t) => t.hostelStatus === 'ACTIVE'), 'home'],
    ['On Leave', count((t) => t.hostelStatus === 'ON LEAVE'), 'calendarX'],
    ['On Outing', count((t) => t.hostelStatus === 'OUTING'), 'arrowBox'],
    ['Temp. Vacated', count((t) => t.hostelStatus === 'TEMPORARY VACATE'), 'arrowBox'],
    ['Perm. Vacated', count((t) => t.hostelStatus === 'PERMANENT VACATE'), 'doorExit'],
    ['Resigned', count((t) => t.employmentStatus === 'RESIGNED'), 'doorExit'],
  ];

  const hostelRows = db.hostels.filter((h) => !f.hostel || h.name === f.hostel).map((h) => {
    const cap = h.rooms.reduce((s, r) => s + r.capacity, 0);
    const n = h.rooms.reduce((s, r) => s + occupantsOf(db, h.name, r.no).filter((t) => ids.has(t.traineeId)).length, 0);
    return { name: h.name, n, cap, pct: Math.round((n / cap) * 100) };
  });

  const shiftCounts = SHIFTS.map((s) => ({ s, n: ts.filter((t) => t.defaultShift === s && t.hostelStatus === 'ACTIVE').length }));
  const maxShift = Math.max(1, ...shiftCounts.map((x) => x.n));

  const recentRegs = [...ts].sort((a, b) => (b.submissionDate > a.submissionDate ? 1 : -1)).slice(0, 5);
  const recentResign = db.resignations.filter((r) => ids.has(r.traineeId)).sort((a, b) => (b.resignationDate > a.resignationDate ? 1 : -1)).slice(0, 5);
  const recentComplaints = db.remarks.filter((r) => r.type === 'COMPLAINT' && ids.has(r.traineeId)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 5);
  const recentOv = db.outingVacate.filter((r) => ids.has(r.traineeId)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 5);

  const link = (id) => <a className="link" onClick={() => navigate('trainee-profile', { id })}>{id}</a>;

  const pendingDetails = db.trainees.filter((t) => t.employmentStatus === 'ACTIVE' && t.hostelStatus !== 'INACTIVE' && !isComplete(t, config.customFields));
  const day = dayCounts(db, todayStr());
  const dayStarted = ((db.dailySummary || {})[todayStr()] || {}).started;

  return (
    <>
      {pendingDetails.length > 0 ? (
        <div className="alert-banner bad">
          <Icon name="alert" size={20} />
          <div className="alert-text"><strong>{pendingDetails.length} trainee{pendingDetails.length > 1 ? 's have' : ' has'} pending details.</strong> Open and fill the missing details — they turn green once complete.</div>
          <button className="btn btn-danger btn-sm" onClick={() => navigate('trainees', { details: 'pending' })}>View pending</button>
        </div>
      ) : (
        <div className="alert-banner good"><Icon name="check" size={20} /><div className="alert-text"><strong>All trainee details are complete.</strong></div></div>
      )}

      {W('filters') && (
      <div className="card">
        <div className="card-body">
          <div className="report-filter-form">
            <div><label className="field-label">Hostel</label>
              <select className="input" value={f.hostel} onChange={set('hostel')}>
                <option value="">All Hostels</option>
                {db.hostels.map((h) => <option key={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div><label className="field-label">Joined From</label><input className="input" type="date" value={f.from} onChange={set('from')} /></div>
            <div><label className="field-label">Joined To</label><input className="input" type="date" value={f.to} onChange={set('to')} /></div>
            <div><label className="field-label">Employment Status</label>
              <select className="input" value={f.employmentStatus} onChange={set('employmentStatus')}>
                <option value="">All</option><option>ACTIVE</option><option>RESIGNED</option>
              </select>
            </div>
            <div><label className="field-label">Hostel Status</label>
              <select className="input" value={f.hostelStatus} onChange={set('hostelStatus')}>
                <option value="">All</option>{HOSTEL_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div><label className="field-label">Shift</label>
              <select className="input" value={f.shift} onChange={set('shift')}>
                <option value="">All Shifts</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            {filtered && <button className="btn btn-ghost" onClick={() => setF(EMPTY)}><Icon name="x" size={14} /> Clear</button>}
          </div>
        </div>
      </div>
      )}

      {W('kpis') && (
      <div className="kpi-grid">
        {kpis.map(([label, value, icon]) => (
          <div className="kpi-card" key={label}>
            <div className="kpi-icon"><Icon name={icon} size={18} /></div>
            <div className="kpi-value">{value}</div>
            <div className="kpi-label">{label}</div>
          </div>
        ))}
        <div className="kpi-card kpi-red" onClick={() => navigate('trainees', { details: 'pending' })} style={{ cursor: 'pointer' }}>
          <div className="kpi-icon"><Icon name="alert" size={18} /></div>
          <div className="kpi-value">{ts.filter((t) => pendingDetails.includes(t)).length}</div>
          <div className="kpi-label">Details Pending</div>
        </div>
      </div>
      )}

      {W('attendanceToday') && (
      <Card title={`Today's Attendance — ${fmtDate(todayStr())}`} sub={dayStarted ? 'Started' : 'Not started yet'}
        action={<button className="btn btn-ghost btn-sm" onClick={() => navigate('attendance', { tab: 'summary' })}>Open summary</button>}>
        <div className="sum-tiles">
          {ATT_CODES.map((k) => (
            <div className="sum-tile" key={k}><div className="sum-tile-code">{k}</div><div className="sum-tile-n">{day.final[k]}</div><div className="sum-tile-l">{ATT_LABELS[k]}</div></div>
          ))}
          <div className="sum-tile total"><div className="sum-tile-code">TOTAL</div><div className="sum-tile-n">{day.total}</div><div className="sum-tile-l">counted today</div></div>
        </div>
      </Card>
      )}

      <div className="grid-2">
        {W('occupancy') && (
        <Card title="Hostel-wise Room Occupancy">
          {hostelRows.map((h) => (
            <div className="hostel-row" key={h.name}>
              <div className="hostel-row-name"><Icon name="home" size={15} /> {h.name}</div>
              <div className="hostel-row-bar"><div className="hostel-row-fill" style={{ width: `${h.pct}%` }} /></div>
              <div className="hostel-row-count">{h.n}/{h.cap}</div>
            </div>
          ))}
        </Card>
        )}
        {W('shifts') && (
        <Card title="Shift Distribution (active trainees)">
          <div className="shift-bars">
            {shiftCounts.map((x) => (
              <div className="shift-bar-col" key={x.s}>
                <div className="shift-bar" style={{ height: Math.max(6, Math.round((x.n / maxShift) * 90)) }} />
                <div className="shift-bar-label">{x.s}</div>
                <div className="shift-bar-value">{x.n}</div>
              </div>
            ))}
          </div>
        </Card>
        )}
      </div>

      <div className="grid-2">
        {W('registrations') && (
        <Card title="Recent Registrations" noPad>
          <Table headers={['Trainee ID', 'Name', 'Submitted', 'Status']}
            rows={recentRegs.map((t) => [link(t.traineeId), t.name, fmtDate(t.submissionDate), <Badge status={t.hostelStatus} />])} />
        </Card>
        )}
        {W('resignations') && (
        <Card title="Recent Resignations" noPad>
          <Table headers={['Trainee ID', 'Name', 'Last Working Day', 'Status']}
            rows={recentResign.map((r) => [link(r.traineeId), nameOf(r.traineeId), fmtDate(r.lastWorkingDate), <Badge status={r.status} />])} />
        </Card>
        )}
      </div>

      <div className="grid-2">
        {W('complaints') && (
        <Card title="Recent Complaints" noPad>
          <Table headers={['Trainee ID', 'Complaint', 'Date', 'Status']}
            rows={recentComplaints.map((r) => [link(r.traineeId), r.text, fmtDate(r.date), <Badge status={r.status} />])} />
        </Card>
        )}
        {W('outing') && (
        <Card title="Recent Outing / Vacate Activity" noPad>
          <Table headers={['Trainee ID', 'Type', 'Date', 'Status']}
            rows={recentOv.map((r) => [link(r.traineeId), <Badge status={r.type} />, fmtDate(r.date), <Badge status={r.status} />])} />
        </Card>
        )}
      </div>
    </>
  );
}
