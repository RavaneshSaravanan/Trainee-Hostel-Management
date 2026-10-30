import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import {
  ASSIGNABLE_PAGES,
  DEFAULT_CONFIG,
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_IDCARD_TEMPLATE,
  DEFAULT_ORG_BRANDING,
  FONTS,
  PAGES,
  SUPER_ROLE,
  THEME_PRESETS,
  WIDGET_LABELS,
} from '../data/defaults.js';
import { Badge, Card, Icon, Modal, Table } from '../components/ui.jsx';
import { resizeBackground, resizeImage } from '../utils/image.js';
import VerticalIdCard from '../components/VerticalIdCard.jsx';

// ADMIN CONSOLE (Super Admin only): login members, roles, look & feel, pages, form fields, hostels.
// Everything here is saved to the server automatically — no code changes needed.

const Switch = ({ checked, onChange, label }) => (
  <label className="switch-row"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>
);

/* ---------------- Users ---------------- */
function UserModal({ user, onClose }) {
  const { roles, saveUser, notify } = useStore();
  const [f, setF] = useState(
    user || { name: '', username: '', email: '', mobile: '', roleId: 'warden', active: true }
  );
  const [pw, setPw] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const handleSave = async () => {
    try {
      await saveUser(f, pw);
      notify('Saved.');
      onClose();
    } catch (e) {
      notify(e.message);
    }
  };

  return (
    <Modal title={user ? 'Edit login member' : 'Add login member'} onClose={onClose} onSubmit={handleSave}>
      <label className="field-label">Full name</label>
      <input className="input" value={f.name} onChange={set('name')} required />

      <label className="field-label" style={{ marginTop: 12 }}>Username (for login)</label>
      <input className="input" value={f.username} onChange={set('username')} autoCapitalize="none" required />

      <div className="two-col" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Email ID (optional)</label>
          <input className="input" type="email" placeholder="e.g. user@example.com" value={f.email || ''} onChange={set('email')} />
        </div>
        <div>
          <label className="field-label">Mobile Number (optional)</label>
          <input className="input" type="tel" placeholder="e.g. 9876543210" value={f.mobile || ''} onChange={set('mobile')} />
        </div>
      </div>

      <label className="field-label" style={{ marginTop: 12 }}>{user ? 'New password (leave blank to keep)' : 'Password'}</label>
      <input className="input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} required={!user} minLength={pw ? 4 : undefined} autoComplete="off" />

      <label className="field-label" style={{ marginTop: 12 }}>Role</label>
      <select className="input" value={f.roleId} onChange={set('roleId')}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>

      <div style={{ marginTop: 12 }}><Switch checked={f.active !== false} onChange={(v) => setF({ ...f, active: v })} label="Active (can log in)" /></div>
    </Modal>
  );
}

function Users() {
  const { users, roles, session, deleteUser, notify } = useStore();
  const [edit, setEdit] = useState(null); // null | 'new' | user
  const roleName = (id) => (roles.find((r) => r.id === id) || {}).name || id;
  return (
    <Card title="Login members" sub="Add people who can sign in, and choose their role." noPad
      action={<button className="btn btn-primary btn-sm" onClick={() => setEdit('new')}><Icon name="plus" size={14} /> Add member</button>}>
      <Table headers={['Name', 'Username', 'Email / Mobile', 'Role', 'Status', '']}
        rows={users.map((u) => [
          u.name,
          u.username,
          <div>
            <div style={{ fontSize: 13 }}>{u.email || '—'}</div>
            {u.mobile && <div className="muted" style={{ fontSize: 12 }}>{u.mobile}</div>}
          </div>,
          roleName(u.roleId),
          <Badge status={u.active ? 'ACTIVE' : 'INACTIVE'} />,
          <div className="row-actions">
            <button className="btn btn-ghost btn-xs" onClick={() => setEdit(u)}><Icon name="edit" size={13} /> Edit</button>
            {u.id !== session.id && <button className="btn btn-danger btn-xs" onClick={async () => {
              if (window.confirm(`Delete login for ${u.name}?`)) { try { await deleteUser(u); notify('Deleted.'); } catch (e) { notify(e.message); } }
            }}><Icon name="trash" size={13} /></button>}
          </div>,
        ])} />
      {edit && <UserModal user={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

/* ---------------- Roles ---------------- */
function Roles() {
  const { roles, setRoles, users, notify } = useStore();
  const [name, setName] = useState('');
  const upd = (id, patch) => setRoles((p) => p.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const label = (id) => PAGES.find((p) => p.id === id).label;
  const toggle = (r, pid, on) => upd(r.id, { pages: on ? [...r.pages, pid] : r.pages.filter((x) => x !== pid) });
  return (
    <>
      <Card title="Add a new role" sub="Then tick the pages that role can open.">
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setRoles((p) => [...p, { id: `r${Date.now().toString(36)}`, name: name.trim(), pages: ['dashboard', 'trainees', 'attendance'] }]);
          setName(''); notify('Role added — now tick its pages.');
        }}>
          <input className="input" placeholder="e.g. Supervisor, Accountant…" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" type="submit"><Icon name="plus" size={14} /> Add role</button>
        </form>
      </Card>
      {roles.map((r) => {
        const locked = r.id === SUPER_ROLE;
        const inUse = users.some((u) => u.roleId === r.id);
        return (
          <Card key={r.id} title={<>{r.name} {locked && <span className="chip">All access · locked</span>}</>}
            action={!r.system && <button className="btn btn-danger btn-xs" onClick={() => {
              if (inUse) { notify('Move this role\'s members to another role first.'); return; }
              setRoles((p) => p.filter((x) => x.id !== r.id));
            }}><Icon name="trash" size={13} /> Delete</button>}>
            {!locked && <input className="input" style={{ maxWidth: 280, marginBottom: 12 }} value={r.name} onChange={(e) => upd(r.id, { name: e.target.value })} />}
            <div className="perm-checks">
              {ASSIGNABLE_PAGES.map((pid) => (
                <label className="switch-row" key={pid}>
                  <input type="checkbox" disabled={locked} checked={locked || r.pages.includes(pid)} onChange={(e) => toggle(r, pid, e.target.checked)} />
                  <span>{label(pid)}</span>
                </label>
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}

/* ---------------- Approval Authorities (Super Admin Only) ---------------- */
function Approvers() {
  const { users, roles, notify } = useStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [policy, setPolicy] = useState('ANY_ONE');
  const [savedConfig, setSavedConfig] = useState(null);

  const activeUsers = users.filter((u) => u.active !== false);
  const roleName = (id) => (roles.find((r) => r.id === id) || {}).name || id;

  useEffect(() => {
    (async () => {
      try {
        const res = await api('/api/approval/config');
        if (res.approvalConfig) {
          setSavedConfig(res.approvalConfig);
          setSelectedIds((res.approvalConfig.approvers || []).map((a) => a.userId));
          setPolicy(res.approvalConfig.policy || 'ANY_ONE');
        }
      } catch (err) {
        notify(err.message || 'Failed to load approval settings.');
      } finally {
        setLoading(false);
      }
    })();
  }, [notify]);

  const toggleUser = (userId) => {
    if (selectedIds.includes(userId)) {
      setSelectedIds(selectedIds.filter((id) => id !== userId));
    } else {
      if (selectedIds.length >= 3) {
        notify('Maximum 3 approvers can be selected.');
        return;
      }
      setSelectedIds([...selectedIds, userId]);
    }
  };

  const handleSave = async () => {
    if (selectedIds.length < 2 || selectedIds.length > 3) {
      notify('Please select exactly 2 or 3 active members as approval authorities.');
      return;
    }
    setSaving(true);
    try {
      const res = await api('/api/approval/config', {
        method: 'POST',
        body: {
          approverIds: selectedIds,
          policy,
        },
      });
      setSavedConfig(res.approvalConfig);
      notify('Approval authorities and policy saved successfully.');
    } catch (err) {
      notify(err.message || 'Failed to save approver configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card title="Approval Authorities">
        <div className="empty-state">Loading approval configuration…</div>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Trainee Registration Approval Authorities"
        sub="Configure exactly 2 or 3 active members authorized to review, approve, or reject new trainee registrations."
      >
        <div className="alert-banner info" style={{ marginBottom: 16 }}>
          <Icon name="check" size={18} />
          <div className="alert-text">
            <strong>Requirements:</strong> Exactly 2 or 3 active user accounts must be designated. Approvers will receive email alerts with direct review links for newly registered trainees.
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="field-label" style={{ fontWeight: 600 }}>Approval Decision Policy</label>
          <select className="input" style={{ maxWidth: 360 }} value={policy} onChange={(e) => setPolicy(e.target.value)}>
            <option value="ANY_ONE">Any 1 Approver (First approval activates trainee)</option>
            <option value="MAJORITY">Majority Approvers (e.g. 2 of 2, or 2 of 3)</option>
            <option value="ALL">All Approvers (Unanimous approval required)</option>
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label className="field-label" style={{ fontWeight: 600 }}>
            Select Eligible Active Members ({selectedIds.length} of 2-3 selected)
          </label>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>Select</th>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((u) => {
                  const checked = selectedIds.includes(u.id);
                  return (
                    <tr
                      key={u.id}
                      style={{ cursor: 'pointer', background: checked ? 'var(--card-hover, rgba(59,130,246,0.06))' : undefined }}
                      onClick={() => toggleUser(u.id)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td><strong>{u.name}</strong></td>
                      <td>{u.username}</td>
                      <td>{u.email || <span className="muted">No email set</span>}</td>
                      <td>{roleName(u.roleId)}</td>
                      <td><Badge status="ACTIVE" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {selectedIds.length < 2 && (
          <div className="notice" style={{ color: 'var(--red, #ef4444)' }}>
            ⚠️ Please select at least 2 active approvers (currently {selectedIds.length} selected).
          </div>
        )}

        <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || selectedIds.length < 2 || selectedIds.length > 3}
          >
            <Icon name="check" size={15} /> {saving ? 'Saving…' : 'Save Approval Configuration'}
          </button>
          {savedConfig?.configuredAt && (
            <span className="muted" style={{ fontSize: 13 }}>
              Last updated by {savedConfig.configuredBy} on {new Date(savedConfig.configuredAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </Card>

      <Card
        title="Google Drive Photo Storage & Migration"
        sub="Connect Google Drive to store trainee photographs as external drive references instead of binary database strings."
      >
        <div style={{ fontSize: 13, color: 'var(--gray-600)', marginBottom: 14, lineHeight: 1.5 }}>
          When <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> and <code>GOOGLE_DRIVE_FOLDER_ID</code> are configured in <code>backend/.env</code>, newly submitted or edited trainee photos are stored in Google Drive. Photographs are delivered securely through authorized backend streaming with full CORS support.
        </div>
        <GoogleDriveMigrateBtn />
      </Card>
    </>
  );
}

function GoogleDriveMigrateBtn() {
  const { notify } = useStore();
  const [migrating, setMigrating] = useState(false);
  const [result, setResult] = useState(null);

  const handleMigrate = async () => {
    try {
      setMigrating(true);
      setResult(null);
      const res = await api('/api/approval/migrate-photos', { method: 'POST' });
      setResult(res);
      notify(res.message || `Migration finished: ${res.migrated || 0} photos uploaded to Google Drive.`);
    } catch (err) {
      notify(err.message || 'Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <button
        className="btn btn-ghost"
        onClick={handleMigrate}
        disabled={migrating}
        title="Upload any existing base64 photos in database to Google Drive"
      >
        <Icon name="download" size={14} /> {migrating ? 'Uploading to Drive…' : 'Migrate Existing Photos to Google Drive'}
      </button>
      {result && (
        <span style={{ fontSize: 13, color: result.ok ? 'var(--green)' : 'var(--red)' }}>
          {result.ok
            ? `✓ Completed: Migrated ${result.migrated} of ${result.total} records to Google Drive.`
            : `⚠️ ${result.message}`}
        </span>
      )}
    </div>
  );
}

/* ---------------- Appearance ---------------- */
function Appearance() {
  const { config, setConfig, notify } = useStore();
  const t = config.theme;
  const theme = (patch) => setConfig((c) => ({ ...c, theme: { ...c.theme, ...patch } }));
  const top = (patch) => setConfig((c) => ({ ...c, ...patch }));
  const pickBg = async (e) => { const f = e.target.files[0]; if (f) theme({ bgMode: 'image', bgImage: await resizeBackground(f) }); e.target.value = ''; };
  const pickLogo = async (e) => { const f = e.target.files[0]; if (f) top({ logo: await resizeImage(f, 160) }); e.target.value = ''; };
  return (
    <>
      <Card title="Name & logo">
        <div className="form-grid">
          <div><label className="field-label">App name</label><input className="input" value={config.appName} onChange={(e) => top({ appName: e.target.value })} /></div>
          <div><label className="field-label">Sub title</label><input className="input" value={config.appSub} onChange={(e) => top({ appSub: e.target.value })} /></div>
          <div><label className="field-label">Logo</label><input className="input" type="file" accept="image/*" onChange={pickLogo} /></div>
          <div style={{ alignSelf: 'end' }}>
            {config.logo ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img src={config.logo} alt="Logo Preview" style={{ height: 42, maxWidth: 140, objectFit: 'contain', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: 4 }} />
                <button className="btn btn-ghost btn-sm" onClick={() => top({ logo: '' })}>Remove logo</button>
              </div>
            ) : <span className="muted">No logo uploaded</span>}
          </div>
        </div>
      </Card>
      <Card title="Theme colours">
        <div className="preset-row">
          {Object.entries(THEME_PRESETS).map(([n, v]) => (
            <button key={n} className="preset" onClick={() => theme(v)} title={n}>
              <span style={{ background: v.primary }} /><span style={{ background: v.sidebar }} />{n}
            </button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div><label className="field-label">Main colour (buttons, highlights)</label><input className="input color-input" type="color" value={t.primary} onChange={(e) => theme({ primary: e.target.value })} /></div>
          <div><label className="field-label">Sidebar colour</label><input className="input color-input" type="color" value={t.sidebar} onChange={(e) => theme({ sidebar: e.target.value })} /></div>
          <div><label className="field-label">Font</label><select className="input" value={t.font} onChange={(e) => theme({ font: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></div>
          <div><label className="field-label">Corner roundness: {t.radius}px</label><input type="range" min="0" max="24" value={t.radius} onChange={(e) => theme({ radius: Number(e.target.value) })} style={{ width: '100%' }} /></div>
        </div>
      </Card>
      <Card title="Page background">
        <div className="seg">
          {[['color', 'Colour'], ['gradient', 'Gradient'], ['image', 'Image']].map(([v, l]) => (
            <button key={v} className={`seg-btn ${t.bgMode === v ? 'on' : ''}`} onClick={() => theme({ bgMode: v })}>{l}</button>
          ))}
        </div>
        <div className="form-grid" style={{ marginTop: 14 }}>
          <div><label className="field-label">{t.bgMode === 'gradient' ? 'Gradient start' : 'Background colour'}</label><input className="input color-input" type="color" value={t.bgColor} onChange={(e) => theme({ bgColor: e.target.value })} /></div>
          {t.bgMode === 'gradient' && <>
            <div><label className="field-label">Gradient end</label><input className="input color-input" type="color" value={t.bgColor2} onChange={(e) => theme({ bgColor2: e.target.value })} /></div>
            <div><label className="field-label">Angle: {t.bgAngle}°</label><input type="range" min="0" max="360" value={t.bgAngle} onChange={(e) => theme({ bgAngle: Number(e.target.value) })} style={{ width: '100%' }} /></div>
          </>}
          {t.bgMode === 'image' && (
            <div><label className="field-label">Background image</label><input className="input" type="file" accept="image/*" onChange={pickBg} />
              {t.bgImage && <button className="btn btn-ghost btn-xs" style={{ marginTop: 8 }} onClick={() => theme({ bgImage: '', bgMode: 'color' })}>Remove image</button>}
            </div>
          )}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 16 }} onClick={() => { setConfig((c) => ({ ...c, theme: DEFAULT_CONFIG.theme })); notify('Theme reset.'); }}>Reset theme to default</button>
      </Card>
    </>
  );
}

/* ---------------- Pages, dashboard & form fields ---------------- */
function PagesAndFields() {
  const { config, setConfig, notify } = useStore();
  const [cf, setCf] = useState({ label: '', type: 'text', options: '', required: false });
  const ordered = PAGES.map((p, i) => ({ ...p, ...(config.pages[p.id] || {}), order: (config.pages[p.id] || {}).order ?? i })).sort((a, b) => a.order - b.order);
  const setPage = (id, patch) => setConfig((c) => ({ ...c, pages: { ...c.pages, [id]: { ...(c.pages[id] || {}), ...patch } } }));
  const move = (idx, dir) => {
    const list = ordered.map((p) => p.id);
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    setConfig((c) => { const pages = { ...c.pages }; list.forEach((id, i) => { pages[id] = { ...(pages[id] || {}), order: i }; }); return { ...c, pages }; });
  };
  return (
    <>
      <Card title="Sidebar pages" sub="Rename, hide or re-order pages. (Who can open a page is set in Roles.)" noPad>
        <div className="page-rows">
          {ordered.map((p, i) => (
            <div className="page-row" key={p.id}>
              <Icon name={p.icon} size={16} />
              <input className="input" value={config.pages[p.id]?.label ?? p.label} onChange={(e) => setPage(p.id, { label: e.target.value })} />
              <Switch checked={config.pages[p.id]?.visible !== false} onChange={(v) => setPage(p.id, { visible: v })} label="Show" />
              <button className="icon-btn" onClick={() => move(i, -1)}><Icon name="up" size={16} /></button>
              <button className="icon-btn" onClick={() => move(i, 1)}><Icon name="down" size={16} /></button>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Dashboard sections" sub="Choose what shows on the home page.">
        <div className="perm-checks">
          {Object.entries(WIDGET_LABELS).map(([k, l]) => (
            <Switch key={k} checked={config.widgets[k] !== false} onChange={(v) => setConfig((c) => ({ ...c, widgets: { ...c.widgets, [k]: v } }))} label={l} />
          ))}
        </div>
      </Card>
      <Card title="Trainee registration">
        <Switch checked={config.registrationOpen} onChange={(v) => setConfig((c) => ({ ...c, registrationOpen: v }))} label="Self-registration by QR is open" />
      </Card>
      <Card title="Extra trainee fields" sub="Add your own fields to the registration / edit forms. Required fields also count towards 'details complete' (green).">
        {config.customFields.length > 0 && (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>Label</th><th>Type</th><th>Required</th><th /></tr></thead><tbody>
            {config.customFields.map((f) => (
              <tr key={f.id}><td>{f.label}</td><td>{f.type}{f.type === 'select' ? ` (${f.options})` : ''}</td><td>{f.required ? 'Yes' : 'No'}</td>
                <td><button className="btn btn-danger btn-xs" onClick={() => setConfig((c) => ({ ...c, customFields: c.customFields.filter((x) => x.id !== f.id) }))}><Icon name="trash" size={13} /></button></td></tr>
            ))}
          </tbody></table></div>
        )}
        <form className="inline-form" style={{ marginTop: 12 }} onSubmit={(e) => {
          e.preventDefault();
          if (!cf.label.trim()) return;
          setConfig((c) => ({ ...c, customFields: [...c.customFields, { ...cf, label: cf.label.trim(), id: `f${Date.now().toString(36)}` }] }));
          setCf({ label: '', type: 'text', options: '', required: false }); notify('Field added.');
        }}>
          <input className="input" placeholder="Field label (e.g. Blood group)" value={cf.label} onChange={(e) => setCf({ ...cf, label: e.target.value })} />
          <select className="input" value={cf.type} onChange={(e) => setCf({ ...cf, type: e.target.value })}>
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Dropdown</option>
          </select>
          {cf.type === 'select' && <input className="input" placeholder="Options, comma separated" value={cf.options} onChange={(e) => setCf({ ...cf, options: e.target.value })} />}
          <Switch checked={cf.required} onChange={(v) => setCf({ ...cf, required: v })} label="Required" />
          <button className="btn btn-primary" type="submit"><Icon name="plus" size={14} /> Add field</button>
        </form>
      </Card>
    </>
  );
}

/* ---------------- Hostels & rooms ---------------- */
function Hostels() {
  const { db, addHostel, addRoom, setRoomCapacity, notify } = useStore();
  const [name, setName] = useState('');
  const [room, setRoom] = useState({});
  return (
    <>
      <Card title="Add hostel">
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { addHostel(name.trim()); setName(''); notify('Hostel added.'); } }}>
          <input className="input" placeholder="Hostel name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn btn-primary" type="submit"><Icon name="plus" size={14} /> Add hostel</button>
        </form>
      </Card>
      {db.hostels.length === 0 ? (
        <Card title="Configured Hostels">
          <div className="empty-state">No hostels added yet. Use the &ldquo;Add hostel&rdquo; form above to add your first hostel.</div>
        </Card>
      ) : (
        db.hostels.map((h) => (
          <Card key={h.id} title={h.name} sub={`${h.rooms.length} rooms · capacity ${h.rooms.reduce((s, r) => s + r.capacity, 0)}`}>
            <div className="room-chips">
              {h.rooms.map((r) => (
                <label className="room-chip" key={r.no}>Room {r.no}
                  <input type="number" min="1" value={r.capacity} onChange={(e) => setRoomCapacity(h.id, r.no, e.target.value)} />
                </label>
              ))}
            </div>
            <form className="inline-form" style={{ marginTop: 12 }} onSubmit={(e) => {
              e.preventDefault();
              const r = room[h.id] || {};
              if (!r.no) return;
              if (h.rooms.some((x) => x.no === r.no)) { notify('Room number already exists.'); return; }
              addRoom(h.id, r.no.trim(), r.cap || 4); setRoom({ ...room, [h.id]: {} });
            }}>
              <input className="input" placeholder="Room no." value={(room[h.id] || {}).no || ''} onChange={(e) => setRoom({ ...room, [h.id]: { ...room[h.id], no: e.target.value } })} />
              <input className="input" type="number" min="1" placeholder="Capacity (4)" value={(room[h.id] || {}).cap || ''} onChange={(e) => setRoom({ ...room, [h.id]: { ...room[h.id], cap: e.target.value } })} />
              <button className="btn btn-ghost" type="submit"><Icon name="plus" size={14} /> Add room</button>
            </form>
          </Card>
        ))
      )}
    </>
  );
}

/* ---------------- Organization Branding ---------------- */
function OrganizationBranding() {
  const { config, setConfig, notify } = useStore();
  const current = config.orgBranding || DEFAULT_ORG_BRANDING;
  const [form, setForm] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(config.orgBranding || DEFAULT_ORG_BRANDING);
  }, [config.orgBranding]);

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, 400);
      setForm((p) => ({ ...p, logo: dataUrl }));
      notify('Logo loaded. Click "Save Branding Settings" to publish.');
    } catch (err) {
      notify('Failed to process image: ' + err.message);
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await api('/api/admin/branding', { method: 'PUT', body: form });
      setConfig((p) => ({
        ...p,
        orgBranding: res.orgBranding,
        appName: res.orgBranding.orgName || p.appName,
        logo: res.orgBranding.logo || p.logo,
      }));
      notify('✓ Organization Branding updated successfully.');
    } catch (err) {
      notify('Error saving branding: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset Organization Branding to default Apollo Tyres Ltd settings?')) {
      setForm(DEFAULT_ORG_BRANDING);
    }
  };

  return (
    <div className="grid-2">
      <Card title="Organization Branding Settings" sub="Configure official corporate identity, logo, and brand name.">
        <form onSubmit={handleSave}>
          <label className="field-label">Organization Name *</label>
          <input
            className="input"
            value={form.orgName}
            onChange={(e) => setForm({ ...form, orgName: e.target.value })}
            placeholder="e.g. APOLLO TYRES LTD"
            required
          />

          <label className="field-label" style={{ marginTop: 14 }}>Tagline / Department Subtitle</label>
          <input
            className="input"
            value={form.tagline}
            onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            placeholder="e.g. Hostel Administration & Trainee Operations"
          />

          <label className="field-label" style={{ marginTop: 14 }}>Plant / Campus Address</label>
          <input
            className="input"
            value={form.address || ''}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="e.g. Apollo Tyres Ltd Manufacturing Campus"
          />

          <label className="field-label" style={{ marginTop: 14 }}>Official Organization Logo</label>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              <Icon name="upload" size={14} /> Upload Custom Logo
              <input type="file" accept="image/*" onChange={handleLogoUpload} style={{ display: 'none' }} />
            </label>
            {form.logo && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setForm({ ...form, logo: '' })}
              >
                <Icon name="trash" size={14} /> Remove Custom Logo
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save Branding Settings'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleReset}>
              Reset to Default
            </button>
          </div>
        </form>
      </Card>

      <Card title="Branding Preview" sub="How Apollo Tyres branding appears across headers, exports, and ID cards.">
        <div style={{ padding: 24, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', textAlign: 'center' }}>
          <div style={{ minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
            {form.logo ? (
              <img src={form.logo} alt="Organization Logo" style={{ maxHeight: 60, maxWidth: 240, objectFit: 'contain' }} />
            ) : (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2E1065', padding: '10px 20px', borderRadius: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: '#C084FC', letterSpacing: '-0.5px' }}>apollo</span>
                <span style={{ fontSize: 24, fontWeight: 400, color: '#FFFFFF', letterSpacing: '-0.5px' }}>tyres</span>
              </div>
            )}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#1e1b4b', letterSpacing: '0.02em' }}>{form.orgName || 'APOLLO TYRES LTD'}</div>
          <div style={{ fontSize: 13, color: '#6d28d9', marginTop: 4, fontWeight: 600 }}>{form.tagline || 'Hostel Administration & Trainee Operations'}</div>
          {form.address && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{form.address}</div>}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- ID Card Design Settings ---------------- */
const SAMPLE_TRAINEE = {
  traineeId: 'TR-APOLLO-001',
  name: 'Vikram Sharma',
  mobile: '9876543210',
  qualification: 'Diploma Mechanical',
  department: 'Plant Operations',
  hostel: 'Apollo Campus Block A',
  roomNo: '102',
  joiningDate: '2026-01-15',
  photo: '',
  qrId: 'QR-DEMO-001',
  hostelStatus: 'ACTIVE',
  qrStatus: 'ACTIVE',
  defaultShift: 'G',
};

function IdCardDesignSettings() {
  const { config, setConfig, notify } = useStore();
  const current = config.idCardTemplate || DEFAULT_IDCARD_TEMPLATE;
  const [form, setForm] = useState(current);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(config.idCardTemplate || DEFAULT_IDCARD_TEMPLATE);
  }, [config.idCardTemplate]);

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await api('/api/admin/id-card-template', { method: 'PUT', body: form });
      setConfig((p) => ({ ...p, idCardTemplate: res.idCardTemplate }));
      notify('✓ ID Card design template updated successfully.');
    } catch (err) {
      notify('Error saving ID Card template: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset ID Card design template to official violet defaults?')) {
      setForm(DEFAULT_IDCARD_TEMPLATE);
    }
  };

  return (
    <div className="grid-2">
      <Card title="ID Card Design Settings" sub="Customize colors, visible details, headers, and dimensions.">
        <form onSubmit={handleSave}>
          <div className="form-grid">
            <div className="span-2">
              <label className="field-label">Header Company Title</label>
              <input
                className="input"
                value={form.companyName || ''}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                placeholder="e.g. APOLLO TYRES LTD"
              />
            </div>

            <div className="span-2">
              <label className="field-label">Card Subtitle</label>
              <input
                className="input"
                value={form.subtitle || ''}
                onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                placeholder="e.g. TRAINEE IDENTITY CARD"
              />
            </div>

            <div>
              <label className="field-label">Header Gradient Start</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.headerBgStart || '#2E1065'}
                  onChange={(e) => setForm({ ...form, headerBgStart: e.target.value })}
                  style={{ width: 44, height: 38, padding: 0, border: 'none', cursor: 'pointer' }}
                />
                <input
                  className="input"
                  value={form.headerBgStart || '#2E1065'}
                  onChange={(e) => setForm({ ...form, headerBgStart: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="field-label">Header Gradient End</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.headerBgEnd || '#4C1D95'}
                  onChange={(e) => setForm({ ...form, headerBgEnd: e.target.value })}
                  style={{ width: 44, height: 38, padding: 0, border: 'none', cursor: 'pointer' }}
                />
                <input
                  className="input"
                  value={form.headerBgEnd || '#4C1D95'}
                  onChange={(e) => setForm({ ...form, headerBgEnd: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="field-label">Accent Stripe Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.accentColor || '#8B5CF6'}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                  style={{ width: 44, height: 38, padding: 0, border: 'none', cursor: 'pointer' }}
                />
                <input
                  className="input"
                  value={form.accentColor || '#8B5CF6'}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="field-label">Photo Shape</label>
              <select
                className="input"
                value={form.photoShape || 'circle'}
                onChange={(e) => setForm({ ...form, photoShape: e.target.value })}
              >
                <option value="circle">Circular Avatar</option>
                <option value="square">Rounded Square</option>
              </select>
            </div>

            <div className="span-2">
              <label className="field-label">Footer Card Text</label>
              <input
                className="input"
                value={form.footerText || ''}
                onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                placeholder="Authorized Trainee ID Card · Apollo Tyres Ltd"
              />
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <label className="field-label" style={{ fontWeight: 600, marginBottom: 8 }}>Visible Details on Card</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Switch
                checked={form.showQualification !== false}
                onChange={(v) => setForm({ ...form, showQualification: v })}
                label="Show Qualification"
              />
              <Switch
                checked={form.showPhone !== false}
                onChange={(v) => setForm({ ...form, showPhone: v })}
                label="Show Phone Number"
              />
              <Switch
                checked={form.showHostel !== false}
                onChange={(v) => setForm({ ...form, showHostel: v })}
                label="Show Hostel Block"
              />
              <Switch
                checked={form.showRoom !== false}
                onChange={(v) => setForm({ ...form, showRoom: v })}
                label="Show Room Number"
              />
              <Switch
                checked={form.showJoiningDate !== false}
                onChange={(v) => setForm({ ...form, showJoiningDate: v })}
                label="Show Joining Date"
              />
              <Switch
                checked={form.showQr !== false}
                onChange={(v) => setForm({ ...form, showQr: v })}
                label="Show QR Code"
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save ID Card Settings'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleReset}>
              Reset to Default
            </button>
          </div>
        </form>
      </Card>

      <Card title="Live ID Card Preview" sub="Real-time preview of the printable and downloadable card.">
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}>
          <VerticalIdCard trainee={SAMPLE_TRAINEE} customTemplate={form} embedded />
        </div>
      </Card>
    </div>
  );
}

/* ---------------- Approval Email Template Settings ---------------- */
const PLACEHOLDERS = [
  ['{{traineeName}}', 'Trainee Full Name'],
  ['{{traineeId}}', 'Trainee ID'],
  ['{{joiningDate}}', 'Joining Date'],
  ['{{department}}', 'Department / Qualification'],
  ['{{approvalLink}}', 'Review & Approval Link'],
  ['{{organizationName}}', 'Organization Name'],
  ['{{organizationLogo}}', 'Organization Logo URL'],
  ['{{approverName}}', 'Approver Name'],
];

function ApprovalEmailTemplateSettings() {
  const { config, setConfig, notify } = useStore();
  const current = config.emailTemplate || DEFAULT_EMAIL_TEMPLATE;
  const branding = config.orgBranding || DEFAULT_ORG_BRANDING;
  const [form, setForm] = useState(current);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    setForm(config.emailTemplate || DEFAULT_EMAIL_TEMPLATE);
  }, [config.emailTemplate]);

  const handleInsertToken = (token) => {
    setForm((p) => ({
      ...p,
      bodyText: (p.bodyText || '') + ' ' + token,
    }));
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await api('/api/admin/email-template', { method: 'PUT', body: form });
      setConfig((p) => ({ ...p, emailTemplate: res.emailTemplate }));
      notify('✓ Approval email template updated successfully.');
    } catch (err) {
      notify('Error saving email template: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (window.confirm('Reset approval email template to defaults?')) {
      setForm(DEFAULT_EMAIL_TEMPLATE);
    }
  };

  const handleSendTest = async () => {
    if (!testEmail.trim()) {
      notify('Please enter an email address for testing.');
      return;
    }
    setSendingTest(true);
    try {
      const res = await api('/api/admin/email-template/test', {
        method: 'POST',
        body: { to: testEmail.trim(), template: form },
      });
      notify(`✓ Test email dispatched to ${res.recipient}. Status: ${res.dispatch?.status || 'SENT'}`);
    } catch (err) {
      notify('Failed to send test email: ' + err.message);
    } finally {
      setSendingTest(false);
    }
  };

  // Preview token replacer
  const sampleOrg = branding.orgName || 'APOLLO TYRES LTD';
  const previewSubject = (form.subject || '')
    .replace(/\{\{traineeName\}\}/g, 'Vikram Sharma')
    .replace(/\{\{traineeId\}\}/g, 'TR-APOLLO-001')
    .replace(/\{\{organizationName\}\}/g, sampleOrg);

  const previewHeading = (form.heading || '')
    .replace(/\{\{traineeName\}\}/g, 'Vikram Sharma')
    .replace(/\{\{organizationName\}\}/g, sampleOrg);

  const previewBody = (form.bodyText || '')
    .replace(/\{\{traineeName\}\}/g, 'Vikram Sharma')
    .replace(/\{\{traineeId\}\}/g, 'TR-APOLLO-001')
    .replace(/\{\{joiningDate\}\}/g, '2026-01-15')
    .replace(/\{\{department\}\}/g, 'Plant Operations')
    .replace(/\{\{organizationName\}\}/g, sampleOrg)
    .replace(/\{\{approverName\}\}/g, 'Approver');

  return (
    <div className="grid-2">
      <Card title="Approval Email Template Settings" sub="Configure subject, content, dynamic placeholders, and layout.">
        <form onSubmit={handleSave}>
          <label className="field-label">Email Subject *</label>
          <input
            className="input"
            value={form.subject || ''}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="[Action Required] Review Registration: {{traineeName}} ({{traineeId}})"
            required
          />

          <div className="two-col" style={{ marginTop: 14 }}>
            <div>
              <label className="field-label">Banner Heading</label>
              <input
                className="input"
                value={form.heading || ''}
                onChange={(e) => setForm({ ...form, heading: e.target.value })}
                placeholder="Trainee Registration Review Request"
              />
            </div>
            <div>
              <label className="field-label">Banner Subheading</label>
              <input
                className="input"
                value={form.subheading || ''}
                onChange={(e) => setForm({ ...form, subheading: e.target.value })}
                placeholder="Apollo Tyres Ltd — Trainee Hostel Operations"
              />
            </div>
          </div>

          <div className="two-col" style={{ marginTop: 14 }}>
            <div>
              <label className="field-label">Header Background Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.headerBg || '#2E1065'}
                  onChange={(e) => setForm({ ...form, headerBg: e.target.value })}
                  style={{ width: 44, height: 38, padding: 0, border: 'none', cursor: 'pointer' }}
                />
                <input
                  className="input"
                  value={form.headerBg || '#2E1065'}
                  onChange={(e) => setForm({ ...form, headerBg: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="field-label">Accent / Button Color</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.accentColor || '#7C3AED'}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                  style={{ width: 44, height: 38, padding: 0, border: 'none', cursor: 'pointer' }}
                />
                <input
                  className="input"
                  value={form.accentColor || '#7C3AED'}
                  onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                />
              </div>
            </div>
          </div>

          <label className="field-label" style={{ marginTop: 16 }}>
            Body Message
          </label>
          <div style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {PLACEHOLDERS.map(([token, desc]) => (
              <button
                key={token}
                type="button"
                className="btn btn-ghost btn-xs"
                style={{ fontSize: 11, background: '#ede9fe', color: '#5b21b6', border: '1px solid #ddd6fe' }}
                onClick={() => handleInsertToken(token)}
                title={`Insert ${desc}`}
              >
                + {token}
              </button>
            ))}
          </div>
          <textarea
            className="input"
            rows={5}
            value={form.bodyText || ''}
            onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
            placeholder="A new trainee registration has been submitted for {{organizationName}} and requires your official review..."
          />

          <label className="field-label" style={{ marginTop: 14 }}>Footer Text</label>
          <input
            className="input"
            value={form.footerText || ''}
            onChange={(e) => setForm({ ...form, footerText: e.target.value })}
            placeholder="Security Notice: This link contains a secure, single-use token expiring in 7 days."
          />

          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Icon name="check" size={14} /> {saving ? 'Saving…' : 'Save Email Template'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleReset}>
              Reset to Default
            </button>
          </div>
        </form>

        <hr style={{ margin: '24px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

        <div>
          <label className="field-label" style={{ fontWeight: 600 }}>Send Test Email</label>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '4px 0 10px 0' }}>
            Dispatch a test sample of this template to verify formatting in your mail client.
          </p>
          <div style={{ display: 'flex', gap: 10, maxWidth: 440 }}>
            <input
              className="input"
              type="email"
              placeholder="e.g. your-email@apollotyres.com"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleSendTest}
              disabled={sendingTest}
            >
              {sendingTest ? 'Sending…' : 'Send Test'}
            </button>
          </div>
        </div>
      </Card>

      <Card title="Email Preview" sub="Live rendering of the notification sent to approvers.">
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#ffffff', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <div style={{ background: '#f1f5f9', padding: '10px 16px', borderBottom: '1px solid #e2e8f0', fontSize: 12, color: '#475569' }}>
            <div><strong>Subject:</strong> {previewSubject}</div>
          </div>
          <div style={{ background: form.headerBg || '#2E1065', color: '#ffffff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>{previewHeading}</div>
              <div style={{ fontSize: 12, color: '#ddd6fe', marginTop: 2 }}>{form.subheading || `${sampleOrg} — Trainee Hostel Operations`}</div>
            </div>
            {branding.logo ? (
              <img src={branding.logo} alt="Logo" style={{ maxHeight: 36, maxWidth: 100, objectFit: 'contain' }} />
            ) : (
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ddd6fe' }}>{sampleOrg}</span>
            )}
          </div>
          <div style={{ padding: 20 }}>
            <p style={{ margin: '0 0 10px 0', fontSize: 14 }}>Dear <strong>Approver</strong>,</p>
            <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 16 }}>
              {previewBody}
            </div>

            <div style={{ background: '#f8fafc', borderLeft: `4px solid ${form.accentColor || '#7C3AED'}`, padding: '12px 16px', borderRadius: 6, fontSize: 13 }}>
              <div><strong>Full Name:</strong> Vikram Sharma</div>
              <div style={{ marginTop: 4 }}><strong>Trainee ID:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 700, color: form.accentColor || '#7C3AED' }}>TR-APOLLO-001</span></div>
              <div style={{ marginTop: 4 }}><strong>Department:</strong> Plant Operations</div>
              <div style={{ marginTop: 4 }}><strong>Joining Date:</strong> 2026-01-15</div>
            </div>

            <div style={{ margin: '22px 0', textAlign: 'center' }}>
              <div style={{ background: form.accentColor || '#7C3AED', color: '#ffffff', padding: '12px 24px', borderRadius: 8, display: 'inline-block', fontWeight: 700, fontSize: 14 }}>
                Open Trainee Review & Decisions →
              </div>
            </div>

            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 12, fontSize: 11, color: '#94a3b8' }}>
              {form.footerText || 'Security Notice: This link contains a secure, single-use token expiring in 7 days.'}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

const TABS = [
  ['branding', 'Organization Branding'],
  ['idcard', 'ID Card Design'],
  ['email', 'Approval Email Template'],
  ['approvers', 'Approval Authorities'],
  ['users', 'Login members'],
  ['roles', 'Roles'],
  ['look', 'Look & feel'],
  ['pages', 'Pages & fields'],
  ['hostels', 'Hostels & rooms'],
];
export default function Console() {
  const [tab, setTab] = useState('branding');
  return (
    <>
      <div className="tabbar scroll-x">
        {TABS.map(([id, l]) => <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>
      {tab === 'branding' ? <OrganizationBranding />
        : tab === 'idcard' ? <IdCardDesignSettings />
        : tab === 'email' ? <ApprovalEmailTemplateSettings />
        : tab === 'users' ? <Users />
        : tab === 'roles' ? <Roles />
        : tab === 'approvers' ? <Approvers />
        : tab === 'look' ? <Appearance />
        : tab === 'pages' ? <PagesAndFields />
        : <Hostels />}
    </>
  );
}
