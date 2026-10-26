import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Badge, Card, Icon, Modal, Table, formData } from '../components/ui.jsx';
import { daysDiff, fmtDate, todayStr } from '../utils/dates.js';

/* Shared page frame: header text + Add button + table, filtered by ?traineeId when opened from a profile. */
function RecordsPage({ subtitle, addLabel, onAdd, headers, rows, filterId, clearView }) {
  const { navigate } = useStore();
  return (
    <>
      <div className="page-head">
        <div className="muted">
          {filterId
            ? <>Filtered to {filterId} — <a className="link" onClick={() => navigate(clearView)}>clear filter</a></>
            : subtitle}
        </div>
        <button className="btn btn-primary" onClick={onAdd}><Icon name="plus" size={16} /> {addLabel}</button>
      </div>
      <Card noPad><Table headers={headers} rows={rows} /></Card>
    </>
  );
}

const useNameOf = () => {
  const { db } = useStore();
  return (id) => (db.trainees.find((t) => t.traineeId === id) || {}).name || '';
};

/** Looks up the trainee by ID; shows the name live so the user can confirm it's the right person. */
function TraineeField({ defaultValue }) {
  const { db } = useStore();
  const [id, setId] = useState(defaultValue || '');
  const name = (db.trainees.find((t) => t.traineeId === id.trim().toUpperCase()) || {}).name;
  return (
    <>
      <label className="field-label">Trainee ID</label>
      <input className="input" name="traineeId" list="trainee-ids" value={id} onChange={(e) => setId(e.target.value)} required />
      <datalist id="trainee-ids">{db.trainees.map((t) => <option key={t.traineeId} value={t.traineeId}>{t.name}</option>)}</datalist>
      <div className="muted" style={{ marginTop: 4, minHeight: 18 }}>{name ? `Trainee Name: ${name}` : id ? 'No trainee with this ID' : ''}</div>
    </>
  );
}

const normalize = (d) => ({ ...d, traineeId: d.traineeId.trim().toUpperCase() });

/* ============ LEAVE ============ */
export function Leave() {
  const { db, route, getTrainee, saveLeave, notify } = useStore();
  const nameOf = useNameOf();
  const [edit, setEdit] = useState(undefined); // undefined=closed, null=new, obj=editing
  const filterId = route.params.traineeId || '';
  const rows = db.leaves.filter((l) => !filterId || l.traineeId === filterId)
    .sort((a, b) => (a.fromDate < b.fromDate ? 1 : -1))
    .map((l) => [
      l.id, l.traineeId, nameOf(l.traineeId), l.leaveType, fmtDate(l.fromDate), fmtDate(l.toDate), l.days, l.reason, <Badge status={l.status} />,
      <button className="btn btn-ghost btn-xs" onClick={() => setEdit(l)}><Icon name="edit" size={13} /> Edit</button>,
    ]);
  return (
    <>
      <RecordsPage subtitle="All leave requests across hostels" addLabel="Add Leave" onAdd={() => setEdit(null)}
        headers={['Leave ID', 'Trainee ID', 'Name', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', '']} rows={rows} filterId={filterId} clearView="leave" />
      {edit !== undefined && <LeaveModal rec={edit} defaultId={filterId} onClose={() => setEdit(undefined)}
        onSave={(d) => {
          const data = normalize(d);
          if (!getTrainee(data.traineeId)) { notify('Unknown Trainee ID.'); return; }
          if (data.toDate < data.fromDate) { notify('To Date cannot be before From Date.'); return; }
          saveLeave(data, edit && edit.id); notify('Leave record saved.'); setEdit(undefined);
        }} />}
    </>
  );
}

function LeaveModal({ rec, defaultId, onClose, onSave }) {
  const [from, setFrom] = useState(rec ? rec.fromDate : todayStr());
  const [to, setTo] = useState(rec ? rec.toDate : todayStr());
  const days = to >= from ? daysDiff(from, to) + 1 : 0;
  return (
    <Modal title={rec ? 'Edit Leave' : 'Add Leave'} onClose={onClose} onSubmit={(e) => onSave(formData(e))}>
      <TraineeField defaultValue={rec ? rec.traineeId : defaultId} />
      <div className="two-col" style={{ marginTop: 12 }}>
        <div><label className="field-label">From Date</label><input className="input" type="date" name="fromDate" value={from} onChange={(e) => setFrom(e.target.value)} required /></div>
        <div><label className="field-label">To Date</label><input className="input" type="date" name="toDate" value={to} onChange={(e) => setTo(e.target.value)} required /></div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div><label className="field-label">Leave Type</label>
          <select className="input" name="leaveType" defaultValue={rec ? rec.leaveType : 'Casual Leave'}>
            <option>Casual Leave</option><option>Sick Leave</option><option>Emergency Leave</option>
          </select>
        </div>
        <div><label className="field-label">Number of Days</label><input className="input" value={days} readOnly disabled /></div>
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Reason</label>
      <input className="input" name="reason" defaultValue={rec ? rec.reason : ''} />
      <label className="field-label" style={{ marginTop: 12 }}>Status</label>
      <select className="input" name="status" defaultValue={rec ? rec.status : 'PENDING'}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select>
      <label className="field-label" style={{ marginTop: 12 }}>Remarks</label>
      <input className="input" name="remarks" defaultValue={rec ? rec.remarks : ''} />
    </Modal>
  );
}

/* ============ OUTING / VACATE (single OUTING_VACATE source) ============ */
export function OutingVacate() {
  const { db, route, getTrainee, saveOutingVacate, notify } = useStore();
  const nameOf = useNameOf();
  const [edit, setEdit] = useState(undefined);
  const filterId = route.params.traineeId || '';
  const rows = db.outingVacate.filter((o) => !filterId || o.traineeId === filterId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((o) => [
      o.id, o.traineeId, nameOf(o.traineeId), <Badge status={o.type} />, fmtDate(o.date), fmtDate(o.fromDate),
      o.expectedReturn ? fmtDate(o.expectedReturn) : '—', o.reason, <Badge status={o.status} />,
      <button className="btn btn-ghost btn-xs" onClick={() => setEdit(o)}><Icon name="edit" size={13} /> Edit</button>,
    ]);
  return (
    <>
      <RecordsPage subtitle="Outing, Temporary Vacate and Permanent Vacate records" addLabel="Add Record" onAdd={() => setEdit(null)}
        headers={['ID', 'Trainee ID', 'Name', 'Type', 'Date', 'From', 'Expected Return', 'Reason', 'Status', '']} rows={rows} filterId={filterId} clearView="outing-vacate" />
      {edit !== undefined && <OvModal rec={edit} defaultId={filterId} onClose={() => setEdit(undefined)}
        onSave={(d) => {
          const data = normalize(d);
          if (!getTrainee(data.traineeId)) { notify('Unknown Trainee ID.'); return; }
          if (data.type === 'PERMANENT VACATE') data.expectedReturn = '';
          else if (data.expectedReturn && data.expectedReturn < data.fromDate) { notify('Expected return cannot be before From Date.'); return; }
          saveOutingVacate({ ...data, expectedReturn: data.expectedReturn || '' }, edit && edit.id);
          notify('Outing / Vacate record saved.'); setEdit(undefined);
        }} />}
    </>
  );
}

function OvModal({ rec, defaultId, onClose, onSave }) {
  const [type, setType] = useState(rec ? rec.type : 'OUTING');
  const perm = type === 'PERMANENT VACATE';
  return (
    <Modal title={rec ? 'Edit Record' : 'Add Outing / Vacate Record'} onClose={onClose} onSubmit={(e) => onSave(formData(e))}>
      <TraineeField defaultValue={rec ? rec.traineeId : defaultId} />
      <div className="two-col" style={{ marginTop: 12 }}>
        <div><label className="field-label">Date</label><input className="input" type="date" name="date" defaultValue={rec ? rec.date : todayStr()} required /></div>
        <div><label className="field-label">Type</label>
          <select className="input" name="type" value={type} onChange={(e) => setType(e.target.value)}>
            <option>OUTING</option><option>TEMPORARY VACATE</option><option>PERMANENT VACATE</option>
          </select>
        </div>
      </div>
      <div className="two-col" style={{ marginTop: 12 }}>
        <div><label className="field-label">From Date</label><input className="input" type="date" name="fromDate" defaultValue={rec ? rec.fromDate : todayStr()} required /></div>
        <div><label className="field-label">Expected Return Date</label>
          <input className="input" type="date" name="expectedReturn" key={perm ? 'p' : 'n'} defaultValue={perm ? '' : rec ? rec.expectedReturn : ''} disabled={perm} required={type === 'TEMPORARY VACATE'} />
        </div>
      </div>
      <div className="muted" style={{ marginTop: 6 }}>
        {perm ? 'Permanent vacate: trainee will not return — no return date needed.' : type === 'TEMPORARY VACATE' ? 'Temporary vacate: trainee has gone to hometown and will return.' : 'Outing: short trip, same-day or next-day return.'}
      </div>
      <label className="field-label" style={{ marginTop: 12 }}>Reason</label>
      <input className="input" name="reason" defaultValue={rec ? rec.reason : ''} />
      <label className="field-label" style={{ marginTop: 12 }}>Status</label>
      <select className="input" name="status" defaultValue={rec ? rec.status : 'PENDING'}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select>
      <label className="field-label" style={{ marginTop: 12 }}>Remarks</label>
      <input className="input" name="remarks" defaultValue={rec ? rec.remarks : ''} />
    </Modal>
  );
}

/* ============ RESIGNATION ============ */
export function Resignation() {
  const { db, route, getTrainee, saveResignation, notify } = useStore();
  const nameOf = useNameOf();
  const [edit, setEdit] = useState(undefined);
  const filterId = route.params.traineeId || '';
  const rows = db.resignations.filter((r) => !filterId || r.traineeId === filterId)
    .sort((a, b) => (a.resignationDate < b.resignationDate ? 1 : -1))
    .map((r) => [
      r.id, r.traineeId, nameOf(r.traineeId), fmtDate(r.resignationDate), fmtDate(r.lastWorkingDate), r.reason, <Badge status={r.status} />,
      <button className="btn btn-ghost btn-xs" onClick={() => setEdit(r)}><Icon name="edit" size={13} /> Edit</button>,
    ]);
  return (
    <>
      <RecordsPage subtitle="Resignation records — the trainee master record is always retained" addLabel="Add Resignation" onAdd={() => setEdit(null)}
        headers={['ID', 'Trainee ID', 'Name', 'Resignation Date', 'Last Working Date', 'Reason', 'Status', '']} rows={rows} filterId={filterId} clearView="resignation" />
      {edit !== undefined && (
        <Modal title={edit ? 'Edit Resignation' : 'Add Resignation'} onClose={() => setEdit(undefined)}
          onSubmit={(e) => {
            const data = normalize(formData(e));
            if (!getTrainee(data.traineeId)) { notify('Unknown Trainee ID.'); return; }
            saveResignation(data, edit && edit.id);
            notify(data.status === 'APPROVED' ? 'Resignation saved. Employment status updated; trainee record retained.' : 'Resignation record saved.');
            setEdit(undefined);
          }}>
          <TraineeField defaultValue={edit ? edit.traineeId : filterId} />
          <div className="two-col" style={{ marginTop: 12 }}>
            <div><label className="field-label">Resignation Date</label><input className="input" type="date" name="resignationDate" defaultValue={edit ? edit.resignationDate : todayStr()} required /></div>
            <div><label className="field-label">Last Working Date</label><input className="input" type="date" name="lastWorkingDate" defaultValue={edit ? edit.lastWorkingDate : todayStr()} required /></div>
          </div>
          <label className="field-label" style={{ marginTop: 12 }}>Reason</label>
          <input className="input" name="reason" defaultValue={edit ? edit.reason : ''} />
          <label className="field-label" style={{ marginTop: 12 }}>Status</label>
          <select className="input" name="status" defaultValue={edit ? edit.status : 'PENDING'}><option>PENDING</option><option>APPROVED</option><option>REJECTED</option></select>
          <div className="muted" style={{ marginTop: 4 }}>Approving sets Employment Status to RESIGNED and deactivates the QR. Nothing is deleted.</div>
          <label className="field-label" style={{ marginTop: 12 }}>Remarks</label>
          <input className="input" name="remarks" defaultValue={edit ? edit.remarks : ''} />
        </Modal>
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
        headers={['ID', 'Trainee ID', 'Name', 'Date', 'Type', 'Remark / Complaint', 'Action Taken', 'Status', 'Reported By', '']} rows={rows} filterId={filterId} clearView="remarks" />
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
