import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Card, Icon, Table } from '../components/ui.jsx';
import { PAGES } from '../data/defaults.js';

export default function Settings() {
  const { db, session, roleName, roles, logout, changePassword, notify, isSuper, navigate } = useStore();
  const [pw, setPw] = useState({ old: '', next: '' });
  const rows = db.hostels.map((h) => [h.name, h.rooms.length, h.rooms.reduce((s, r) => s + r.capacity, 0)]);
  const label = (id) => (PAGES.find((p) => p.id === id) || {}).label;

  return (
    <>
      <div className="grid-2">
        <Card title="Hostels" noPad>
          <Table headers={['Hostel', 'Rooms', 'Total Capacity']} rows={rows} />
          <div className="card-foot-note">
            {isSuper
              ? <>Add or change hostels and rooms in <a className="link" onClick={() => navigate('console')}>Admin Console → Hostels &amp; rooms</a>.</>
              : 'Hostel configuration is managed by the Super Admin.'}
          </div>
        </Card>
        <Card title="Account">
          <div className="info-grid">
            <div className="info-item"><div className="info-k">Name</div><div className="info-v">{session.name}</div></div>
            <div className="info-item"><div className="info-k">Username</div><div className="info-v">{session.username}</div></div>
            <div className="info-item"><div className="info-k">Role</div><div className="info-v">{roleName}</div></div>
          </div>
          <form className="pw-form" onSubmit={async (e) => {
            e.preventDefault();
            try { await changePassword(pw.old, pw.next); setPw({ old: '', next: '' }); notify('Password changed.'); } catch (err) { notify(err.message); }
          }}>
            <div className="field-label" style={{ marginTop: 16 }}>Change password</div>
            <input className="input" type="password" placeholder="Current password" value={pw.old} onChange={(e) => setPw({ ...pw, old: e.target.value })} required />
            <input className="input" type="password" placeholder="New password (min 4 characters)" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={4} required />
            <div className="qr-actions" style={{ justifyContent: 'flex-start' }}>
              <button className="btn btn-primary btn-sm" type="submit">Update password</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={logout}><Icon name="logout" size={15} /> Log out</button>
            </div>
          </form>
        </Card>
      </div>
      <Card title="Role Permissions">
        <div className="perm-grid">
          {roles.map((r) => (
            <div key={r.id}>
              <div className="perm-title">{r.name}</div>
              <ul className="perm-list">
                {(r.id === 'superadmin' ? ['Everything', 'Login members, roles, theme, pages, fields, hostels'] : r.pages.map(label)).map((x) => <li key={x}>{x}</li>)}
                {r.id !== 'superadmin' && !r.pages.includes('reports') && <li className="muted">No access to Reports</li>}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
