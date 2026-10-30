import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import { Badge, Card, Icon, Modal, Table } from '../components/ui.jsx';
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

  // Payment Recording Modal State
  const [payingTrainee, setPayingTrainee] = useState(null);
  const [amount, setAmount] = useState('');
  const [receiptNo, setReceiptNo] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayStr());
  const [remarks, setRemarks] = useState('');
  const [recording, setRecording] = useState(false);

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

  const handleRecordPayment = async (e) => {
    e.preventDefault();
    if (!payingTrainee) return;
    if (!amount || Number(amount) <= 0) {
      notify('Please enter a valid payment amount.');
      return;
    }

    setRecording(true);
    try {
      await api('/api/validity/payment', {
        method: 'POST',
        body: {
          traineeId: payingTrainee.traineeId,
          amount: Number(amount),
          receiptNo: receiptNo.trim(),
          paymentDate,
          remarks: remarks.trim(),
        },
      });

      notify(`Payment recorded for ${payingTrainee.name}. Status updated to PAID.`);
      setPayingTrainee(null);
      setAmount('');
      setReceiptNo('');
      setRemarks('');
      await fetchReport();
    } catch (err) {
      notify(err.message || 'Failed to record payment.');
    } finally {
      setRecording(false);
    }
  };

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
      'Payment Status',
    ];

    const rows = report.trainees.map((t) => [
      t.traineeId,
      t.name,
      t.hostel,
      t.roomNo,
      t.mobile,
      t.joiningDate,
      t.freeStayExpiryDate,
      t.daysRemaining,
      t.validityStatus,
      t.paymentStatus,
    ]);

    const qv = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((r) => r.map(qv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `validity-report-${todayStr()}.csv`;
    a.click();
  };

  const s = report.summary || {
    totalResiding: 0,
    freeCount: 0,
    expiringSoonCount: 0,
    expiredDueCount: 0,
    paidCount: 0,
  };

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h2 style={{ margin: 0, fontSize: 20 }}>Hostel Stay Validity & Free-Period Management</h2>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>
            3-calendar-month free accommodation tracking, stay expiry alerts, and payment recording.
          </p>
        </div>
        <button className="btn btn-ghost" onClick={exportCsv} disabled={loading || !report.trainees?.length}>
          <Icon name="download" size={15} /> Export CSV
        </button>
      </div>

      {/* 5 KPI Summary Cards */}
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-card">
          <div className="kpi-label">Total Residing</div>
          <div className="kpi-value">{s.totalResiding}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #16a34a' }}>
          <div className="kpi-label" style={{ color: '#16a34a' }}>Free Stay Active</div>
          <div className="kpi-value" style={{ color: '#16a34a' }}>{s.freeCount}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #ea580c' }}>
          <div className="kpi-label" style={{ color: '#ea580c' }}>Expiring Soon (≤ 15d)</div>
          <div className="kpi-value" style={{ color: '#ea580c' }}>{s.expiringSoonCount}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #dc2626' }}>
          <div className="kpi-label" style={{ color: '#dc2626' }}>Expired / Due</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>{s.expiredDueCount}</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #2563eb' }}>
          <div className="kpi-label" style={{ color: '#2563eb' }}>Paid Trainees</div>
          <div className="kpi-value" style={{ color: '#2563eb' }}>{s.paidCount}</div>
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
            <option value="EXPIRED_DUE">Expired / Payment Due</option>
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

      {/* Trainees Validity Table */}
      <Card title={`Validity Details (${report.trainees?.length || 0} trainees)`} noPad>
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
            'Payment',
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
              {t.validityStatus}
            </span>,
            <Badge status={t.paymentStatus || 'FREE'} />,
            <div className="row-actions">
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => navigate('trainee-profile', { id: t.traineeId })}
              >
                <Icon name="eye" size={13} /> View
              </button>
              {t.paymentStatus !== 'PAID' && (
                <button
                  className="btn btn-primary btn-xs"
                  onClick={() => {
                    setPayingTrainee(t);
                    setAmount('1500');
                    setPaymentDate(todayStr());
                  }}
                >
                  Record Payment
                </button>
              )}
            </div>,
          ])}
        />
      </Card>

      {/* Record Payment Modal */}
      {payingTrainee && (
        <Modal
          title={`Record Stay Payment · ${payingTrainee.name} (${payingTrainee.traineeId})`}
          onClose={() => setPayingTrainee(null)}
          onSubmit={handleRecordPayment}
        >
          <div className="alert-banner info" style={{ marginBottom: 14 }}>
            <Icon name="check" size={16} />
            <div className="alert-text">
              Free-stay expired on <strong>{fmtDate(payingTrainee.freeStayExpiryDate)}</strong>. Recording this payment updates their status to <strong>PAID</strong>.
            </div>
          </div>

          <form onSubmit={handleRecordPayment}>
            <div className="form-grid">
              <div>
                <label className="field-label">Payment Amount (₹) *</label>
                <input
                  className="input"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="e.g. 1500"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="field-label">Receipt / Transaction No.</label>
                <input
                  className="input"
                  value={receiptNo}
                  onChange={(e) => setReceiptNo(e.target.value)}
                  placeholder="e.g. REC-2026-091"
                />
              </div>

              <div>
                <label className="field-label">Payment Date *</label>
                <input
                  className="input"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="field-label">Notes / Remarks</label>
                <input
                  className="input"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Monthly accommodation fee"
                />
              </div>
            </div>

            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPayingTrainee(null)}
                disabled={recording}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={recording}>
                <Icon name="check" size={15} /> {recording ? 'Recording…' : 'Confirm & Save Payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
