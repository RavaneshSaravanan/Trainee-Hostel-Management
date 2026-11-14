import { useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { SHIFTS, HOSTEL_STATUSES, ATT_CODES, ATT_LABELS } from '../data/constants.js';
import { Badge, Card, Icon, Table } from '../components/ui.jsx';
import { fmtDate, todayStr } from '../utils/dates.js';
import { dayCounts, occupantsOf } from '../utils/summary.js';
import { isComplete } from '../utils/details.js';
import { exportDashboardPptx } from '../utils/pptxExport.js';
import {
  HostelOccupancyChart,
  FreeVsPaidDonutChart,
  AvailableBedsBarChart,
  AttendanceTrendLineChart,
  ShiftAttendanceChart,
  MonthlyJoiningChart,
  LeaveVsOutingChart,
  FreeStayExpiryTimelineChart,
  OccupancyRadialGauge,
} from '../components/DashboardCharts.jsx';

const EMPTY = { hostel: '', from: '', to: '' };

export default function Dashboard() {
  const { db, navigate, config, session, notify } = useStore();
  const W = (k) => config.widgets[k] !== false;
  const [f, setF] = useState(EMPTY);
  const [downloadingPptx, setDownloadingPptx] = useState(false);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const filtered = Boolean(f.hostel || f.from || f.to);

  const handleDownloadPptx = async () => {
    setDownloadingPptx(true);
    try {
      await exportDashboardPptx({ db, config, session, selectedHostel: f.hostel });
      notify('PowerPoint (.pptx) dashboard presentation generated successfully.');
    } catch (err) {
      notify('Failed to generate presentation: ' + err.message);
    } finally {
      setDownloadingPptx(false);
    }
  };

  // Trainees filtered by current view filters
  const ts = useMemo(() => {
    return db.trainees.filter((t) => {
      if (f.hostel && t.hostel !== f.hostel) return false;
      if (f.from && (!t.joiningDate || t.joiningDate < f.from)) return false;
      if (f.to && (!t.joiningDate || t.joiningDate > f.to)) return false;
      return true;
    });
  }, [db.trainees, f]);

  const ids = useMemo(() => new Set(ts.map((t) => t.traineeId)), [ts]);
  const nameOf = (id) => (db.trainees.find((t) => t.traineeId === id) || {}).name || '';
  const count = (fn) => ts.filter(fn).length;

  const today = todayStr();
  const day = dayCounts(db, today);

  // ---------------- Hostel Aggregations ----------------
  const hostelRows = useMemo(() => {
    return db.hostels
      .filter((h) => !f.hostel || h.name === f.hostel)
      .map((h) => {
        const totalRooms = h.rooms.length;
        const cap = h.rooms.reduce((s, r) => s + (r.capacity || 0), 0);
        const occupied = h.rooms.reduce(
          (s, r) => s + occupantsOf(db, h.name, r.no).filter((t) => ids.has(t.traineeId)).length,
          0
        );
        const freeBeds = Math.max(0, cap - occupied);
        const pct = cap > 0 ? Math.round((occupied / cap) * 100) : 0;
        const freeTrainees = ts.filter((t) => t.hostel === h.name && t.hostelStatus === 'ACTIVE' && (t.paymentStatus === 'FREE' || !t.paymentStatus)).length;
        const paidTrainees = ts.filter((t) => t.hostel === h.name && t.hostelStatus === 'ACTIVE' && t.paymentStatus === 'PAID').length;
        const presentToday = db.attendance.filter((a) => a.date === today && a.hostel === h.name && (a.status === 'P' || a.code === 'P' || a.shift)).length;

        return {
          name: h.name,
          totalRooms,
          cap,
          occupied,
          freeBeds,
          freePct: cap > 0 ? Math.round((freeBeds / cap) * 100) : 0,
          pct,
          freeTrainees,
          paidTrainees,
          presentToday,
        };
      });
  }, [db.hostels, db.attendance, f.hostel, ids, ts, today]);

  // Total capacity and occupied beds
  const totalCapacity = hostelRows.reduce((s, h) => s + h.cap, 0);
  const totalOccupiedBeds = hostelRows.reduce((s, h) => s + h.occupied, 0);
  const totalFreeBeds = Math.max(0, totalCapacity - totalOccupiedBeds);
  const overallOccupancyRate = totalCapacity > 0 ? Math.round((totalOccupiedBeds / totalCapacity) * 100) : 0;

  // Free vs Paid Stay Active Trainees
  const freeStayActive = count((t) => t.hostelStatus === 'ACTIVE' && (t.paymentStatus === 'FREE' || !t.paymentStatus));
  const paidStayActive = count((t) => t.hostelStatus === 'ACTIVE' && t.paymentStatus === 'PAID');

  // Expiring Free Stays in next 15 days
  const todayDateObj = new Date(today);
  const expiryBuckets = useMemo(() => {
    let critical = 0; // 0 - 7 days
    let approaching = 0; // 8 - 15 days
    let upcoming = 0; // 16 - 30 days
    let safe = 0; // > 30 days

    ts.forEach((t) => {
      if (t.hostelStatus === 'ACTIVE' && (t.paymentStatus === 'FREE' || !t.paymentStatus) && t.freeStayExpiryDate) {
        const expDate = new Date(t.freeStayExpiryDate);
        const diffDays = Math.ceil((expDate - todayDateObj) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 7) critical++;
        else if (diffDays > 7 && diffDays <= 15) approaching++;
        else if (diffDays > 15 && diffDays <= 30) upcoming++;
        else if (diffDays > 30) safe++;
      }
    });

    return { critical, approaching, upcoming, safe };
  }, [ts, todayDateObj]);

  const expiringNext15Days = expiryBuckets.critical + expiryBuckets.approaching;

  // Attendance metrics
  const activeInHostel = count((t) => t.hostelStatus === 'ACTIVE');
  const presentToday = day.final.P || 0;
  const absentToday = day.final.A || 0;
  const activeOnLeaveOuting = count((t) => t.hostelStatus === 'ON LEAVE' || t.hostelStatus === 'OUTING');
  const complianceRate = (presentToday + absentToday) > 0
    ? Math.round((presentToday / (presentToday + absentToday)) * 100)
    : activeInHostel > 0
    ? Math.round((presentToday / activeInHostel) * 100)
    : 100;

  // 14 Live Metrics for Tiles
  const metrics14 = [
    { label: 'Total Registered Trainees', value: ts.length, icon: 'users', color: '#5B21B6' },
    { label: 'Currently in Hostel', value: activeInHostel, icon: 'home', color: '#16A34A' },
    { label: 'Pending Approvals', value: count((t) => t.hostelStatus === 'PENDING REVIEW' || t.approvalStatus === 'PENDING_APPROVAL'), icon: 'alert', color: '#D97706' },
    { label: 'Total Hostel Capacity', value: `${totalCapacity} Beds`, icon: 'grid', color: '#4C1D95' },
    { label: 'Occupied Beds', value: totalOccupiedBeds, icon: 'checkSquare', color: '#6D28D9' },
    { label: 'Free Beds Available', value: totalFreeBeds, icon: 'arrowBox', color: '#059669' },
    { label: 'Overall Occupancy Rate', value: `${overallOccupancyRate}%`, icon: 'bar', color: overallOccupancyRate >= 90 ? '#DC2626' : '#7C3AED' },
    { label: 'Free Stay Trainees', value: freeStayActive, icon: 'users', color: '#8B5CF6' },
    { label: 'Paid Stay Trainees', value: paidStayActive, icon: 'checkSquare', color: '#D97706' },
    { label: 'Expiring Stays (≤15 Days)', value: expiringNext15Days, icon: 'calendar', color: expiringNext15Days > 0 ? '#DC2626' : '#16A34A' },
    { label: 'Present Today', value: presentToday, icon: 'check', color: '#16A34A' },
    { label: 'Absent Today', value: absentToday, icon: 'x', color: '#DC2626' },
    { label: 'On Leave / Outing', value: activeOnLeaveOuting, icon: 'calendarX', color: '#6366F1' },
    { label: 'Today Compliance Rate', value: `${complianceRate}%`, icon: 'checkSquare', color: complianceRate >= 80 ? '#16A34A' : '#DC2626' },
  ];

  // ---------------- Chart 4 Data: Past 7 Days Attendance Trend ----------------
  const past7DaysData = useMemo(() => {
    const res = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const c = db.attendance.filter((a) => a.date === ds && (a.status === 'P' || a.code === 'P' || a.shift)).length;
      res.push({ label, count: c, date: ds });
    }
    return res;
  }, [db.attendance]);

  // ---------------- Chart 5 Data: Today Shift Breakdown ----------------
  const shiftData = useMemo(() => {
    return SHIFTS.map((s) => {
      const c = db.attendance.filter((a) => a.date === today && a.shift === s).length;
      return { shift: s, label: `${s} Shift`, count: c };
    });
  }, [db.attendance, today]);

  // ---------------- Chart 6 Data: Monthly Joining (Last 6 Months) ----------------
  const monthlyJoiningData = useMemo(() => {
    const res = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const prefix = `${y}-${m}`;
      const monthLabel = d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
      const countJoined = ts.filter((t) => t.joiningDate && t.joiningDate.startsWith(prefix)).length;
      res.push({ month: monthLabel, count: countJoined });
    }
    return res;
  }, [ts]);

  // ---------------- Chart 7 Data: Leave vs Outing Daily ----------------
  const leaveVsOutingData = useMemo(() => {
    const res = [];
    for (let i = 4; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      const leaves = db.leaves.filter((l) => l.date === ds || l.startDate === ds).length;
      const outings = db.outingVacate.filter((o) => o.date === ds && o.type === 'OUTING').length;
      res.push({ label, leaves, outings, date: ds });
    }
    return res;
  }, [db.leaves, db.outingVacate]);

  // Recent operational activity
  const recentRegs = [...ts].sort((a, b) => (b.submissionDate > a.submissionDate ? 1 : -1)).slice(0, 5);
  const recentResign = db.resignations.filter((r) => ids.has(r.traineeId)).sort((a, b) => (b.resignationDate > a.resignationDate ? 1 : -1)).slice(0, 5);
  const recentComplaints = db.remarks.filter((r) => r.type === 'COMPLAINT' && ids.has(r.traineeId)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 5);
  const recentOv = db.outingVacate.filter((r) => ids.has(r.traineeId)).sort((a, b) => (b.date > a.date ? 1 : -1)).slice(0, 5);

  const pendingDetails = ts.filter((t) => t.employmentStatus === 'ACTIVE' && t.hostelStatus !== 'INACTIVE' && !isComplete(t, config.customFields));
  const link = (id) => <a className="link" onClick={() => navigate('trainee-profile', { id })}>{id}</a>;

  return (
    <>
      {/* Page Header */}
      <div className="page-head no-print" style={{ marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, color: 'var(--purple-900, #2E1065)', fontWeight: 800 }}>
            Executive Operations Dashboard
          </h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            Apollo Tyres Ltd Trainee Hostel Management · Real-time occupancy, attendance compliance, and operational analytics.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleDownloadPptx}
          disabled={downloadingPptx}
          title="Download complete executive dashboard report as PowerPoint presentation (.pptx)"
          style={{ whiteSpace: 'nowrap' }}
        >
          <Icon name="download" size={15} />
          {downloadingPptx ? 'Generating 10-Slide Deck…' : 'Download Dashboard (.pptx)'}
        </button>
      </div>

      {/* Alert banner for pending details */}
      {pendingDetails.length > 0 && (
        <div className="alert-banner bad" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={20} />
          <div className="alert-text">
            <strong>{pendingDetails.length} trainee{pendingDetails.length > 1 ? 's have' : ' has'} pending profile details.</strong> Please review and complete missing records.
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => navigate('trainees', { details: 'pending' })}>
            View pending
          </button>
        </div>
      )}

      {/* Filters Bar */}
      {W('filters') && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="card-body" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 200, flex: 1 }}>
                <label className="field-label">Filter by Hostel</label>
                <select className="input" value={f.hostel} onChange={set('hostel')}>
                  <option value="">All Hostels ({db.hostels.length})</option>
                  {db.hostels.map((h) => (
                    <option key={h.id} value={h.name}>{h.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ minWidth: 150, flex: 1 }}>
                <label className="field-label">Joined From</label>
                <input className="input" type="date" value={f.from} onChange={set('from')} />
              </div>

              <div style={{ minWidth: 150, flex: 1 }}>
                <label className="field-label">Joined To</label>
                <input className="input" type="date" value={f.to} onChange={set('to')} />
              </div>

              {filtered && (
                <button className="btn btn-ghost" onClick={() => setF(EMPTY)} style={{ height: 38 }}>
                  <Icon name="x" size={14} /> Clear Filters
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 1: 14 Live Metrics Tiles */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--purple-800)', margin: '0 0 10px' }}>
          Live Operational Metrics (MongoDB Aggregates)
        </h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          {metrics14.map((m) => (
            <div
              key={m.label}
              className="card kpi-card"
              style={{
                borderLeft: `4px solid ${m.color}`,
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="kpi-label" style={{ fontSize: 11.5 }}>{m.label}</span>
                <span style={{ color: m.color }}><Icon name={m.icon} size={16} /></span>
              </div>
              <div className="kpi-value" style={{ fontSize: 22, marginTop: 4, color: m.color }}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: 9 Interactive SVG Charts in Apollo Tyres Violet Theme */}
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--purple-800)', margin: '0 0 10px' }}>
          Visual Analytics & Interactive Trends
        </h3>

        {/* Row 1: Hostel Occupancy & Free vs Paid */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <Card title="1. Hostel Capacity vs Occupied Beds" sub="Comparison of room capacity and occupied beds per block.">
            <HostelOccupancyChart data={hostelRows} />
          </Card>

          <Card title="2. Free Stay vs Paid Stay Distribution" sub="Active trainee proportion in 3-month free vs paid tenure.">
            <FreeVsPaidDonutChart free={freeStayActive} paid={paidStayActive} />
          </Card>
        </div>

        {/* Row 2: Available Beds & Occupancy Gauge */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <Card title="3. Vacant Beds Available by Hostel" sub="Available beds ready for incoming trainee allocation.">
            <AvailableBedsBarChart data={hostelRows} />
          </Card>

          <Card title="4. Overall Hostel Occupancy Gauge" sub="Total bed occupancy rate across all hostel blocks.">
            <OccupancyRadialGauge occupied={totalOccupiedBeds} capacity={totalCapacity} />
          </Card>
        </div>

        {/* Row 3: 7-Day Attendance & Shift Breakdown */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <Card title="5. 7-Day Attendance Volume Trend" sub="Recorded present trainee counts over the past week.">
            <AttendanceTrendLineChart data={past7DaysData} />
          </Card>

          <Card title="6. Today's Attendance by Shift" sub="Trainee distribution across A, B, C and General shifts.">
            <ShiftAttendanceChart data={shiftData} />
          </Card>
        </div>

        {/* Row 4: Monthly Joining Velocity & Leave vs Outing */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <Card title="7. Monthly Trainee Joining Velocity" sub="Onboarding volume across the past 6 months.">
            <MonthlyJoiningChart data={monthlyJoiningData} />
          </Card>

          <Card title="8. Leave vs Outing Daily Distribution" sub="Past 5 days trainee movement outside hostel premises.">
            <LeaveVsOutingChart data={leaveVsOutingData} />
          </Card>
        </div>

        {/* Row 5: Free Stay Expiry Timeline & Today's Summary */}
        <div className="grid-2" style={{ marginBottom: 14 }}>
          <Card title="9. Free Stay Expiry Risk Timeline" sub="Active free-stay trainees grouped by expiry urgency.">
            <FreeStayExpiryTimelineChart data={expiryBuckets} />
          </Card>

          <Card title={`Today's Attendance Categories — ${fmtDate(today)}`} sub="Instant count by attendance status code.">
            <div className="sum-tiles" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 8 }}>
              {ATT_CODES.map((k) => (
                <div className="sum-tile" key={k} style={{ padding: '8px 6px', textAlign: 'center' }}>
                  <div className="sum-tile-code" style={{ fontSize: 13, fontWeight: 700 }}>{k}</div>
                  <div className="sum-tile-n" style={{ fontSize: 16 }}>{day.final[k] || 0}</div>
                  <div className="sum-tile-l" style={{ fontSize: 10 }}>{ATT_LABELS[k]}</div>
                </div>
              ))}
              <div className="sum-tile total" style={{ padding: '8px 6px', textAlign: 'center', background: 'var(--purple-100)' }}>
                <div className="sum-tile-code" style={{ fontSize: 13, fontWeight: 700 }}>TOTAL</div>
                <div className="sum-tile-n" style={{ fontSize: 16 }}>{day.total || 0}</div>
                <div className="sum-tile-l" style={{ fontSize: 10 }}>Marked</div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Section 3: Detailed Hostel-Wise Comparison Table */}
      <div style={{ marginBottom: 20 }}>
        <Card title="Hostel-wise Infrastructure & Occupancy Comparison" sub="Comprehensive block-level breakdown of rooms, beds, occupancy rates, and active residents." noPad>
          <Table
            headers={[
              'Hostel Block',
              'Total Rooms',
              'Total Beds',
              'Occupied',
              'Vacant Beds',
              'Occupancy %',
              'Free Stays',
              'Paid Stays',
              'Present Today',
            ]}
            empty="No hostels configured in the database."
            rows={hostelRows.map((h) => [
              <strong>{h.name}</strong>,
              h.totalRooms,
              h.cap,
              h.occupied,
              <span style={{ color: h.freeBeds > 0 ? '#16A34A' : '#DC2626', fontWeight: 700 }}>{h.freeBeds}</span>,
              <span style={{ fontWeight: 700, color: h.pct >= 90 ? '#DC2626' : '#5B21B6' }}>{h.pct}%</span>,
              h.freeTrainees,
              h.paidTrainees,
              <span style={{ color: '#16A34A', fontWeight: 600 }}>{h.presentToday}</span>,
            ])}
          />
        </Card>
      </div>

      {/* Section 4: Recent Operational Activity Feeds */}
      <div className="grid-2">
        {W('registrations') && (
          <Card title="Recent Registrations" noPad>
            <Table
              headers={['Trainee ID', 'Name', 'Submitted', 'Status']}
              empty="No recent registrations."
              rows={recentRegs.map((t) => [link(t.traineeId), t.name, fmtDate(t.submissionDate), <Badge status={t.hostelStatus} />])}
            />
          </Card>
        )}

        {W('resignations') && (
          <Card title="Recent Resignations" noPad>
            <Table
              headers={['Trainee ID', 'Name', 'Last Working Day', 'Status']}
              empty="No resignation records found."
              rows={recentResign.map((r) => [link(r.traineeId), nameOf(r.traineeId), fmtDate(r.lastWorkingDate), <Badge status={r.status} />])}
            />
          </Card>
        )}
      </div>

      <div className="grid-2" style={{ marginTop: 14 }}>
        {W('complaints') && (
          <Card title="Recent Complaints / Remarks" noPad>
            <Table
              headers={['Trainee ID', 'Remark / Complaint', 'Date', 'Status']}
              empty="No complaints recorded."
              rows={recentComplaints.map((r) => [link(r.traineeId), r.text, fmtDate(r.date), <Badge status={r.status} />])}
            />
          </Card>
        )}

        {W('outing') && (
          <Card title="Recent Outing & Vacate Activity" noPad>
            <Table
              headers={['Trainee ID', 'Type', 'Date', 'Status']}
              empty="No outing or vacate records."
              rows={recentOv.map((r) => [link(r.traineeId), <Badge status={r.type} />, fmtDate(r.date), <Badge status={r.status} />])}
            />
          </Card>
        )}
      </div>
    </>
  );
}
