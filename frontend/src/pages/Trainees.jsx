import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { SHIFTS, HOSTEL_STATUSES } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Table } from '../components/ui.jsx';
import { ApproveModal, ChangeRoomModal, RoomOccupantsModal } from '../components/RoomModals.jsx';
import VerticalIdCard from '../components/VerticalIdCard.jsx';
import { fmtDate } from '../utils/dates.js';
import { occupantsOf } from '../utils/summary.js';
import { isComplete, missingDetails } from '../utils/details.js';
import { getToken } from '../utils/api.js';

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
  const { db, navigate, config, notify, isSuper, deleteTrainee } = useStore();
  const [details, setDetails] = useState(initialDetails || '');
  const [sheet, setSheet] = useState(false);
  const [cardTrainee, setCardTrainee] = useState(null);
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
        empty="No trainees found in database."
        rowClass={(i) => (isComplete(list[i], config.customFields) ? 'row-ok' : 'row-pending')}
        rows={list.map((t) => [
          <Avatar trainee={t} />,
          <a className="link" onClick={() => open(t.traineeId)}>{t.traineeId}</a>,
          t.name,
          isComplete(t, config.customFields) ? <Badge status="COMPLETE" /> : <span title={missingDetails(t, config.customFields).join(', ')}><Badge status="DETAILS PENDING" /></span>,
          t.hostelId || '—', t.hostel || '—', t.roomNo || '—', t.defaultShift,
          <Badge status={t.hostelStatus} />, <Badge status={t.qrStatus} />,
          <div className="row-actions">
            <button className="btn btn-ghost btn-xs" onClick={() => open(t.traineeId)}><Icon name="eye" size={14} /> View</button>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => setCardTrainee(t)}
              title="Download or Print Trainee ID Card"
            >
              <Icon name="idCard" size={14} /> ID Card
            </button>
            {isSuper && (
              <button
                className="btn btn-danger btn-xs"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (window.confirm(`Permanently delete trainee "${t.name}" (${t.traineeId})?\n\nThis will permanently delete the trainee record from MongoDB and free any allocated room/bed.\nThis action cannot be undone.`)) {
                    await deleteTrainee(t.traineeId);
                  }
                }}
                title="Permanently Delete Trainee Record (Super Admin)"
              >
                <Icon name="trash" size={13} />
              </button>
            )}
          </div>,
        ])}
      />
      <div className="table-foot">{list.length} of {db.trainees.length} trainees</div>
      {cardTrainee && <VerticalIdCard trainee={cardTrainee} onClose={() => setCardTrainee(null)} />}
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
            <button className="btn btn-primary btn-xs" onClick={() => navigate('review', { id: t.traineeId })}><Icon name="check" size={14} /> Review</button>
            <button className="btn btn-ghost btn-xs" onClick={() => navigate('trainee-profile', { id: t.traineeId })}><Icon name="eye" size={14} /> View</button>
            <button className="btn btn-ghost btn-xs" onClick={() => navigate('trainee-profile', { id: t.traineeId, sub: 'edit' })}><Icon name="edit" size={14} /> Edit</button>
          </div>,
        ])}
      />
      {approving && <ApproveModal trainee={approving} onClose={() => setApproving(null)} />}
    </Card>
  );
}

function Rooms() {
  const { db, route } = useStore();
  const [room, setRoom] = useState(null);   // {hostel, no}
  const [moving, setMoving] = useState(null); // trainee
  const [allocating, setAllocating] = useState(null); // trainee

  // Trainees who are approved but awaiting room assignment
  const unallocated = db.trainees.filter(
    (t) => (t.approvalStatus === 'APPROVED' || t.hostelStatus === 'APPROVED') && !t.roomNo
  );

  useEffect(() => {
    if (route.params.allocateId) {
      const target = db.trainees.find((t) => t.traineeId === route.params.allocateId);
      if (target && !target.roomNo && (target.approvalStatus === 'APPROVED' || target.hostelStatus === 'APPROVED')) {
        setAllocating(target);
      }
    }
  }, [route.params.allocateId, db.trainees]);

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
    <>
      {unallocated.length > 0 && (
        <Card
          title={`Approved Trainees Awaiting Room Allocation (${unallocated.length})`}
          sub="These trainees have passed review and are ready for hostel room assignment."
          noPad
          style={{ marginBottom: 16 }}
        >
          <Table
            headers={['Photo', 'Trainee ID', 'Name', 'Qualification', 'Shift', 'Approval', 'Action']}
            empty="All approved trainees have rooms allocated."
            rows={unallocated.map((t) => [
              <Avatar trainee={t} />,
              <strong>{t.traineeId}</strong>,
              t.name,
              t.qualification || '—',
              `${t.defaultShift} Shift`,
              <span className="chip chip-green">APPROVED</span>,
              <button
                className="btn btn-primary btn-xs"
                onClick={() => setAllocating(t)}
              >
                <Icon name="bed" size={13} /> Allocate Room
              </button>,
            ])}
          />
        </Card>
      )}

      <Card title="Configured Hostels & Room Occupancy" noPad>
        <Table
          headers={['Hostel', 'Room No.', 'Occupancy', 'Occupants', '']}
          empty="No rooms found. Add hostels and configure rooms in Admin Console."
          rows={rows}
        />
        {room && !moving && (
          <RoomOccupantsModal hostel={room.hostel} roomNo={room.no} onClose={() => setRoom(null)} onMove={(t) => setMoving(t)} />
        )}
        {moving && <ChangeRoomModal trainee={moving} onClose={() => { setMoving(null); setRoom(null); }} />}
        {allocating && <ApproveModal trainee={allocating} onClose={() => setAllocating(null)} />}
      </Card>
    </>
  );
}

export default function Trainees() {
  const { db, route, navigate, notify } = useStore();
  const [exporting, setExporting] = useState(false);
  const tab = route.params.tab || 'all';
  const pendingCount = db.trainees.filter((t) => t.hostelStatus === 'PENDING REVIEW').length;
  const tabs = [['all', 'All Trainees'], ['pending', 'Pending Review'], ['rooms', 'Room Management']];

  const handleDownloadAllTrainees = async () => {
    try {
      setExporting(true);
      const token = getToken();
      const BASE_URL = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${BASE_URL}/api/trainees/export?format=csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Export failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all-trainees-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      notify('Trainee records exported successfully.');
    } catch (err) {
      notify(err.message || 'Failed to export trainees');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            className="btn btn-ghost"
            onClick={handleDownloadAllTrainees}
            disabled={exporting}
            title="Download all genuine trainee records from MongoDB as CSV/Excel"
          >
            <Icon name="download" size={15} /> {exporting ? 'Exporting…' : 'Download All Trainees'}
          </button>
        </div>
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
