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

/** Allocate hostel & room to an approved trainee. */
export function ApproveModal({ trainee, onClose }) {
  const { approveTrainee, notify, navigate } = useStore();
  const [hostel, setHostel] = useState('');
  const [room, setRoom] = useState('');

  const isRejected = trainee.approvalStatus === 'REJECTED' || trainee.hostelStatus === 'REJECTED';
  const isPending = trainee.approvalStatus === 'PENDING_APPROVAL' || trainee.hostelStatus === 'PENDING REVIEW';

  return (
    <Modal
      title={isRejected ? 'Room Allocation Blocked' : 'Allocate Room & Bed'}
      onClose={onClose}
      submitLabel={isRejected || isPending ? undefined : 'Confirm Room Allocation'}
      onSubmit={() => {
        if (isRejected) {
          notify('Cannot allocate room: Trainee is rejected.');
          return;
        }
        if (isPending) {
          notify('Cannot allocate room: Trainee must be approved first.');
          return;
        }
        if (!hostel || !room) {
          notify('Please select both a hostel and room number.');
          return;
        }
        approveTrainee(trainee.traineeId, hostel, room);
        notify(`${trainee.name} successfully allocated to ${hostel}, Room ${room}.`);
        onClose();
        navigate('trainee-profile', { id: trainee.traineeId });
      }}
    >
      <div className="approve-trainee" style={{ marginBottom: 14 }}>
        <Avatar trainee={trainee} size="md" />
        <div>
          <div className="approve-name">{trainee.name}</div>
          <div className="approve-sub">{trainee.traineeId} · {trainee.qualification} · {trainee.defaultShift} Shift</div>
        </div>
      </div>

      {isRejected ? (
        <div className="alert-banner bad" style={{ margin: 0 }}>
          <Icon name="alert" size={18} />
          <div className="alert-text">
            <strong>Room allocation is not permitted:</strong> This trainee's registration was rejected.
          </div>
        </div>
      ) : isPending ? (
        <div className="alert-banner bad" style={{ margin: 0 }}>
          <Icon name="alert" size={18} />
          <div className="alert-text">
            <strong>Approval Required:</strong> This trainee is currently pending approval. Please review and approve their registration before assigning a room.
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              onClose();
              navigate('review', { id: trainee.traineeId });
            }}
          >
            Open Review
          </button>
        </div>
      ) : (
        <RoomPicker hostel={hostel} setHostel={setHostel} room={room} setRoom={setRoom} currentTraineeId={trainee.traineeId} />
      )}
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
