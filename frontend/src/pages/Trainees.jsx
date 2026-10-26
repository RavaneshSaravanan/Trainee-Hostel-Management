import { useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { SHIFTS, HOSTEL_STATUSES } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Table } from '../components/ui.jsx';
import { ApproveModal, ChangeRoomModal, RoomOccupantsModal } from '../components/RoomModals.jsx';
import { fmtDate } from '../utils/dates.js';
import { occupantsOf } from '../utils/summary.js';
import { isComplete, missingDetails } from '../utils/details.js';

// Printable sheet of QR cards (one per trainee) — stick them on ID cards / room doors.
function QrSheet({ list, onClose }) {
  return (
    <div>
      <div className="page-head no-print">
        <button className="btn btn-ghost" onClick={onClose}><Icon name="back" size={15} /> Back</button>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="print" size={15} /> Print</button>
      </div>
      <div className="qr-sheet">
        {list.filter((t) => t.qrId).map((t) => (
          <div className="qr-tile" key={t.traineeId}>
            <QRCodeCanvas value={t.qrId} size={110} fgColor="#1F2430" bgColor="#ffffff" />
            <div className="qr-tile-name">{t.name}</div>
            <div className="qr-tile-sub">{t.traineeId} · {t.qrId}</div>
            {t.roomNo && <div className="qr-tile-sub">{t.hostel} · {t.roomNo}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Master({ initialQ, initialDetails }) {
  const { db, navigate, config } = useStore();
  const [details, setDetails] = useState(initialDetails || '');
  const [sheet, setSheet] = useState(false);
  const [q, setQ] = useState(initialQ || '');
  const [hostel, setHostel] = useState('');
  const [status, setStatus] = useState('');
  const [shift, setShift] = useState('');

  const lc = q.toLowerCase();
  const list = db.trainees.filter((t) =>
    (!lc || [t.traineeId, t.hostelId, t.name, t.mobile, t.hostel, t.roomNo].some((v) => String(v || '').toLowerCase().includes(lc))) &&
    (!hostel || t.hostel === hostel) &&
    (!status || t.hostelStatus === status) &&
    (!shift || t.defaultShift === shift) &&
    (!details || (details === 'pending') === !isComplete(t, config.customFields))
  );

  const open = (id) => navigate('trainee-profile', { id });
  if (sheet) return <QrSheet list={list} onClose={() => setSheet(false)} />;
  return (
    <div className="card">
      <div className="filter-bar">
        <input className="input" placeholder="Search Trainee ID, Hostel ID, Name, Mobile, Room…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={hostel} onChange={(e) => setHostel(e.target.value)}>
          <option value="">All Hostels</option>{db.hostels.map((h) => <option key={h.id}>{h.name}</option>)}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All Hostel Status</option>{HOSTEL_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select className="input" value={shift} onChange={(e) => setShift(e.target.value)}>
          <option value="">All Shifts</option>{SHIFTS.map((s) => <option key={s} value={s}>{s} Shift</option>)}
        </select>
        <select className="input" value={details} onChange={(e) => setDetails(e.target.value)}>
          <option value="">All Details</option><option value="pending">Details pending (red)</option><option value="complete">Details complete (green)</option>
        </select>
        <button className="btn btn-ghost" onClick={() => setSheet(true)}><Icon name="qr" size={15} /> Print QR cards</button>
      </div>
      <Table
        headers={['Photo', 'Trainee ID', 'Name', 'Details', 'Hostel ID', 'Hostel', 'Room', 'Shift', 'Hostel Status', 'QR', '']}
        rowClass={(i) => (isComplete(list[i], config.customFields) ? 'row-ok' : 'row-pending')}
        rows={list.map((t) => [
          <Avatar trainee={t} />,
          <a className="link" onClick={() => open(t.traineeId)}>{t.traineeId}</a>,
          t.name,
          isComplete(t, config.customFields) ? <Badge status="COMPLETE" /> : <span title={missingDetails(t, config.customFields).join(', ')}><Badge status="DETAILS PENDING" /></span>,
          t.hostelId || '—', t.hostel || '—', t.roomNo || '—', t.defaultShift,
          <Badge status={t.hostelStatus} />, <Badge status={t.qrStatus} />,
          <button className="btn btn-ghost btn-xs" onClick={() => open(t.traineeId)}><Icon name="eye" size={14} /> View</button>,
        ])}
      />
      <div className="table-foot">{list.length} of {db.trainees.length} trainees</div>
    </div>
  );
}

function Pending() {
  const { db, navigate, rejectTrainee, notify } = useStore();
  const [approving, setApproving] = useState(null);
  const pending = db.trainees.filter((t) => t.hostelStatus === 'PENDING REVIEW');

  return (
    <Card noPad>
      <Table
        headers={['Photo', 'Trainee ID', 'Name', 'Mobile', 'Joining Date', 'Shift', 'Submitted', 'Status', 'Actions']}
        empty="No pending trainee requests."
        rows={pending.map((t) => [
          <Avatar trainee={t} />, t.traineeId, t.name, t.mobile, fmtDate(t.joiningDate), t.defaultShift,
          fmtDate(t.submissionDate), <Badge status={t.hostelStatus} />,
          <div className="row-actions">
            <button className="btn btn-ghost btn-xs" onClick={() => navigate('trainee-profile', { id: t.traineeId })}><Icon name="eye" size={14} /> View</button>
            <button className="btn btn-ghost btn-xs" onClick={() => navigate('trainee-profile', { id: t.traineeId, sub: 'edit' })}><Icon name="edit" size={14} /> Edit</button>
            <button className="btn btn-primary btn-xs" onClick={() => setApproving(t)}><Icon name="check" size={14} /> Approve</button>
            <button
              className="btn btn-danger btn-xs"
              onClick={() => {
                if (window.confirm(`Reject the registration submitted by ${t.name}?`)) {
                  rejectTrainee(t.traineeId);
                  notify('Registration rejected (record retained as INACTIVE).');
                }
              }}
            ><Icon name="x" size={14} /> Reject</button>
          </div>,
        ])}
      />
      {approving && <ApproveModal trainee={approving} onClose={() => setApproving(null)} />}
    </Card>
  );
}

function Rooms() {
  const { db } = useStore();
  const [room, setRoom] = useState(null);   // {hostel, no}
  const [moving, setMoving] = useState(null); // trainee

  const rows = [];
  db.hostels.forEach((h) => h.rooms.forEach((r) => {
    const occ = occupantsOf(db, h.name, r.no);
    rows.push([
      h.name, r.no, `${occ.length}/${r.capacity}`,
      occ.length ? occ.map((o) => o.name).join(', ') : <span className="muted">Vacant</span>,
      <button className="btn btn-ghost btn-xs" onClick={() => setRoom({ hostel: h.name, no: r.no })}><Icon name="bed" size={14} /> Manage</button>,
    ]);
  }));

  return (
    <Card noPad>
      <Table headers={['Hostel', 'Room No.', 'Occupancy', 'Occupants', '']} rows={rows} />
      {room && !moving && (
        <RoomOccupantsModal hostel={room.hostel} roomNo={room.no} onClose={() => setRoom(null)} onMove={(t) => setMoving(t)} />
      )}
      {moving && <ChangeRoomModal trainee={moving} onClose={() => { setMoving(null); setRoom(null); }} />}
    </Card>
  );
}

export default function Trainees() {
  const { db, route, navigate } = useStore();
  const tab = route.params.tab || 'all';
  const pendingCount = db.trainees.filter((t) => t.hostelStatus === 'PENDING REVIEW').length;
  const tabs = [['all', 'All Trainees'], ['pending', 'Pending Review'], ['rooms', 'Room Management']];

  return (
    <>
      <div className="page-head">
        <div />
        <button className="btn btn-primary" onClick={() => navigate('trainee-new')}><Icon name="plus" size={16} /> New Trainee</button>
      </div>
      <div className="tabbar">
        {tabs.map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => navigate('trainees', { tab: id })}>
            {label}{id === 'pending' && pendingCount > 0 && <span className="tab-count">{pendingCount}</span>}
          </button>
        ))}
      </div>
      {tab === 'pending' ? <Pending /> : tab === 'rooms' ? <Rooms /> : <Master key={`${route.params.q || ''}|${route.params.details || ''}`} initialQ={route.params.q} initialDetails={route.params.details} />}
    </>
  );
}
