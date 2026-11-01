import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Badge, Card, Icon, Modal, Table, formData } from '../components/ui.jsx';
import { calculateDuration, currentTimeStr, daysDiff, fmtDate, todayStr } from '../utils/dates.js';
import { api } from '../utils/api.js';

/* Shared page frame: header text + Add button + table, filtered by ?traineeId when opened from a profile. */
function RecordsPage({ subtitle, addLabel, onAdd, headers, rows, filterId, clearView, empty }) {
  const { navigate } = useStore();
  return (
    <>
      <div className="page-head">
        <div className="muted">
          {filterId
            ? <>Filtered to {filterId} — <a className="link" onClick={() => navigate(clearView)}>clear filter</a></>
            : subtitle}
        </div>
        {onAdd && <button className="btn btn-primary" onClick={onAdd}><Icon name="plus" size={16} /> {addLabel}</button>}
      </div>
      <Card noPad><Table headers={headers} rows={rows} empty={empty || 'No records found.'} /></Card>
    </>
  );
}

const useNameOf = () => {
  const { db } = useStore();
  return (id) => {
    if (!id) return '';
    const clean = String(id).trim().toUpperCase();
    const t = db.trainees.find((x) => (x.traineeId && x.traineeId.toUpperCase() === clean) || (x.qrId && x.qrId.toUpperCase() === clean));
    return t ? t.name : id;
  };
};

/** Looks up the trainee by ID or QR; shows name, hostel, room live. */
function TraineeField({ defaultValue, onSelect, required = true }) {
  const { db } = useStore();
  const [val, setVal] = useState(defaultValue || '');
  const clean = String(val).trim().toUpperCase();
  const trainee = db.trainees.find(
    (t) =>
      (t.traineeId && t.traineeId.toUpperCase() === clean) ||
      (t.qrId && t.qrId.toUpperCase() === clean)
  );

  const handleChange = (e) => {
    const v = e.target.value;
    setVal(v);
    const found = db.trainees.find(
      (t) =>
        (t.traineeId && t.traineeId.toUpperCase() === v.trim().toUpperCase()) ||
        (t.qrId && t.qrId.toUpperCase() === v.trim().toUpperCase())
    );
    if (onSelect) onSelect(found || null);
  };

  return (
    <>
      <label className="field-label">Trainee ID or QR ID {required ? '*' : ''}</label>
      <input
        className="input"
        name="traineeId"
        list="trainee-picker-list"
        value={val}
        onChange={handleChange}
        placeholder="Type Trainee ID or QR ID..."
        required={required}
      />
      <datalist id="trainee-picker-list">
        {db.trainees.map((t) => (
          <option key={t.qrId || t.traineeId} value={t.traineeId || t.qrId}>
            {t.name} ({t.hostel || 'Unallocated'} {t.roomNo ? `Room ${t.roomNo}` : ''})
          </option>
        ))}
      </datalist>
      <div className="muted" style={{ marginTop: 4, minHeight: 18, fontSize: 13 }}>
        {trainee ? (
          <span style={{ color: 'var(--primary, #7c3aed)', fontWeight: 500 }}>
            ✓ {trainee.name} · {trainee.hostel || 'No Hostel'}{trainee.roomNo ? ` (Room ${trainee.roomNo})` : ''} · Status: {trainee.hostelStatus}
          </span>
        ) : val ? (
          <span style={{ color: 'var(--red, #ef4444)' }}>No matching trainee found</span>
        ) : (
          'Select or enter a trainee'
        )}
      </div>
    </>
  );
}

const normalize = (d) => ({ ...d, traineeId: String(d.traineeId || '').trim().toUpperCase() });

function DeleteRecordConfirmModal({ record, recordType, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const traineeName = record?.traineeName || record?.name || '';
  const traineeId = record?.traineeId || record?.qrId || '';

  return (
    <Modal
      title={`Delete ${recordType} Record`}
      onClose={onClose}
      submitLabel={busy ? 'Deleting…' : 'Yes, Delete Record'}
      onSubmit={async () => {
        setBusy(true);
        await onConfirm(record.id);
        setBusy(false);
        onClose();
      }}
    >
      <div style={{ padding: '8px 0' }}>
        <p style={{ margin: '0 0 14px 0', fontSize: 14 }}>
          Are you sure you want to permanently delete this <strong>{recordType}</strong> record?
        </p>
        <div style={{ background: '#fef2f2', borderLeft: '4px solid #ef4444', padding: '12px 16px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
          <div style={{ marginBottom: 4 }}>• <strong>Record ID:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{record.id}</span></div>
          <div style={{ marginBottom: 4 }}>• <strong>Trainee:</strong> {traineeName || '—'} {traineeId ? `(${traineeId})` : ''}</div>
          {record.leaveType && <div style={{ marginBottom: 4 }}>• <strong>Leave Type:</strong> {record.leaveType}</div>}
          {record.type && <div style={{ marginBottom: 4 }}>• <strong>Outing Type:</strong> {record.type}</div>}
          {record.outDate && <div style={{ marginBottom: 4 }}>• <strong>Date:</strong> {fmtDate(record.outDate)} {record.outTime || ''}</div>}
          {record.resignationDate && <div style={{ marginBottom: 4 }}>• <strong>Resignation Date:</strong> {fmtDate(record.resignationDate)}</div>}
          {record.reason && <div>• <strong>Reason:</strong> {record.reason}</div>}
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Note: This action only removes the history record. The trainee's master profile and unrelated attendance records are preserved.
        </p>
      </div>
    </Modal>
  );
}

/* ============ LEAVE (IN/OUT Return Tracking) ============ */
export function Leave() {
  const { db, route, getTrainee, saveLeave, deleteLeaveRecord, isSuper, notify } = useStore();
  const nameOf = useNameOf();
  const [tab, setTab] = useState('open'); // 'open' | 'history'
  const [showDeparture, setShowDeparture] = useState(false);
  const [closingRec, setClosingRec] = useState(null);
  const [deletingRec, setDeletingRec] = useState(null);
  const filterId = route.params.traineeId || '';

  const allLeaves = db.leaves.filter((l) => !filterId || l.traineeId === filterId || l.qrId === filterId);
  const openLeaves = allLeaves
    .filter((l) => !l.inTime && !l.isCompleted)
    .sort((a, b) => ((a.outDate || a.fromDate) < (b.outDate || b.fromDate) ? 1 : -1));
  const historyLeaves = allLeaves
    .filter((l) => l.inTime || l.isCompleted)
    .sort((a, b) => ((a.outDate || a.fromDate) < (b.outDate || b.fromDate) ? 1 : -1));

  const openRows = openLeaves.map((l, idx) => [
    idx + 1,
    <strong>{l.traineeName || nameOf(l.traineeId || l.qrId)}</strong>,
    l.traineeId || l.qrId || '—',
    l.hostel ? `${l.hostel} · Rm ${l.roomNo || '—'}` : '—',
    <span className="chip">{l.leaveType || 'Casual Leave'}</span>,
    fmtDate(l.outDate || l.fromDate),
    l.outTime || '—',
    l.reason || '—',
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        className="btn btn-primary btn-xs"
        onClick={() => setClosingRec(l)}
        title="Record Return (IN)"
      >
        <Icon name="check" size={13} /> Return (IN)
      </button>
      {isSuper && (
        <button
          className="btn btn-ghost btn-xs"
          style={{ color: '#ef4444' }}
          onClick={() => setDeletingRec(l)}
          title="Delete Leave Record (Super Admin Only)"
        >
          <Icon name="trash" size={13} />
        </button>
      )}
    </div>,
  ]);

  const historyRows = historyLeaves.map((l) => [
    l.id,
    <strong>{l.traineeName || nameOf(l.traineeId || l.qrId)}</strong>,
    l.traineeId || l.qrId || '—',
    l.leaveType || 'Casual Leave',
    `${fmtDate(l.outDate || l.fromDate)}${l.outTime ? ` ${l.outTime}` : ''}`,
    `${fmtDate(l.inDate || l.toDate)}${l.inTime ? ` ${l.inTime}` : ''}`,
    <strong>{l.duration || `${l.days || 1} day(s)`}</strong>,
    l.reason || '—',
    l.remarks || '—',
    ...(isSuper
      ? [
          <button
            className="btn btn-ghost btn-xs"
            style={{ color: '#ef4444' }}
            onClick={() => setDeletingRec(l)}
            title="Delete Leave Record (Super Admin Only)"
          >
            <Icon name="trash" size={13} />
          </button>,
        ]
      : []),
  ]);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <div className="card-title">Leave Management</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Complete departure (OUT) and return (IN) tracking. Status is automatically determined from timestamps.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setShowDeparture(true)}>
            <Icon name="plus" size={16} /> Record Leave Departure (OUT)
          </button>
          {openLeaves.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setClosingRec(openLeaves[0])}>
              <Icon name="check" size={16} /> Record Return (IN)
            </button>
          )}
        </div>
      </div>

      <div className="tabbar" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
          Currently On Leave ({openLeaves.length})
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          Completed History ({historyLeaves.length})
        </button>
      </div>

      {tab === 'open' ? (
        <Card noPad>
          <Table
            headers={['S.No', 'Trainee Name', 'Trainee ID / QR', 'Hostel & Room', 'Leave Type', 'Departure Date', 'Departure Time', 'Reason', 'Actions']}
            rows={openRows}
            empty="No trainees are currently on leave."
          />
        </Card>
      ) : (
        <Card noPad>
          <Table
            headers={[
              'Leave ID', 'Trainee Name', 'Trainee ID / QR', 'Leave Type', 'Departure', 'Return', 'Duration', 'Reason', 'Remarks',
              ...(isSuper ? ['Action'] : []),
            ]}
            rows={historyRows}
            empty="No completed leave history records found."
          />
        </Card>
      )}

      {showDeparture && (
        <LeaveDepartureModal
          onClose={() => setShowDeparture(false)}
          onSave={async (data) => {
            const trainee = getTrainee(data.traineeId);
            if (!trainee) { notify('Unknown Trainee ID.'); return; }
            const hasOpen = openLeaves.some((l) => l.traineeId === trainee.traineeId || (l.qrId && l.qrId === trainee.qrId));
            if (hasOpen) { notify(`${trainee.name} is already marked ON LEAVE. Please record return first.`); return; }

            try {
              await api('/api/records/leave/out', {
                method: 'POST',
                body: {
                  traineeId: trainee.traineeId || trainee.qrId,
                  outDate: data.outDate,
                  outTime: data.outTime,
                  leaveType: data.leaveType,
                  reason: data.reason,
                  remarks: data.remarks,
                },
              });
            } catch (e) {
              // fallback to local save if backend offline
            }
            saveLeave({
              traineeId: trainee.traineeId || '',
              qrId: trainee.qrId || '',
              traineeName: trainee.name,
              hostel: trainee.hostel || '',
              roomNo: trainee.roomNo || '',
              leaveType: data.leaveType,
              reason: data.reason,
              outDate: data.outDate,
              outTime: data.outTime,
              fromDate: data.outDate,
              status: 'APPROVED',
              isCompleted: false,
              remarks: data.remarks,
            });
            notify(`Departure recorded: ${trainee.name} is now marked ON LEAVE.`);
            setShowDeparture(false);
          }}
        />
      )}

      {closingRec && (
        <LeaveReturnModal
          rec={closingRec}
          onClose={() => setClosingRec(null)}
          onSave={async ({ inDate, inTime, remarks }) => {
            const outDate = closingRec.outDate || closingRec.fromDate || todayStr();
            const outTime = closingRec.outTime || '00:00';
            const duration = calculateDuration(outDate, outTime, inDate, inTime);
            const days = Math.max(1, daysDiff(outDate, inDate) + 1);

            try {
              await api('/api/records/leave/in', {
                method: 'POST',
                body: {
                  id: closingRec.id,
                  traineeId: closingRec.traineeId || closingRec.qrId,
                  inDate,
                  inTime,
                  remarks,
                },
              });
            } catch (e) {
              // fallback
            }

            saveLeave(
              {
                ...closingRec,
                inDate,
                inTime,
                duration,
                days,
                toDate: inDate,
                isCompleted: true,
                remarks: remarks ? (closingRec.remarks ? `${closingRec.remarks}; ${remarks}` : remarks) : closingRec.remarks,
              },
              closingRec.id
            );

            notify(`Return recorded for ${closingRec.traineeName || 'Trainee'}. Duration: ${duration}. Status restored to ACTIVE.`);
            setClosingRec(null);
          }}
        />
      )}

      {deletingRec && (
        <DeleteRecordConfirmModal
          record={deletingRec}
          recordType="Leave"
          onClose={() => setDeletingRec(null)}
          onConfirm={deleteLeaveRecord}
        />
      )}
    </>
  );
}

function LeaveDepartureModal({ onClose, onSave }) {
  const [selectedTrainee, setSelectedTrainee] = useState(null);
  const [outDate, setOutDate] = useState(todayStr());
  const [outTime, setOutTime] = useState(currentTimeStr());

  return (
    <Modal
      title="Record Leave Departure (OUT)"
      onClose={onClose}
      onSubmit={(e) => {
        const d = formData(e);
        onSave({ ...d, outDate, outTime });
      }}
      submitLabel="Confirm Departure (OUT)"
    >
      <TraineeField onSelect={setSelectedTrainee} />
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Departure Date *</label>
          <input className="input" type="date" name="outDate" value={outDate} onChange={(e) => setOutDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">Departure Time *</label>
          <input className="input" type="time" name="outTime" value={outTime} onChange={(e) => setOutTime(e.target.value)} required />
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Leave Type *</label>
          <select className="input" name="leaveType" defaultValue="Casual Leave">
            <option>Casual Leave</option><option>Sick Leave</option><option>Emergency Leave</option>
          </select>
        </div>
        <div>
          <label className="field-label">Reason / Destination</label>
          <input className="input" name="reason" placeholder="e.g. Going to hometown" required />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Remarks (Optional)</label>
      <input className="input" name="remarks" placeholder="Any additional notes..." />
    </Modal>
  );
}

function LeaveReturnModal({ rec, onClose, onSave }) {
  const [inDate, setInDate] = useState(todayStr());
  const [inTime, setInTime] = useState(currentTimeStr());
  const outDate = rec.outDate || rec.fromDate || todayStr();
  const outTime = rec.outTime || '00:00';
  const duration = calculateDuration(outDate, outTime, inDate, inTime);

  return (
    <Modal
      title={`Record Leave Return (IN) — ${rec.traineeName || rec.traineeId}`}
      onClose={onClose}
      onSubmit={(e) => {
        const d = formData(e);
        onSave({ inDate, inTime, remarks: d.remarks });
      }}
      submitLabel="Confirm Return (IN)"
    >
      <div className="info-grid" style={{ marginBottom: 14 }}>
        <div className="info-item"><div className="info-k">Trainee</div><div className="info-v">{rec.traineeName || rec.traineeId}</div></div>
        <div className="info-item"><div className="info-k">Leave Type</div><div className="info-v">{rec.leaveType || 'Casual Leave'}</div></div>
        <div className="info-item"><div className="info-k">Departed At</div><div className="info-v">{fmtDate(outDate)} at {outTime}</div></div>
        <div className="info-item"><div className="info-k">Calculated Duration</div><div className="info-v" style={{ fontWeight: 700, color: 'var(--primary, #7c3aed)' }}>{duration}</div></div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Return Date *</label>
          <input className="input" type="date" value={inDate} min={outDate} onChange={(e) => setInDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">Return Time *</label>
          <input className="input" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} required />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Return Remarks (Optional)</label>
      <input className="input" name="remarks" placeholder="Return observations, health status, etc." />
    </Modal>
  );
}

/* ============ OUTING / VACATE (IN/OUT Return Tracking) ============ */
export function OutingVacate() {
  const { db, route, getTrainee, saveOutingVacate, deleteOutingRecord, isSuper, notify } = useStore();
  const nameOf = useNameOf();
  const [tab, setTab] = useState('open'); // 'open' | 'history'
  const [showDeparture, setShowDeparture] = useState(false);
  const [closingRec, setClosingRec] = useState(null);
  const [deletingRec, setDeletingRec] = useState(null);
  const filterId = route.params.traineeId || '';

  const allOutings = db.outingVacate.filter((o) => !filterId || o.traineeId === filterId || o.qrId === filterId);
  const openOutings = allOutings
    .filter((o) => !o.inTime && !o.isCompleted && o.type !== 'PERMANENT VACATE')
    .sort((a, b) => ((a.outDate || a.date) < (b.outDate || b.date) ? 1 : -1));
  const historyOutings = allOutings
    .filter((o) => o.inTime || o.isCompleted || o.type === 'PERMANENT VACATE')
    .sort((a, b) => ((a.outDate || a.date) < (b.outDate || b.date) ? 1 : -1));

  const openRows = openOutings.map((o, idx) => [
    idx + 1,
    <strong>{o.traineeName || nameOf(o.traineeId || o.qrId)}</strong>,
    o.traineeId || o.qrId || '—',
    o.hostel ? `${o.hostel} · Rm ${o.roomNo || '—'}` : '—',
    <Badge status={o.type} />,
    fmtDate(o.outDate || o.fromDate || o.date),
    o.outTime || '—',
    o.purpose || o.reason || '—',
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        className="btn btn-primary btn-xs"
        onClick={() => setClosingRec(o)}
        title="Record Return (IN)"
      >
        <Icon name="check" size={13} /> Return (IN)
      </button>
      {isSuper && (
        <button
          className="btn btn-ghost btn-xs text-danger"
          style={{ color: '#ef4444' }}
          onClick={() => setDeletingRec(o)}
          title="Delete Outing Record (Super Admin Only)"
        >
          <Icon name="trash" size={13} />
        </button>
      )}
    </div>,
  ]);

  const historyRows = historyOutings.map((o) => [
    o.id,
    <strong>{o.traineeName || nameOf(o.traineeId || o.qrId)}</strong>,
    o.traineeId || o.qrId || '—',
    <Badge status={o.type} />,
    `${fmtDate(o.outDate || o.fromDate || o.date)}${o.outTime ? ` ${o.outTime}` : ''}`,
    o.type === 'PERMANENT VACATE' ? 'Permanent Exit' : `${fmtDate(o.inDate || o.expectedReturn)}${o.inTime ? ` ${o.inTime}` : ''}`,
    <strong>{o.duration || (o.type === 'PERMANENT VACATE' ? 'Vacated' : '—')}</strong>,
    o.purpose || o.reason || '—',
    o.remarks || '—',
    ...(isSuper
      ? [
          <button
            className="btn btn-ghost btn-xs text-danger"
            style={{ color: '#ef4444' }}
            onClick={() => setDeletingRec(o)}
            title="Delete Outing Record (Super Admin Only)"
          >
            <Icon name="trash" size={13} />
          </button>,
        ]
      : []),
  ]);

  return (
    <>
      <div className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <div className="card-title">Outing & Vacate Management</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
            Complete departure (OUT) and return (IN) tracking. Status is automatically determined from timestamps.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={() => setShowDeparture(true)}>
            <Icon name="plus" size={16} /> Record Departure (OUT)
          </button>
          {openOutings.length > 0 && (
            <button className="btn btn-ghost" onClick={() => setClosingRec(openOutings[0])}>
              <Icon name="check" size={16} /> Record Return (IN)
            </button>
          )}
        </div>
      </div>

      <div className="tabbar" style={{ marginBottom: 16 }}>
        <button className={`tab ${tab === 'open' ? 'active' : ''}`} onClick={() => setTab('open')}>
          Currently Outside ({openOutings.length})
        </button>
        <button className={`tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          Completed History ({historyOutings.length})
        </button>
      </div>

      {tab === 'open' ? (
        <Card noPad>
          <Table
            headers={['S.No', 'Trainee Name', 'Trainee ID / QR', 'Hostel & Room', 'Type', 'Departure Date', 'Departure Time', 'Purpose', 'Actions']}
            rows={openRows}
            empty="No trainees are currently outside."
          />
        </Card>
      ) : (
        <Card noPad>
          <Table
            headers={[
              'Record ID', 'Trainee Name', 'Trainee ID / QR', 'Type', 'Departure', 'Return', 'Duration', 'Purpose', 'Remarks',
              ...(isSuper ? ['Action'] : []),
            ]}
            rows={historyRows}
            empty="No completed outing history records found."
          />
        </Card>
      )}

      {showDeparture && (
        <OutingDepartureModal
          onClose={() => setShowDeparture(false)}
          onSave={async (data) => {
            const trainee = getTrainee(data.traineeId);
            if (!trainee) { notify('Unknown Trainee ID.'); return; }
            if (data.type !== 'PERMANENT VACATE') {
              const hasOpen = openOutings.some((o) => o.traineeId === trainee.traineeId || (o.qrId && o.qrId === trainee.qrId));
              if (hasOpen) { notify(`${trainee.name} is already outside. Please record return first.`); return; }
            }

            try {
              await api('/api/records/outing/out', {
                method: 'POST',
                body: {
                  traineeId: trainee.traineeId || trainee.qrId,
                  outDate: data.outDate,
                  outTime: data.outTime,
                  purpose: data.purpose,
                  reason: data.purpose,
                  remarks: data.remarks,
                },
              });
            } catch (e) {
              // fallback
            }

            saveOutingVacate({
              traineeId: trainee.traineeId || '',
              qrId: trainee.qrId || '',
              traineeName: trainee.name,
              hostel: trainee.hostel || '',
              roomNo: trainee.roomNo || '',
              type: data.type,
              purpose: data.purpose,
              reason: data.purpose,
              outDate: data.outDate,
              outTime: data.outTime,
              date: data.outDate,
              fromDate: data.outDate,
              isCompleted: data.type === 'PERMANENT VACATE',
              status: 'APPROVED',
              remarks: data.remarks,
            });

            notify(`Departure recorded: ${trainee.name} is now marked ${data.type}.`);
            setShowDeparture(false);
          }}
        />
      )}

      {closingRec && (
        <OutingReturnModal
          rec={closingRec}
          onClose={() => setClosingRec(null)}
          onSave={async ({ inDate, inTime, remarks }) => {
            const outDate = closingRec.outDate || closingRec.fromDate || closingRec.date || todayStr();
            const outTime = closingRec.outTime || '00:00';
            const duration = calculateDuration(outDate, outTime, inDate, inTime);

            try {
              await api('/api/records/outing/in', {
                method: 'POST',
                body: {
                  id: closingRec.id,
                  traineeId: closingRec.traineeId || closingRec.qrId,
                  inDate,
                  inTime,
                  remarks,
                },
              });
            } catch (e) {
              // fallback
            }

            saveOutingVacate(
              {
                ...closingRec,
                inDate,
                inTime,
                duration,
                isCompleted: true,
                expectedReturn: inDate,
                remarks: remarks ? (closingRec.remarks ? `${closingRec.remarks}; ${remarks}` : remarks) : closingRec.remarks,
              },
              closingRec.id
            );

            notify(`Return recorded for ${closingRec.traineeName || 'Trainee'}. Duration: ${duration}. Status restored to ACTIVE.`);
            setClosingRec(null);
          }}
        />
      )}

      {deletingRec && (
        <DeleteRecordConfirmModal
          record={deletingRec}
          recordType="Outing / Vacate"
          onClose={() => setDeletingRec(null)}
          onConfirm={deleteOutingRecord}
        />
      )}
    </>
  );
}

function OutingDepartureModal({ onClose, onSave }) {
  const [selectedTrainee, setSelectedTrainee] = useState(null);
  const [outDate, setOutDate] = useState(todayStr());
  const [outTime, setOutTime] = useState(currentTimeStr());
  const [type, setType] = useState('OUTING');

  return (
    <Modal
      title="Record Departure (OUT)"
      onClose={onClose}
      onSubmit={(e) => {
        const d = formData(e);
        onSave({ ...d, outDate, outTime, type, purpose: d.purpose || d.reason || 'Outing' });
      }}
      submitLabel="Confirm Departure (OUT)"
    >
      <TraineeField onSelect={setSelectedTrainee} />
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Departure Date *</label>
          <input className="input" type="date" value={outDate} onChange={(e) => setOutDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">Departure Time *</label>
          <input className="input" type="time" value={outTime} onChange={(e) => setOutTime(e.target.value)} required />
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Trip Type *</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="OUTING">OUTING (Short trip, same or next day)</option>
            <option value="TEMPORARY VACATE">TEMPORARY VACATE (Hometown visit)</option>
            <option value="PERMANENT VACATE">PERMANENT VACATE (Leaving hostel permanently)</option>
          </select>
        </div>
        <div>
          <label className="field-label">Purpose / Destination *</label>
          <input className="input" name="purpose" placeholder="e.g. Market visit / Doctor appointment" required />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Remarks (Optional)</label>
      <input className="input" name="remarks" placeholder="Optional notes or contact details" />
    </Modal>
  );
}

function OutingReturnModal({ rec, onClose, onSave }) {
  const [inDate, setInDate] = useState(todayStr());
  const [inTime, setInTime] = useState(currentTimeStr());
  const outDate = rec.outDate || rec.fromDate || rec.date || todayStr();
  const outTime = rec.outTime || '00:00';
  const duration = calculateDuration(outDate, outTime, inDate, inTime);

  return (
    <Modal
      title={`Record Return (IN) — ${rec.traineeName || rec.traineeId}`}
      onClose={onClose}
      onSubmit={(e) => {
        const d = formData(e);
        onSave({ inDate, inTime, remarks: d.remarks });
      }}
      submitLabel="Confirm Return (IN)"
    >
      <div className="info-grid" style={{ marginBottom: 14 }}>
        <div className="info-item"><div className="info-k">Trainee</div><div className="info-v">{rec.traineeName || rec.traineeId}</div></div>
        <div className="info-item"><div className="info-k">Trip Type</div><div className="info-v">{rec.type}</div></div>
        <div className="info-item"><div className="info-k">Departed At</div><div className="info-v">{fmtDate(outDate)} at {outTime}</div></div>
        <div className="info-item"><div className="info-k">Calculated Duration</div><div className="info-v" style={{ fontWeight: 700, color: 'var(--primary, #7c3aed)' }}>{duration}</div></div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Return Date *</label>
          <input className="input" type="date" value={inDate} min={outDate} onChange={(e) => setInDate(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">Return Time *</label>
          <input className="input" type="time" value={inTime} onChange={(e) => setInTime(e.target.value)} required />
        </div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Return Remarks (Optional)</label>
      <input className="input" name="remarks" placeholder="Any return observations..." />
    </Modal>
  );
}

/* ============ RESIGNATION ============ */
export function Resignation() {
  const { db, route, getTrainee, saveResignation, deleteResignationRecord, isSuper, notify } = useStore();
  const nameOf = useNameOf();
  const [edit, setEdit] = useState(undefined);
  const [deletingRec, setDeletingRec] = useState(null);
  const filterId = route.params.traineeId || '';
  const rows = db.resignations.filter((r) => !filterId || r.traineeId === filterId)
    .sort((a, b) => (a.resignationDate < b.resignationDate ? 1 : -1))
    .map((r) => [
      r.id, r.traineeId, nameOf(r.traineeId), fmtDate(r.resignationDate), fmtDate(r.lastWorkingDate), r.reason,
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-ghost btn-xs" onClick={() => setEdit(r)}><Icon name="edit" size={13} /> Edit</button>
        {isSuper && (
          <button
            className="btn btn-ghost btn-xs text-danger"
            style={{ color: '#ef4444' }}
            onClick={() => setDeletingRec(r)}
            title="Delete Resignation Record (Super Admin Only)"
          >
            <Icon name="trash" size={13} /> Delete
          </button>
        )}
      </div>,
    ]);
  return (
    <>
      <RecordsPage subtitle="Resignation records — the trainee master record is always retained" addLabel="Add Resignation" onAdd={() => setEdit(null)}
        headers={['ID', 'Trainee ID', 'Name', 'Resignation Date', 'Last Working Date', 'Reason', '']} rows={rows} filterId={filterId} clearView="resignation" empty="No resignation records found." />
      {edit !== undefined && (
        <Modal title={edit ? 'Edit Resignation' : 'Add Resignation'} onClose={() => setEdit(undefined)}
          onSubmit={(e) => {
            const data = normalize(formData(e));
            if (!getTrainee(data.traineeId)) { notify('Unknown Trainee ID.'); return; }
            saveResignation({ ...data, status: edit ? (edit.status || 'APPROVED') : 'APPROVED' }, edit && edit.id);
            notify('Resignation record saved.');
            setEdit(undefined);
          }}>
          <TraineeField defaultValue={edit ? edit.traineeId : filterId} />
          <div className="two-col" style={{ marginTop: 12 }}>
            <div><label className="field-label">Resignation Date</label><input className="input" type="date" name="resignationDate" defaultValue={edit ? edit.resignationDate : todayStr()} required /></div>
            <div><label className="field-label">Last Working Date</label><input className="input" type="date" name="lastWorkingDate" defaultValue={edit ? edit.lastWorkingDate : todayStr()} required /></div>
          </div>
          <label className="field-label" style={{ marginTop: 12 }}>Reason</label>
          <input className="input" name="reason" defaultValue={edit ? edit.reason : ''} />
          <label className="field-label" style={{ marginTop: 12 }}>Remarks</label>
          <input className="input" name="remarks" defaultValue={edit ? edit.remarks : ''} />
        </Modal>
      )}
      {deletingRec && (
        <DeleteRecordConfirmModal
          record={{ ...deletingRec, traineeName: nameOf(deletingRec.traineeId) }}
          recordType="Resignation"
          onClose={() => setDeletingRec(null)}
          onConfirm={deleteResignationRecord}
        />
      )}
    </>
  );
}

/* ============ REMARKS / COMPLAINTS ============ */
export function Remarks() {
  const { db, route, session, getTrainee, saveRemark, notify } = useStore();
  const nameOf = useNameOf();
  const [edit, setEdit] = useState(undefined);
  const filterId = route.params.traineeId || '';
  const rows = db.remarks.filter((r) => !filterId || r.traineeId === filterId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((r) => [
      r.id, r.traineeId, nameOf(r.traineeId), fmtDate(r.date), <Badge status={r.type} />, r.text, r.actionTaken, <Badge status={r.status} />, r.reportedBy,
      <button className="btn btn-ghost btn-xs" onClick={() => setEdit(r)}><Icon name="edit" size={13} /> Edit</button>,
    ]);
  return (
    <>
      <RecordsPage subtitle="Full remark and complaint history, newest first" addLabel="Add Remark" onAdd={() => setEdit(null)}
        headers={['ID', 'Trainee ID', 'Name', 'Date', 'Type', 'Remark / Complaint', 'Action Taken', 'Status', 'Reported By', '']} rows={rows} filterId={filterId} clearView="remarks" empty="No remarks or complaints recorded." />
      {edit !== undefined && (
        <Modal title={edit ? 'Edit Remark' : 'Add Remark / Complaint'} onClose={() => setEdit(undefined)}
          onSubmit={(e) => {
            const data = normalize(formData(e));
            if (!getTrainee(data.traineeId)) { notify('Unknown Trainee ID.'); return; }
            saveRemark(data, edit && edit.id);
            notify('Remark saved.'); setEdit(undefined);
          }}>
          <TraineeField defaultValue={edit ? edit.traineeId : filterId} />
          <div className="two-col" style={{ marginTop: 12 }}>
            <div><label className="field-label">Date</label><input className="input" type="date" name="date" defaultValue={edit ? edit.date : todayStr()} required /></div>
            <div><label className="field-label">Type</label>
              <select className="input" name="type" defaultValue={edit ? edit.type : 'REMARK'}><option>REMARK</option><option>COMPLAINT</option></select>
            </div>
          </div>
          <label className="field-label" style={{ marginTop: 12 }}>Remark / Complaint</label>
          <textarea className="input" name="text" rows={3} defaultValue={edit ? edit.text : ''} required />
          <label className="field-label" style={{ marginTop: 12 }}>Action Taken</label>
          <input className="input" name="actionTaken" defaultValue={edit ? edit.actionTaken : ''} />
          <div className="two-col" style={{ marginTop: 12 }}>
            <div><label className="field-label">Status</label>
              <select className="input" name="status" defaultValue={edit ? edit.status : 'OPEN'}><option>OPEN</option><option>RESOLVED</option></select>
            </div>
            <div><label className="field-label">Reported By</label><input className="input" name="reportedBy" defaultValue={edit ? edit.reportedBy : session.name} required /></div>
          </div>
        </Modal>
      )}
    </>
  );
}
