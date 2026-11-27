import { useEffect, useState } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useStore } from '../store.jsx';
import { HOSTEL_STATUSES, QUALIFICATIONS } from '../data/constants.js';
import { Avatar, Badge, Card, Icon, Modal, Table } from '../components/ui.jsx';
import { ApproveModal, ChangeRoomModal, RoomOccupantsModal } from '../components/RoomModals.jsx';
import VerticalIdCard from '../components/VerticalIdCard.jsx';
import { fmtDate } from '../utils/dates.js';
import { occupantsOf } from '../utils/summary.js';
import { isComplete, missingDetails } from '../utils/details.js';
import { classifyTrainee } from '../utils/validity.js';
import { isValidAadhaar, isValidEmail } from '../utils/validators.js';
import { api, getToken, BASE_URL } from '../utils/api.js';

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
  const [stayCategory, setStayCategory] = useState('');

  const lc = q.toLowerCase();
  const list = db.trainees.filter((t) =>
    (!lc || [t.traineeId, t.hostelId, t.name, t.mobile, t.hostel, t.roomNo].some((v) => String(v || '').toLowerCase().includes(lc))) &&
    (!hostel || t.hostel === hostel) &&
    (!status || t.hostelStatus === status) &&
    (!details || (details === 'pending') === !isComplete(t, config.customFields)) &&
    (!stayCategory || (
      stayCategory === 'FREE' ? classifyTrainee(t).isFree :
      stayCategory === 'PAID' ? classifyTrainee(t).isPaid : true
    ))
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
        <select className="input" value={stayCategory} onChange={(e) => setStayCategory(e.target.value)}>
          <option value="">All Categories</option>
          <option value="FREE">Free Trainees</option>
          <option value="PAID">Paid Trainees</option>
        </select>
        <select className="input" value={details} onChange={(e) => setDetails(e.target.value)}>
          <option value="">All Details</option><option value="pending">Details pending (red)</option><option value="complete">Details complete (green)</option>
        </select>
        <button className="btn btn-ghost" onClick={() => setSheet(true)}><Icon name="qr" size={15} /> Print QR cards</button>
      </div>
      <Table
        headers={['Photo', 'Trainee ID', 'Name', 'Stay Status', 'Details', 'Hostel ID', 'Hostel', 'Room', 'Hostel Status', 'QR', '']}
        empty="No trainees found in database."
        rowClass={(i) => (isComplete(list[i], config.customFields) ? 'row-ok' : 'row-pending')}
        rows={list.map((t) => [
          <Avatar trainee={t} />,
          <a className="link" onClick={() => open(t.traineeId)}>{t.traineeId}</a>,
          t.name,
          <span title={classifyTrainee(t).label}><Badge status={classifyTrainee(t).status} /></span>,
          isComplete(t, config.customFields) ? <Badge status="COMPLETE" /> : <span title={missingDetails(t, config.customFields).join(', ')}><Badge status="DETAILS PENDING" /></span>,
          t.hostelId || '—', t.hostel || '—', t.roomNo || '—',
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
        headers={['Photo', 'Trainee ID', 'Name', 'Mobile', 'Joining Date', 'Submitted', 'Status', 'Actions']}
        empty="No pending trainee requests."
        rows={pending.map((t) => [
          <Avatar trainee={t} />, t.traineeId, t.name, t.mobile, fmtDate(t.joiningDate),
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
            headers={['Photo', 'Trainee ID', 'Name', 'Qualification', 'Approval', 'Action']}
            empty="All approved trainees have rooms allocated."
            rows={unallocated.map((t) => [
              <Avatar trainee={t} />,
              <strong>{t.traineeId}</strong>,
              t.name,
              t.qualification || '—',
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


/* ---------------- Warden Partial Trainee Completion View ---------------- */
function isIncompleteTraineeRecord(t) {
  if (!t) return false;
  if (['PERMANENT VACATE', 'RESIGNED', 'INACTIVE', 'REJECTED'].includes(t.hostelStatus)) return false;
  if (t.approvalStatus === 'REJECTED') return false;
  return (
    ['PARTIAL', 'INCOMPLETE', 'PENDING_DETAILS'].includes(t.completionStatus) ||
    (Array.isArray(t.missingFields) && t.missingFields.length > 0) ||
    !t.roomNo
  );
}

function CompleteTraineeModal({ trainee, hostels, onClose, onCompleted }) {
  const { db, notify, navigate } = useStore();
  const initialHostel = trainee.hostel || (hostels[0]?.name || '');
  const existingMaskedAadhaar = trainee.aadharMasked || (trainee.aadhar && (String(trainee.aadhar).includes('X') || String(trainee.aadhar).includes('•')) ? trainee.aadhar : '');
  const [f, setF] = useState({
    name: trainee.name || '',
    mobile: trainee.mobile ? String(trainee.mobile).replace(/\D/g, '') : '',
    email: trainee.email || '',
    dob: trainee.dob ? String(trainee.dob).slice(0, 10) : '',
    gender: (trainee.gender || 'MALE').toUpperCase(),
    joiningDate: trainee.joiningDate ? String(trainee.joiningDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    guardianName: trainee.guardianName || '',
    guardianContact: trainee.guardianContact ? String(trainee.guardianContact).replace(/\D/g, '') : '',
    aadhar: existingMaskedAadhaar ? '' : (trainee.aadhar ? String(trainee.aadhar).replace(/\D/g, '') : ''),
    qualification: trainee.qualification || QUALIFICATIONS[0] || '',
    food: (trainee.food || 'VEG').toUpperCase(),
    address1: trainee.address1 || '',
    state: trainee.state || '',
    hostel: initialHostel,
    roomNo: trainee.roomNo || '',
    sendWelcomeEmail: true,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedHostelObj = hostels.find((h) => h.name === f.hostel) || hostels[0];
  const availableRooms = selectedHostelObj?.rooms || [];
  const targetId = trainee.traineeId || trainee.qrId || trainee.hostelId || trainee._id;

  const set = (k) => (e) => {
    const val = e.target.value;
    setError('');
    if (k === 'hostel') {
      setF((prev) => ({ ...prev, hostel: val, roomNo: '' }));
    } else {
      setF((prev) => ({ ...prev, [k]: val }));
    }
  };

  const handleSubmit = async () => {
    if (loading) return;
    if (!targetId) {
      setError('Unable to identify trainee record.');
      return;
    }

    const cleanName = f.name.trim();
    const cleanMobile = f.mobile.replace(/\D/g, '');
    const cleanEmail = f.email.trim().toLowerCase();
    const cleanGuardianContact = f.guardianContact.replace(/\D/g, '');
    const cleanAadhaar = f.aadhar.replace(/\D/g, '');

    if (!cleanName || cleanName.length < 2) { setError('Trainee name is required (at least 2 characters).'); return; }
    if (!cleanMobile || !/^[6-9]\d{9}$/.test(cleanMobile)) {
      setError('A valid 10-digit mobile number starting with 6-9 is required.');
      return;
    }
    if (cleanEmail && !isValidEmail(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!f.dob) { setError('Date of birth is required.'); return; }
    if (!f.joiningDate) { setError('Joining date is required.'); return; }
    if (!f.qualification.trim()) { setError('Qualification / Trade is required.'); return; }
    if (!existingMaskedAadhaar) {
      if (!cleanAadhaar || cleanAadhaar.length !== 12 || !isValidAadhaar(cleanAadhaar, true)) {
        setError('A valid 12-digit Aadhaar number is required.');
        return;
      }
    } else if (cleanAadhaar) {
      if (cleanAadhaar.length !== 12 || !isValidAadhaar(cleanAadhaar, true)) {
        setError('Please enter a valid 12-digit Aadhaar number.');
        return;
      }
    }
    if (!f.address1.trim()) { setError('Address is required.'); return; }
    if (!f.state.trim()) { setError('State is required.'); return; }
    if (!f.guardianName.trim()) { setError('Guardian name is required.'); return; }
    if (!cleanGuardianContact || !/^\d{10}$/.test(cleanGuardianContact)) {
      setError('A valid 10-digit guardian contact number is required.');
      return;
    }
    if (!f.hostel) { setError('Please select a hostel.'); return; }
    if (!f.roomNo) { setError('Please allocate a hostel room to finalize.'); return; }

    setLoading(true);
    setError('');
    try {
      const payload = {
        ...f,
        name: cleanName,
        mobile: cleanMobile,
        email: cleanEmail,
        guardianName: f.guardianName.trim(),
        guardianContact: cleanGuardianContact,
        qualification: f.qualification.trim(),
        address1: f.address1.trim(),
        state: f.state.trim(),
      };
      if (cleanAadhaar) {
        payload.aadhar = cleanAadhaar;
      } else {
        delete payload.aadhar;
      }

      const res = await api(`/api/warden/complete-trainee/${encodeURIComponent(targetId)}`, {
        method: 'PUT',
        body: payload,
      });
      notify(res.message || '✓ Trainee details completed and finalized successfully.');
      if (onCompleted) {
        await onCompleted(res);
      }
      onClose();
      if (res.isFullyComplete && res.trainee) {
        const nextId = res.trainee.traineeId || res.trainee.qrId || targetId;
        navigate('trainee-profile', { id: nextId });
      }
    } catch (err) {
      const msg = err.message || 'Failed to complete trainee registration.';
      setError(msg);
      notify(msg);
    } finally {
      setLoading(false);
    }
  };

  const missing = Array.isArray(trainee.missingFields) ? trainee.missingFields : [];

  return (
    <Modal
      title={`Complete & Finalize Trainee — ${trainee.name}`}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={loading ? 'Finalizing…' : 'Finalize & Activate Trainee'}
      submitDisabled={loading}
    >
      {missing.length > 0 && (
        <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#92400e' }}>
          <strong>Pending Requirements:</strong> {missing.join(', ')}
        </div>
      )}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 13, color: '#991b1b' }}>
          {error}
        </div>
      )}

      <div className="two-col">
        <div>
          <label className="field-label">Trainee Name *</label>
          <input className="input" value={f.name} onChange={set('name')} required />
        </div>
        <div>
          <label className="field-label">Mobile Number (10 digits) *</label>
          <input className="input" type="tel" maxLength={10} value={f.mobile} onChange={set('mobile')} placeholder="e.g. 9876543210" required />
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Email ID (for ID card delivery)</label>
          <input className="input" type="email" value={f.email} onChange={set('email')} placeholder="trainee@gmail.com" />
        </div>
        <div>
          <label className="field-label">Date of Birth *</label>
          <input className="input" type="date" value={f.dob} max={new Date().toISOString().slice(0, 10)} onChange={set('dob')} required />
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Gender *</label>
          <select className="input" value={f.gender} onChange={set('gender')} required>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </select>
        </div>
        <div>
          <label className="field-label">Joining Date *</label>
          <input className="input" type="date" value={f.joiningDate} onChange={set('joiningDate')} required />
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Guardian Name *</label>
          <input className="input" value={f.guardianName} onChange={set('guardianName')} placeholder="Parent or Guardian" required />
        </div>
        <div>
          <label className="field-label">Guardian Contact (10 digits) *</label>
          <input className="input" type="tel" maxLength={10} value={f.guardianContact} onChange={set('guardianContact')} placeholder="e.g. 9876543210" required />
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">
            Aadhaar Number (12 digits) {existingMaskedAadhaar ? `(Saved: ${existingMaskedAadhaar})` : '*'}
          </label>
          <input
            className="input"
            maxLength={12}
            value={f.aadhar}
            onChange={set('aadhar')}
            placeholder={existingMaskedAadhaar ? 'Leave blank to keep existing' : '12-digit UID'}
          />
        </div>
        <div>
          <label className="field-label">Qualification / Trade *</label>
          <input className="input" value={f.qualification} onChange={set('qualification')} placeholder="e.g. ITI / Diploma" required />
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Food Preference *</label>
          <select className="input" value={f.food} onChange={set('food')} required>
            <option value="VEG">VEG</option>
            <option value="NON-VEG">NON-VEG</option>
          </select>
        </div>
        <div>
          <label className="field-label">State *</label>
          <input className="input" value={f.state} onChange={set('state')} placeholder="e.g. Tamil Nadu" required />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <label className="field-label">Address *</label>
        <input className="input" value={f.address1} onChange={set('address1')} placeholder="Street / Village / City" required />
      </div>

      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: 'var(--purple-900)' }}>
          🛏️ Hostel & Room Allocation
        </div>
        <div className="two-col">
          <div>
            <label className="field-label">Hostel *</label>
            <select className="input" value={f.hostel} onChange={set('hostel')} required>
              <option value="">-- Select Hostel --</option>
              {hostels.map((h) => <option key={h.name} value={h.name}>{h.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">Room Number *</label>
            <select className="input" value={f.roomNo} onChange={set('roomNo')} required>
              <option value="">-- Select Room --</option>
              {availableRooms.map((r) => {
                const occ = occupantsOf(db, f.hostel, r.no).filter((o) => o.traineeId !== trainee.traineeId).length;
                const cap = r.capacity || 1;
                const full = occ >= cap;
                return (
                  <option key={r.no} value={r.no} disabled={full}>
                    Room {r.no} ({occ}/{cap} occupied){full ? ' — FULL' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={f.sendWelcomeEmail}
            onChange={(e) => setF({ ...f, sendWelcomeEmail: e.target.checked })}
          />
          <span>Dispatch Welcome Email with printable ID Card PDF and QR code immediately</span>
        </label>
      </div>
    </Modal>
  );
}

function IncompleteDetails() {
  const { db, refreshState } = useStore();
  const [data, setData] = useState({ trainees: [], summary: {} });
  const [loading, setLoading] = useState(true);
  const [completingTrainee, setCompletingTrainee] = useState(null);

  const fetchIncomplete = async () => {
    setLoading(true);
    try {
      const res = await api('/api/warden/incomplete-trainees');
      const list = res.trainees || res.incompleteTrainees || [];
      const rawSummary = res.summary || res.metrics || {};
      setData({
        trainees: list,
        summary: {
          totalIncomplete: rawSummary.totalIncomplete ?? list.length,
          missingDetailsCount: rawSummary.missingDetailsCount ?? list.filter((t) => Array.isArray(t.missingFields) && t.missingFields.length > 0).length,
          pendingRoomCount: rawSummary.pendingRoomCount ?? rawSummary.pendingRoomAllocation ?? list.filter((t) => !t.roomNo).length,
          readyForFinalizationCount: rawSummary.readyForFinalizationCount ?? rawSummary.readyForFinalization ?? list.filter((t) => (!t.missingFields || t.missingFields.length === 0) && !t.roomNo).length,
        },
      });
    } catch (err) {
      // Fallback to local store filtering
      const list = db.trainees.filter(isIncompleteTraineeRecord);
      setData({
        trainees: list,
        summary: {
          totalIncomplete: list.length,
          missingDetailsCount: list.filter((t) => t.missingFields?.length > 0).length,
          pendingRoomCount: list.filter((t) => !t.roomNo).length,
          readyForFinalizationCount: list.filter((t) => (!t.missingFields || t.missingFields.length === 0) && !t.roomNo).length,
        },
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncomplete();
  }, [db.trainees]);

  const handleCompleted = async () => {
    if (refreshState) {
      await refreshState();
    }
    await fetchIncomplete();
  };

  const { summary = {}, trainees = [] } = data;

  return (
    <>
      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #ea580c' }}>
          <div className="kpi-label" style={{ color: '#ea580c' }}>Incomplete Trainees</div>
          <div className="kpi-value" style={{ color: '#ea580c' }}>{summary.totalIncomplete || trainees.length}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Awaiting warden completion</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #dc2626' }}>
          <div className="kpi-label" style={{ color: '#dc2626' }}>Missing Required Details</div>
          <div className="kpi-value" style={{ color: '#dc2626' }}>{summary.missingDetailsCount || 0}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Mobile, DOB, or Guardian</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #7c3aed' }}>
          <div className="kpi-label" style={{ color: '#7c3aed' }}>Pending Room Allocation</div>
          <div className="kpi-value" style={{ color: '#7c3aed' }}>{summary.pendingRoomCount || 0}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Unassigned bed capacity</div>
        </div>
        <div className="card kpi-card" style={{ borderLeft: '4px solid #16a34a' }}>
          <div className="kpi-label" style={{ color: '#16a34a' }}>Ready for Finalization</div>
          <div className="kpi-value" style={{ color: '#16a34a' }}>{summary.readyForFinalizationCount || 0}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Room assignment only</div>
        </div>
      </div>

      <Card
        title={`Incomplete Trainee Records (${trainees.length})`}
        sub="Trainees imported with partial records or awaiting warden room allocation. Finalizing will generate official ID cards and send welcome notifications."
        noPad
      >
        <Table
          headers={['Trainee ID', 'Name', 'Hostel', 'Missing Fields', 'Room Status', 'Action']}
          empty={loading ? 'Loading incomplete trainees…' : '✓ No incomplete trainee records pending for your assigned hostels.'}
          rows={trainees.map((t) => [
            <strong>{t.traineeId || t.qrId || '—'}</strong>,
            <div>
              <div style={{ fontWeight: 700 }}>{t.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t.mobile || 'No mobile'} · {t.email || 'No email'}</div>
            </div>,
            t.hostel || 'Unallocated',
            <div>
              {(t.missingFields || []).length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {t.missingFields.map((fld) => (
                    <span key={fld} className="chip chip-amber" style={{ fontSize: 11 }}>{fld}</span>
                  ))}
                </div>
              ) : (
                <span className="chip chip-green" style={{ fontSize: 11 }}>All Fields Present</span>
              )}
            </div>,
            t.roomNo ? (
              <span className="chip chip-blue">Room {t.roomNo}</span>
            ) : (
              <span className="chip chip-red">Pending Room</span>
            ),
            <button
              type="button"
              className="btn btn-primary btn-xs"
              onClick={() => setCompletingTrainee(t)}
            >
              <Icon name="check" size={13} /> Complete & Finalize
            </button>,
          ])}
        />
      </Card>

      {completingTrainee && (
        <CompleteTraineeModal
          trainee={completingTrainee}
          hostels={db.hostels}
          onClose={() => setCompletingTrainee(null)}
          onCompleted={handleCompleted}
        />
      )}
    </>
  );
}

export default function Trainees() {
  const { db, route, navigate, notify } = useStore();
  const [exporting, setExporting] = useState(false);
  const tab = route.params.tab || 'all';
  const pendingCount = db.trainees.filter((t) => t.hostelStatus === 'PENDING REVIEW').length;
  const incompleteCount = db.trainees.filter(isIncompleteTraineeRecord).length;
  const tabs = [
    ['all', 'All Trainees'],
    ['incomplete', 'Incomplete Details'],
    ['pending', 'Pending Review'],
    ['rooms', 'Room Management'],
  ];

  const handleDownloadAllTrainees = async () => {
    try {
      setExporting(true);
      const token = getToken();
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
            {label}
            {id === 'pending' && pendingCount > 0 && <span className="tab-count">{pendingCount}</span>}
            {id === 'incomplete' && incompleteCount > 0 && <span className="tab-count" style={{ background: 'var(--amber, #f59e0b)' }}>{incompleteCount}</span>}
          </button>
        ))}
      </div>
      {tab === 'incomplete' ? <IncompleteDetails /> : tab === 'pending' ? <Pending /> : tab === 'rooms' ? <Rooms /> : <Master key={`${route.params.q || ''}|${route.params.details || ''}`} initialQ={route.params.q} initialDetails={route.params.details} />}
    </>
  );
}
