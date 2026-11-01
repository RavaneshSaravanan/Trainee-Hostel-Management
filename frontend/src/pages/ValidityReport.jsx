import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import { Card, Icon, Table } from '../components/ui.jsx';
import { fmtDate, todayStr } from '../utils/dates.js';

export default function ValidityReport() {
  const { db, notify, navigate } = useStore();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState({ summary: {}, trainees: [] });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [hostel, setHostel] = useState('');
  const [fromJoining, setFromJoining] = useState('');
  const [toJoining, setToJoining] = useState('');

  const fetchReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (hostel) params.set('hostel', hostel);
      if (fromJoining) params.set('fromJoining', fromJoining);
      if (toJoining) params.set('toJoining', toJoining);

      const res = await api(`/api/validity/report?${params.toString()}`);
      setReport(res);
    } catch (err) {
      notify(err.message || 'Failed to load validity report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, [q, status, hostel, fromJoining, toJoining]);

  const exportCsv = () => {
    const headers = [
      'Trainee ID',
      'Name',
      'Hostel',
      'Room No',
      'Mobile',
      'Joining Date',
      'Free Stay Expiry Date',
      'Days Remaining',
      'Validity Status',
      'Classification',
    ];

    const rows = (report.trainees || []).map((t) => [
      t.traineeId,
      t.name,
      t.hostel,
      t.roomNo,
      t.mobile,
      t.joiningDate,
      t.freeStayExpiryDate,
      t.daysRemaining,
      t.validityStatus,
      t.validityStatus === 'FREE' ? 'Free Trainee' : t.validityStatus === 'EXPIRING_SOON' ? 'Expiring Soon' : t.validityStatus === 'PAID' ? 'Paid Trainee' : 'Expired Trainee',
    ]);

    const qv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const titleHeader = `"APOLLO TYRES LTD - Trainee Stay Validity Report (${todayStr()})"`;
    const csv = [titleHeader, '', headers.map(qv).join(','), ...rows.map((r) => r.map(qv).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `validity-report-${todayStr()}.csv`;
    a.click();
  };

  const s = report.summary || {};
  const totalLiving = s.totalLivingTrainees ?? s.totalResiding ?? 0;
  const freeCount = s.freeTrainees ?? s.freeStay ?? s.freeCount ?? 0;
  const paidCount = s.paidTrainees ?? s.paid ?? s.paidCount ?? 0;
  const expiringSoonCount = s.expiringSoon ?? s.expiringSoonCount ?? 0;
  const expiredCount = s.expiredTrainees ?? s.expiredDue ?? s.expiredDueCount ?? 0;

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Hostel Stay Validity & Free-Period Monitoring</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            3-calendar-month free accommodation tracking, stay expiry alerts, and living trainee monitoring.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={loading || !report.trainees?.length}>
          <Icon name="download" size={15} /> Export CSV
        </button>
      </div>

      {/* 5 KPI Summary Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-card" style={{ borderLeft: '4px solid var(--primary, #7c3aed)' }}>
          <div className="kpi-label">Total Living Trainees</div>
          <div className="kpi-value">{totalLiving}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #16a34a' }}>
          <div className="kpi-label" style={{ color: '#16a34a' }}>Free Trainees</div>
          <div className="kpi-value" style={{ color: '#16a34a' }}>{freeCount}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div className="kpi-label" style={{ color: '#2563eb' }}>Paid Trainees</div>
          <div className="kpi-value" style={{ color: '#2563eb' }}>{paidCount}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #ea580c' }}>
          <div className="kpi-label" style={{ color: '#ea580c' }}>Expiring Soon</div>
          <div className="kpi-value" style={{ color: '#ea580c' }}>{expiringSoonCount}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #dc2626' }}>
          <div className="kpi-label" style={{ color: '#dc2626' }}>Expired Trainees</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>{expiredCount}</div>
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="filter-bar">
          <input
            className="input"
            placeholder="Search Trainee ID, Name, Room, Hostel…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Validity Statuses</option>
            <option value="FREE">Free Stay Active</option>
            <option value="EXPIRING_SOON">Expiring Soon (≤ 15 Days)</option>
            <option value="EXPIRED_DUE">Expired Free Period</option>
            <option value="PAID">Paid Trainees</option>
          </select>
          <select className="input" value={hostel} onChange={(e) => setHostel(e.target.value)}>
            <option value="">All Hostels</option>
            {(db.hostels || []).map((h) => (
              <option key={h.id} value={h.name}>{h.name}</option>
            ))}
          </select>
          <input
            className="input"
            type="date"
            title="Filter by Joining Date (From)"
            value={fromJoining}
            onChange={(e) => setFromJoining(e.target.value)}
          />
          <input
            className="input"
            type="date"
            title="Filter by Joining Date (To)"
            value={toJoining}
            onChange={(e) => setToJoining(e.target.value)}
          />
        </div>
      </div>

      {/* Trainees Validity Table (Monitoring & Reporting strictly, no payment actions) */}
      <Card title={`Validity Monitoring (${report.trainees?.length || 0} trainees)`} noPad>
        <Table
          headers={[
            'Trainee ID',
            'Name',
            'Hostel',
            'Room',
            'Joining Date',
            'Free Stay Expiry',
            'Days Left',
            'Validity Status',
            'Actions',
          ]}
          empty={loading ? 'Loading validity records…' : 'No trainee records found matching the filters.'}
          rows={(report.trainees || []).map((t) => [
            <a className="link" onClick={() => navigate('trainee-profile', { id: t.traineeId })}>
              {t.traineeId}
            </a>,
            <strong>{t.name}</strong>,
            t.hostel,
            t.roomNo,
            fmtDate(t.joiningDate),
            fmtDate(t.freeStayExpiryDate),
            <span
              style={{
                fontWeight: 600,
                color:
                  t.validityStatus === 'EXPIRED_DUE'
                    ? 'var(--red, #dc2626)'
                    : t.validityStatus === 'EXPIRING_SOON'
                    ? 'var(--orange, #ea580c)'
                    : 'inherit',
              }}
            >
              {t.validityStatus === 'PAID'
                ? 'PAID'
                : t.daysRemaining < 0
                ? `${Math.abs(t.daysRemaining)}d overdue`
                : `${t.daysRemaining}d left`}
            </span>,
            <span
              className={`chip ${
                t.validityStatus === 'FREE'
                  ? 'chip-green'
                  : t.validityStatus === 'EXPIRING_SOON'
                  ? 'chip-orange'
                  : t.validityStatus === 'EXPIRED_DUE'
                  ? 'chip-red'
                  : 'chip-blue'
              }`}
            >
              {t.validityStatus === 'FREE'
                ? 'FREE'
                : t.validityStatus === 'EXPIRING_SOON'
                ? 'EXPIRING SOON'
                : t.validityStatus === 'EXPIRED_DUE'
                ? 'EXPIRED'
                : 'PAID'}
            </span>,
            <div className="row-actions">
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => navigate('trainee-profile', { id: t.traineeId })}
              >
                <Icon name="eye" size={13} /> View
              </button>
            </div>,
          ])}
        />
      </Card>
    </>
  );
}
