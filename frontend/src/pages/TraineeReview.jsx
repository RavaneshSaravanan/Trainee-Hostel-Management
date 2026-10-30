import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import { Avatar, Badge, Card, Icon, Modal } from '../components/ui.jsx';
import { fmtDate } from '../utils/dates.js';
import VerticalIdCard from '../components/VerticalIdCard.jsx';

export default function TraineeReview({ traineeId: propTraineeId }) {
  const { route, navigate, session, notify } = useStore();
  const traineeId = (propTraineeId || route.params.id || '').toUpperCase().trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null); // { trainee, auditTrail, approvalPolicy }
  const [submitting, setSubmitting] = useState(false);
  const [approveModal, setApproveModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showIdCard, setShowIdCard] = useState(false);

  const loadData = async () => {
    if (!traineeId) {
      setError('No Trainee ID provided.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api(`/api/approval/review/${encodeURIComponent(traineeId)}`);
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load trainee review details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [traineeId]);

  const handleDecision = async (decision, reason = '') => {
    setSubmitting(true);
    try {
      const res = await api('/api/approval/decision', {
        method: 'POST',
        body: {
          traineeId,
          decision,
          rejectionReason: reason,
        },
      });
      if (res.trainee?.approvalStatus === 'APPROVED') {
        notify('Trainee approved! You can now proceed to Room Allocation.');
      } else {
        notify(res.message || `Decision recorded: ${decision}`);
      }
      setRejectModal(false);
      setRejectionReason('');
      await loadData();
    } catch (err) {
      notify(err.message || 'Error recording decision.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Card title="Trainee Review">
        <div className="empty-state">Loading trainee details for review…</div>
      </Card>
    );
  }

  if (error || !data || !data.trainee) {
    return (
      <Card title="Trainee Review">
        <div className="alert-banner bad" style={{ margin: 16 }}>
          <Icon name="alert" size={20} />
          <div className="alert-text">{error || 'Trainee not found or access denied.'}</div>
        </div>
        <div style={{ padding: 16 }}>
          <button className="btn btn-ghost" onClick={() => navigate('trainees', { tab: 'pending' })}>
            <Icon name="back" size={15} /> Back to Trainees
          </button>
        </div>
      </Card>
    );
  }

  const { trainee: t, auditTrail = [], approvalPolicy = 'ANY_ONE' } = data;
  const isPending = t.approvalStatus === 'PENDING_APPROVAL' || t.hostelStatus === 'PENDING REVIEW';
  const myExistingVote = (t.approvals || []).find((a) => a.approverId === session?.id);

  const policyLabels = {
    ANY_ONE: 'Any 1 Approver Suffices',
    MAJORITY: 'Majority Approvers Required',
    ALL: 'All Configured Approvers Required',
  };

  return (
    <>
      <div className="page-head no-print">
        <button className="btn btn-ghost" onClick={() => navigate('trainees', { tab: 'pending' })}>
          <Icon name="back" size={15} /> Back to Pending Trainees
        </button>
        <div className="chip">
          <strong>Approval Policy:</strong> {policyLabels[approvalPolicy] || approvalPolicy}
        </div>
      </div>

      <div className="profile-head card">
        <Avatar trainee={t} size="lg" />
        <div className="profile-head-info">
          <div className="profile-name-row">
            <div className="profile-name">{t.name}</div>
            <Badge status={t.approvalStatus || t.hostelStatus} />
          </div>
          <div className="profile-meta">
            <span>Trainee ID: <strong>{t.traineeId}</strong></span>
            <span className="dot">•</span>
            <span>Hostel ID: {t.hostelId || '—'}</span>
            <span className="dot">•</span>
            <span>Default Shift: {t.defaultShift}</span>
            <span className="dot">•</span>
            <span>Joining Date: {fmtDate(t.joiningDate)}</span>
          </div>
          <div className="profile-chips">
            <span className="chip">Aadhar: {t.aadhar || 'Not provided'}</span>
            <span className="chip">Gender: {t.gender}</span>
            <span className="chip">Food: {t.food}</span>
          </div>
        </div>

        <div className="profile-head-actions">
          {isPending && !myExistingVote && (
            <>
              <button
                className="btn btn-primary"
                disabled={submitting}
                onClick={() => setApproveModal(true)}
              >
                <Icon name="check" size={15} /> Approve Registration
              </button>
              <button
                className="btn btn-danger"
                disabled={submitting}
                onClick={() => setRejectModal(true)}
              >
                <Icon name="x" size={15} /> Reject Registration
              </button>
            </>
          )}

          {myExistingVote && isPending && (
            <div className="notice" style={{ margin: 0 }}>
              You have already recorded your vote (<strong>{myExistingVote.decision}</strong>). Awaiting other approvers.
            </div>
          )}

          {t.approvalStatus === 'APPROVED' && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="badge badge-green" style={{ padding: '8px 14px', fontSize: 13 }}>
                ✓ Trainee Approved
              </div>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowIdCard(true)}
                title="Download or Print ID Card"
              >
                <Icon name="idCard" size={14} /> ID Card
              </button>
              {!t.roomNo ? (
                <button
                  className="btn btn-primary"
                  onClick={() => navigate('trainees', { tab: 'rooms', allocateId: t.traineeId })}
                >
                  <Icon name="bed" size={15} /> Continue to Room Allocation →
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => navigate('trainee-profile', { id: t.traineeId })}
                >
                  <Icon name="eye" size={14} /> View Profile
                </button>
              )}
            </div>
          )}

          {t.approvalStatus === 'REJECTED' && (
            <div className="badge badge-red" style={{ padding: '8px 14px', fontSize: 13 }}>
              ✕ Trainee Rejected
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <Card title="Submitted Registration Details">
          <div className="info-grid">
            <div className="info-item"><div className="info-k">Full Name</div><div className="info-v">{t.name}</div></div>
            <div className="info-item"><div className="info-k">Trainee ID</div><div className="info-v">{t.traineeId}</div></div>
            <div className="info-item"><div className="info-k">Mobile Number</div><div className="info-v">{t.mobile || '—'}</div></div>
            <div className="info-item"><div className="info-k">Email Address</div><div className="info-v">{t.email || '—'}</div></div>
            <div className="info-item"><div className="info-k">Date of Birth</div><div className="info-v">{fmtDate(t.dob)}</div></div>
            <div className="info-item"><div className="info-k">Gender</div><div className="info-v">{t.gender}</div></div>
            <div className="info-item"><div className="info-k">Qualification</div><div className="info-v">{t.qualification || '—'}</div></div>
            <div className="info-item"><div className="info-k">Aadhar Number</div><div className="info-v">{t.aadhar || '—'}</div></div>
            <div className="info-item"><div className="info-k">Food Preference</div><div className="info-v">{t.food}</div></div>
            <div className="info-item"><div className="info-k">Joining Date</div><div className="info-v">{fmtDate(t.joiningDate)}</div></div>
            <div className="info-item"><div className="info-k">Free Stay Expiry</div><div className="info-v">{fmtDate(t.freeStayExpiryDate) || '3 Months from joining'}</div></div>
            <div className="info-item"><div className="info-k">Default Shift</div><div className="info-v">{t.defaultShift}</div></div>
            <div className="info-item"><div className="info-k">Guardian Name</div><div className="info-v">{t.guardianName || '—'}</div></div>
            <div className="info-item"><div className="info-k">Guardian Contact</div><div className="info-v">{t.guardianContact || '—'}</div></div>
            <div className="info-item span-2"><div className="info-k">Address</div><div className="info-v">{[t.address1, t.state].filter(Boolean).join(', ') || '—'}</div></div>
          </div>
        </Card>

        <Card title="Approval Votes & Audit Trail" noPad>
          {auditTrail.length === 0 ? (
            <div className="empty-state">No approval audit history logged yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Role</th>
                    <th>Date & Time</th>
                    <th>Notes / Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {auditTrail.map((log) => (
                    <tr key={log._id || log.id}>
                      <td>
                        <span
                          className={`chip ${
                            log.action === 'APPROVED' ? 'chip-green' : log.action === 'REJECTED' ? 'chip-red' : ''
                          }`}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td><strong>{log.actorName}</strong></td>
                      <td>{log.actorRole}</td>
                      <td>{new Date(log.createdAt).toLocaleString('en-IN')}</td>
                      <td>{log.reason || log.metadata?.policy || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {approveModal && (
        <Modal
          title={`Confirm Official Approval · ${t.name}`}
          onClose={() => setApproveModal(false)}
          onSubmit={() => {
            setApproveModal(false);
            handleDecision('APPROVE');
          }}
          submitLabel="Authorize & Approve Trainee"
        >
          <div style={{ padding: '6px 0' }}>
            <p style={{ margin: '0 0 14px 0', fontSize: 14 }}>
              Are you sure you want to officially approve the registration for <strong>{t.name}</strong> (Trainee ID: <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{t.traineeId}</span>)?
            </p>
            <div style={{ background: '#f5f3ff', borderLeft: '4px solid #7c3aed', padding: '12px 16px', borderRadius: 6, fontSize: 13, marginBottom: 14 }}>
              <div style={{ marginBottom: 4 }}>• <strong>Qualification:</strong> {t.qualification || 'Trainee'}</div>
              <div style={{ marginBottom: 4 }}>• <strong>Assigned Shift:</strong> {t.defaultShift || 'G'} Shift</div>
              <div style={{ marginBottom: 4 }}>• <strong>Joining Date:</strong> {fmtDate(t.joiningDate)}</div>
              <div>• <strong>Hostel Status:</strong> Will become eligible for Room Allocation</div>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              Note: This action records your official decision in the permanent audit trail.
            </p>
          </div>
        </Modal>
      )}

      {rejectModal && (
        <Modal
          title={`Reject Registration: ${t.name} (${t.traineeId})`}
          onClose={() => setRejectModal(false)}
          onSubmit={() => {
            if (!rejectionReason.trim()) {
              notify('Rejection reason is required.');
              return;
            }
            handleDecision('REJECT', rejectionReason.trim());
          }}
        >
          <p className="muted" style={{ marginBottom: 12 }}>
            Please state the specific reason for rejecting this trainee registration. This will be recorded in the permanent audit trail and sent to administrators.
          </p>
          <label className="field-label">Rejection Reason *</label>
          <textarea
            className="input"
            rows={4}
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="e.g. Incomplete address verification, mismatch in documents, duplicate submission..."
            required
            autoFocus
          />
        </Modal>
      )}

      {showIdCard && <VerticalIdCard trainee={t} onClose={() => setShowIdCard(false)} />}
    </>
  );
}
