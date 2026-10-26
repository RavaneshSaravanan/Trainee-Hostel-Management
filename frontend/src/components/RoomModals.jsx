import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Avatar, Icon, Modal } from './ui.jsx';
import { occupantsOf } from '../utils/summary.js';

function RoomPicker({ hostel, setHostel, room, setRoom, currentTraineeId }) {
  const { db } = useStore();
  const h = db.hostels.find((x) => x.name === hostel);
  return (
    <>
      <label className="field-label">Hostel</label>
      <select className="input" value={hostel} required onChange={(e) => { setHostel(e.target.value); setRoom(''); }}>
        <option value="">Select hostel…</option>
        {db.hostels.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
      </select>
      <label className="field-label" style={{ marginTop: 12 }}>Room No.</label>
      <select className="input" value={room} required onChange={(e) => setRoom(e.target.value)}>
        <option value="">{h ? 'Select room…' : 'Select hostel first…'}</option>
        {h && h.rooms.map((r) => {
          const occ = occupantsOf(db, hostel, r.no).filter((t) => t.traineeId !== currentTraineeId).length;
          const full = occ >= r.capacity;
          return <option key={r.no} value={r.no} disabled={full}>{r.no} — {occ}/{r.capacity} occupied{full ? ' (full)' : ''}</option>;
        })}
      </select>
    </>
  );
}

/** Pending trainee -> choose hostel + room -> ACTIVE + QR generated. */
export function ApproveModal({ trainee, onClose }) {
  const { approveTrainee, notify, navigate } = useStore();
  const [hostel, setHostel] = useState('');
  const [room, setRoom] = useState('');
  return (
    <Modal
      title="Approve & Allocate Room"
      onClose={onClose}
      submitLabel="Approve & Allocate Room"
      onSubmit={() => {
        approveTrainee(trainee.traineeId, hostel, room);
        notify(`${trainee.name} approved and allocated to ${hostel}, Room ${room}. QR generated.`);
        onClose();
        navigate('trainee-profile', { id: trainee.traineeId });
      }}
    >
      <div className="approve-trainee">
        <Avatar trainee={trainee} size="md" />
        <div>
          <div className="approve-name">{trainee.name}</div>
          <div className="approve-sub">{trainee.traineeId} · {trainee.qualification} · {trainee.defaultShift} Shift</div>
        </div>
      </div>
      <RoomPicker hostel={hostel} setHostel={setHostel} room={room} setRoom={setRoom} />
    </Modal>
  );
}

/** Move an existing trainee; history is appended, never overwritten. */
export function ChangeRoomModal({ trainee, onClose }) {
  const { changeRoom, notify } = useStore();
  const [hostel, setHostel] = useState(trainee.hostel);
  const [room, setRoom] = useState(trainee.roomNo);
  return (
    <Modal
      title={`Change Room — ${trainee.name}`}
      onClose={onClose}
      submitLabel="Save Room Change"
      onSubmit={() => {
        if (hostel === trainee.hostel && room === trainee.roomNo) { onClose(); return; }
        changeRoom(trainee.traineeId, hostel, room);
        notify(`Room updated: ${hostel}, Room ${room}. Previous room kept in history.`);
        onClose();
      }}
    >
      <div className="two-col" style={{ marginBottom: 14 }}>
        <div><label className="field-label">Current Hostel</label><input className="input" value={trainee.hostel || '—'} disabled readOnly /></div>
        <div><label className="field-label">Current Room</label><input className="input" value={trainee.roomNo || '—'} disabled readOnly /></div>
      </div>
      <RoomPicker hostel={hostel} setHostel={setHostel} room={room} setRoom={setRoom} currentTraineeId={trainee.traineeId} />
    </Modal>
  );
}

/** Read-only list of a room's occupants, with a Move button each. */
export function RoomOccupantsModal({ hostel, roomNo, onClose, onMove }) {
  const { db, navigate } = useStore();
  const occupants = occupantsOf(db, hostel, roomNo);
  return (
    <Modal title={`${hostel} — Room ${roomNo}`} onClose={onClose}>
      <div className="field-label">Current occupants</div>
      {occupants.length ? occupants.map((o) => (
        <div className="occupant-row" key={o.traineeId}>
          <Avatar trainee={o} />
          <div className="occupant-name">
            <a className="link" onClick={() => { onClose(); navigate('trainee-profile', { id: o.traineeId }); }}>{o.name}</a>{' '}
            <span className="muted">({o.traineeId})</span>
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => onMove(o)}><Icon name="edit" size={13} /> Move</button>
        </div>
      )) : <div className="empty-cell">Room is currently vacant.</div>}
    </Modal>
  );
}
