import { useEffect, useState } from 'react';
import { api } from '../utils/api.js';
import { Icon } from '../components/ui.jsx';
import { fmtDate } from '../utils/dates.js';

/**
 * Public Trainee Verification Page (#/verify/:traineeId).
 * Opened when an ID card QR code is scanned using a normal mobile camera or QR reader.
 * Does NOT mark attendance — displays permitted official identity details securely.
 */
export default function TraineeCardVerify({ traineeId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!traineeId) {
      setError('No Trainee ID specified in QR code.');
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await api(`/api/public/verify/${encodeURIComponent(traineeId)}`, { auth: false });
        setData(res);
      } catch (err) {
        setError(err.message || 'Invalid QR code or trainee not found.');
      } finally {
        setLoading(false);
      }
    })();
  }, [traineeId]);

  return (
    <div className="public-wrap" style={{ minHeight: '100vh', padding: '30px 16px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <div className="card" style={{ maxWidth: 440, width: '100%', padding: 0, overflow: 'hidden', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}>
        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', color: '#fff', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
          {data?.logo ? (
            <img src={data.logo} alt="" style={{ height: 42, maxWidth: 90, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: 3 }} />
          ) : (
            <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="home" size={22} />
            </div>
          )}
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 0.5 }}>{data?.appName || 'TRAINEE HOSTEL'}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>Official Trainee Verification</div>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
            <div className="empty-state">Verifying trainee credentials…</div>
          </div>
        ) : error ? (
          <div style={{ padding: 28, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <Icon name="x" size={26} />
            </div>
            <h3 style={{ color: '#ef4444', margin: '0 0 6px 0' }}>Verification Failed</h3>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{error}</p>
          </div>
        ) : (
          <div>
            {/* Status Banner */}
            <div style={{ background: data.trainee.verified ? 'rgba(22, 163, 74, 0.12)' : 'rgba(234, 88, 12, 0.12)', color: data.trainee.verified ? '#15803d' : '#c2410c', padding: '10px 16px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={16} />
              <span>{data.trainee.verified ? 'OFFICIAL VERIFIED TRAINEE IDENTIFIER' : `STATUS: ${data.trainee.hostelStatus}`}</span>
            </div>

            {/* Profile Info */}
            <div style={{ padding: '24px 22px 18px', textAlign: 'center' }}>
              <div style={{ width: 104, height: 104, borderRadius: '50%', border: '3px solid #e2e8f0', margin: '0 auto 12px', overflow: 'hidden', background: '#f8fafc', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.08)' }}>
                {data.trainee.photo ? (
                  <img src={data.trainee.photo} alt={data.trainee.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700, color: '#64748b' }}>
                    {data.trainee.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>

              <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#0f172a' }}>{data.trainee.name}</h2>
              <div style={{ display: 'inline-block', background: '#f1f5f9', color: '#1e293b', fontSize: 13, fontWeight: 700, padding: '3px 14px', borderRadius: 12, marginBottom: 18 }}>
                {data.trainee.traineeId}
              </div>

              {/* Details table */}
              <div style={{ borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0', padding: '12px 0', fontSize: 13, textAlign: 'left', lineHeight: 1.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Qualification:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{data.trainee.qualification}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Phone Number:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{data.trainee.mobile}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Hostel Block:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{data.trainee.hostel}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Room Allocation:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{data.trainee.roomNo ? `Room ${data.trainee.roomNo}` : 'Unallocated'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Joining Date:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{fmtDate(data.trainee.joiningDate)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: '#64748b' }}>Free-Stay Validity:</span>
                  <span style={{ fontWeight: 600, color: '#0f172a' }}>{fmtDate(data.trainee.freeStayExpiryDate) || '3 Months'}</span>
                </div>
              </div>

              <div style={{ marginTop: 16, fontSize: 11, color: '#64748b', lineHeight: 1.4, background: '#f8fafc', padding: '10px 12px', borderRadius: 8 }}>
                ℹ️ <strong>Security Note:</strong> This digital card confirms valid hostel trainee residency. Official shift attendance is recorded exclusively by authorized supervisors at the attendance terminal.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
