import { useState, useEffect } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import { HOSTEL_STATUSES, SHIFTS } from '../data/constants.js';
import { Badge, Card, Icon, Table } from '../components/ui.jsx';
import { addDays, fmtDate, monthOptions, todayStr } from '../utils/dates.js';
import { computeSummary, dayCounts, occupantsOf } from '../utils/summary.js';

const REPORTS = [
  ['monthly', 'Monthly Trainee Summary'], ['hostel', 'Hostel-wise Summary'], ['occupancy', 'Room Occupancy'],
  ['attendance', 'Attendance Summary'], ['daily', 'Daily Attendance Summary'], ['leave', 'Leave Summary'], ['outing', 'Outing Summary'],
  ['tempvacate', 'Temporary Vacate Summary'], ['permvacate', 'Permanent Vacate Summary'], ['resignation', 'Resignation Summary'],
];

function buildReportLocally(type, db, trainees, from, to, hostelFilter) {
  const ids = new Set(trainees.map((t) => t.traineeId));
  const nameOf = (id) => (db.trainees.find((t) => t.traineeId === id) || {}).name || '';

  if (type === 'hostel') {
    return {
      headers: ['Hostel', 'Total Trainees', 'Active', 'On Leave', 'Outing', 'Temp. Vacate', 'Perm. Vacate', 'Occupancy'],
      rows: db.hostels.map((h) => {
        const list = trainees.filter((t) => t.hostel === h.name);
        const cap = h.rooms.reduce((s, r) => s + r.capacity, 0);
        const occ = h.rooms.reduce((s, r) => s + occupantsOf(db, h.name, r.no).length, 0);
        const n = (st) => list.filter((t) => t.hostelStatus === st).length;
        return [h.name, list.length, n('ACTIVE'), n('ON LEAVE'), n('OUTING'), n('TEMPORARY VACATE'), n('PERMANENT VACATE'), `${occ}/${cap}`];
      }),
    };
  }
  if (type === 'occupancy') {
    const rows = [];
    db.hostels.filter((h) => !hostelFilter || h.name === hostelFilter).forEach((h) => h.rooms.forEach((r) => {
      const occ = occupantsOf(db, h.name, r.no).length;
      rows.push([h.name, r.no, occ, r.capacity, `${Math.round((occ / r.capacity) * 100)}%`]);
    }));
    return { headers: ['Hostel', 'Room', 'Occupied', 'Capacity', 'Utilisation'], rows };
  }
  if (type === 'attendance') {
    return {
      headers: ['Trainee ID', 'Name', 'A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING'],
      rows: trainees.map((t) => { const s = computeSummary(db, t.traineeId, from, to); return [t.traineeId, t.name, s.A, s.B, s.C, s.G, s.H12, s.WO, s.L, s.OUT]; }),
    };
  }
  if (type === 'daily') {
    const rows = [];
    for (let d = from, n = 0; d <= to && n < 366; d = addDays(d, 1), n++) {
      const c = dayCounts(db, d);
      if (c.total) rows.push([fmtDate(d), c.final.A, c.final.B, c.final.C, c.final.G, c.final['12HRS'], c.final.WO, c.final.L, c.final.OUTING, c.total]);
    }
    return { headers: ['Date', 'A', 'B', 'C', 'G', '12HRS', 'WO', 'L', 'OUTING', 'Total'], rows };
  }
  if (type === 'leave') {
    return {
      headers: ['Trainee ID', 'Name', 'Type', 'From', 'To', 'Days'],
      rows: db.leaves.filter((l) => ids.has(l.traineeId) && l.toDate >= from && l.fromDate <= to)
        .map((l) => [l.traineeId, nameOf(l.traineeId), l.leaveType, fmtDate(l.fromDate), fmtDate(l.toDate), l.days]),
    };
  }
  if (['outing', 'tempvacate', 'permvacate'].includes(type)) {
    const ty = { outing: 'OUTING', tempvacate: 'TEMPORARY VACATE', permvacate: 'PERMANENT VACATE' }[type];
    return {
      headers: ['Trainee ID', 'Name', 'From', 'Expected Return', 'Reason'],
      rows: db.outingVacate.filter((o) => ids.has(o.traineeId) && o.type === ty && o.fromDate <= to && (o.expectedReturn || (ty === 'PERMANENT VACATE' ? '9999-12-31' : o.fromDate)) >= from)
        .map((o) => [o.traineeId, nameOf(o.traineeId), fmtDate(o.fromDate), o.expectedReturn ? fmtDate(o.expectedReturn) : '—', o.reason]),
    };
  }
  if (type === 'resignation') {
    return {
      headers: ['Trainee ID', 'Name', 'Resignation Date', 'Last Working Date', 'Reason'],
      rows: db.resignations.filter((r) => ids.has(r.traineeId) && r.resignationDate >= from && r.resignationDate <= to)
        .map((r) => [r.traineeId, nameOf(r.traineeId), fmtDate(r.resignationDate), fmtDate(r.lastWorkingDate), r.reason]),
    };
  }
  // monthly (default)
  let totalFreeTrainees = 0;
  let totalPaidTrainees = 0;
  let totalFreeLivingDays = 0;
  let totalPaidLivingDays = 0;
  let grandTotalLivingDays = 0;

  const rows = trainees.map((t) => {
    const s = computeSummary(db, t.traineeId, from, to);
    if (s.isFreeTrainee) totalFreeTrainees++;
    if (s.isPaidTrainee) totalPaidTrainees++;
    totalFreeLivingDays += s.freeLivingDays;
    totalPaidLivingDays += s.paidLivingDays;
    grandTotalLivingDays += s.totalLivingDays;

    return [
      t.traineeId,
      t.name,
      t.hostel || '—',
      t.roomNo || '—',
      s.workingDays,
      s.WO,
      s.L,
      s.OUT,
      s.tempVacateDays,
      s.permVacateDays,
      s.livingDays,
      s.vacatedDays,
      s.isFreeTrainee ? 1 : 0,
      s.isPaidTrainee ? 1 : 0,
      s.freeLivingDays,
      s.paidLivingDays,
      s.totalLivingDays,
    ];
  });

  return {
    headers: [
      'Trainee ID',
      'Name',
      'Hostel',
      'Room',
      'Working Days',
      'Week Off',
      'Leave',
      'Outing',
      'Temp. Vacate',
      'Perm. Vacate',
      'Living Days',
      'Vacated Days',
      'Free Trainees',
      'Paid Trainees',
      'Free Living Days',
      'Paid Living Days',
      'Total Living Days',
    ],
    rows,
    extraStats: {
      totalFreeTrainees,
      totalPaidTrainees,
      totalFreeLivingDays,
      totalPaidLivingDays,
      grandTotalLivingDays,
    },
  };
}

export default function Reports() {
  const { db, session } = useStore();
  const months = monthOptions();
  const [f, setF] = useState({
    type: 'monthly', from: addDays(todayStr(), -29), to: todayStr(),
    hostel: '', shift: '', employmentStatus: '', hostelStatus: '',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const [serverData, setServerData] = useState(null);
  const [authError, setAuthError] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch report through server-side authorized /api/reports endpoint
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setAuthError('');
      try {
        const query = new URLSearchParams({
          type: f.type,
          from: f.from,
          to: f.to,
          hostel: f.hostel,
          shift: f.shift,
          employmentStatus: f.employmentStatus,
          hostelStatus: f.hostelStatus,
        }).toString();
        const res = await api(`/api/reports?${query}`);
        if (active) setServerData(res);
      } catch (err) {
        if (active) {
          if (err.status === 403) {
            setAuthError(err.message || 'Access denied: You do not have permission to access Reports.');
          }
          setServerData(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [f.type, f.from, f.to, f.hostel, f.shift, f.employmentStatus, f.hostelStatus]);

  // If server responded with 403 Forbidden, block rendering report
  if (authError) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center', borderColor: 'var(--red, #ef4444)' }}>
        <Icon name="doorExit" size={36} style={{ color: 'var(--red, #ef4444)', marginBottom: 12 }} />
        <h3 style={{ color: 'var(--red, #ef4444)', margin: '0 0 8px 0' }}>Access Denied</h3>
        <p className="muted" style={{ margin: 0 }}>{authError}</p>
      </div>
    );
  }

  // Use server report if available, else local calculation
  const trainees = db.trainees.filter((t) =>
    (!f.hostel || t.hostel === f.hostel) && (!f.shift || t.defaultShift === f.shift) &&
    (!f.employmentStatus || t.employmentStatus === f.employmentStatus) && (!f.hostelStatus || t.hostelStatus === f.hostelStatus)
  );

  const localReport = buildReportLocally(f.type, db, trainees, f.from, f.to, f.hostel);
  const headers = serverData?.headers || localReport.headers;
  const rows = serverData?.rows || localReport.rows;
  const extraStats = serverData?.extraStats || localReport.extraStats;
  const title = REPORTS.find(([v]) => v === f.type)[1];

  const exportCsv = () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(q).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `${f.type}-report-${todayStr()}.csv`;
    a.click();
  };

  const pickMonth = (e) => {
    if (!e.target.value) return;
    const [from, to] = e.target.value.split('|');
    setF({ ...f, from, to });
  };
  const monthValue = months.find((m) => m.from === f.from && m.to === f.to);

  return (
    <>
      <div className="card">
        <div className="card-body">
          <div className="report-filter-form">
            <div><label className="field-label">Report</label>
              <select className="input" value={f.type} onChange={set('type')}>{REPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            <div><label className="field-label">Month</label>
              <select className="input" value={monthValue ? `${monthValue.from}|${monthValue.to}` : ''} onChange={pickMonth}>
                <option value="">Custom range…</option>
                {months.map((m) => <option key={m.from} value={`${m.from}|${m.to}`}>{m.label}</option>)}
              </select>
            </div>
            <div><label className="field-label">From</label><input className="input" type="date" value={f.from} onChange={set('from')} /></div>
            <div><label className="field-label">To</label><input className="input" type="date" value={f.to} onChange={set('to')} /></div>
            <div><label className="field-label">Hostel</label>
              <select className="input" value={f.hostel} onChange={set('hostel')}><option value="">All Hostels</option>{db.hostels.map((h) => <option key={h.id}>{h.name}</option>)}</select>
            </div>
            <div><label className="field-label">Shift</label>
              <select className="input" value={f.shift} onChange={set('shift')}><option value="">All Shifts</option>{SHIFTS.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div><label className="field-label">Employment Status</label>
              <select className="input" value={f.employmentStatus} onChange={set('employmentStatus')}><option value="">All</option><option>ACTIVE</option><option>RESIGNED</option></select>
            </div>
            <div><label className="field-label">Hostel Status</label>
              <select className="input" value={f.hostelStatus} onChange={set('hostelStatus')}><option value="">All</option>{HOSTEL_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <button className="btn btn-ghost" onClick={exportCsv} disabled={loading}><Icon name="download" size={15} /> Export CSV</button>
          </div>
        </div>
      </div>

      {f.type === 'monthly' && extraStats && (
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <div className="card kpi-card" style={{ borderLeft: '4px solid #16a34a' }}>
            <div className="kpi-label" style={{ color: '#16a34a' }}>Total Free Trainees</div>
            <div className="kpi-value" style={{ color: '#16a34a' }}>{extraStats.totalFreeTrainees}</div>
          </div>
          <div className="card kpi-card" style={{ borderLeft: '4px solid #2563eb' }}>
            <div className="kpi-label" style={{ color: '#2563eb' }}>Total Paid Trainees</div>
            <div className="kpi-value" style={{ color: '#2563eb' }}>{extraStats.totalPaidTrainees}</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-label">Free Living Days</div>
            <div className="kpi-value">{extraStats.totalFreeLivingDays}</div>
          </div>
          <div className="card kpi-card">
            <div className="kpi-label">Paid Living Days</div>
            <div className="kpi-value">{extraStats.totalPaidLivingDays}</div>
          </div>
          <div className="card kpi-card" style={{ borderLeft: '4px solid #7c3aed' }}>
            <div className="kpi-label" style={{ color: '#7c3aed' }}>Grand Total Living Days</div>
            <div className="kpi-value" style={{ color: '#7c3aed' }}>{extraStats.grandTotalLivingDays}</div>
          </div>
        </div>
      )}

      <Card
        title={title}
        sub={loading ? 'Loading report from server…' : f.type === 'hostel' || f.type === 'occupancy' ? 'Current snapshot' : `${fmtDate(f.from)} – ${fmtDate(f.to)} · ${rows.length} rows`}
        noPad
      >
        <Table
          headers={headers}
          empty="No report data found for the selected dates and filters."
          rows={rows.map((r) => r.map((c, i) => (headers[i] === 'Status' ? <Badge status={c} /> : c)))}
        />
      </Card>
    </>
  );
}
