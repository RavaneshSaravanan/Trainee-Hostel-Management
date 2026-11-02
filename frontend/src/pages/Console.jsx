import { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { api } from '../utils/api.js';
import {
  ASSIGNABLE_PAGES,
  DEFAULT_CONFIG,
  DEFAULT_EMAIL_TEMPLATE,
  DEFAULT_EMAIL_TEMPLATES,
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
import { fmtDate } from '../utils/dates.js';
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
  const { db, addHostel, addRoom, setRoomCapacity, deleteHostel, deleteRoom, isSuper, notify } = useStore();
  const [name, setName] = useState('');
  const [room, setRoom] = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [occupiedWarning, setOccupiedWarning] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteRoomTarget, setDeleteRoomTarget] = useState(null);
  const [occupiedRoomWarning, setOccupiedRoomWarning] = useState(null);
  const [deletingRoom, setDeletingRoom] = useState(false);

  const handleDeleteRoomClick = (h, r) => {
    const activeOccupants = db.trainees.filter(
      (t) =>
        (t.hostel === h.name || t.hostelId === h.id) &&
        String(t.roomNo).trim() === String(r.no).trim() &&
        ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'].includes(t.hostelStatus)
    );

    if (activeOccupants.length > 0) {
      setOccupiedRoomWarning({ hostel: h, room: r, occupants: activeOccupants });
    } else {
      setDeleteRoomTarget({ hostel: h, room: r });
    }
  };

  const handleDeleteClick = (h) => {
    const activeOccupants = db.trainees.filter(
      (t) =>
        (t.hostel === h.name || t.hostelId === h.id) &&
        ['ACTIVE', 'ON LEAVE', 'OUTING', 'TEMPORARY VACATE'].includes(t.hostelStatus) &&
        t.roomNo
    );

    if (activeOccupants.length > 0) {
      setOccupiedWarning({ hostel: h, occupants: activeOccupants });
    } else {
      setDeleteTarget(h);
    }
  };

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
          <Card
            key={h.id}
            title={h.name}
            sub={`${h.rooms.length} rooms · capacity ${h.rooms.reduce((s, r) => s + r.capacity, 0)}`}
            action={
              isSuper && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ color: 'var(--red, #ef4444)' }}
                  onClick={() => handleDeleteClick(h)}
                  title={`Delete ${h.name}`}
                >
                  <Icon name="trash" size={14} /> Delete Hostel
                </button>
              )
            }
          >
            <div className="room-chips">
              {h.rooms.map((r) => (
                <div className="room-chip" key={r.no}>
                  <span>Room {r.no}</span>
                  <input type="number" min="1" value={r.capacity} onChange={(e) => setRoomCapacity(h.id, r.no, e.target.value)} />
                  {isSuper && (
                    <button
                      type="button"
                      className="room-delete-btn"
                      title={`Delete Room ${r.no}`}
                      onClick={() => handleDeleteRoomClick(h, r)}
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  )}
                </div>
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

      {occupiedWarning && (
        <Modal
          title={`Cannot Delete Hostel — ${occupiedWarning.hostel.name}`}
          onClose={() => setOccupiedWarning(null)}
          actions={
            <button className="btn btn-primary" onClick={() => setOccupiedWarning(null)}>
              Understood
            </button>
          }
        >
          <div className="alert-banner bad" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={18} />
            <div className="alert-text">
              <strong>Direct deletion blocked:</strong> Hostel &ldquo;{occupiedWarning.hostel.name}&rdquo; currently has{' '}
              {occupiedWarning.occupants.length} active resident trainee(s).
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Please reassign all active occupants to another hostel or room before deleting this hostel. Trainee master records and historical data are preserved.
          </p>
          <Table
            headers={['S.No', 'Trainee Name', 'Trainee ID', 'Room No.', 'Status']}
            rows={occupiedWarning.occupants.map((t, idx) => [
              idx + 1,
              <strong>{t.name}</strong>,
              t.traineeId || t.qrId,
              `Room ${t.roomNo}`,
              <Badge key={t.traineeId || t.qrId} status={t.hostelStatus} />,
            ])}
          />
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={`Confirm Delete Hostel — ${deleteTarget.name}`}
          onClose={() => !deleting && setDeleteTarget(null)}
          actions={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  const res = await deleteHostel(deleteTarget.id);
                  setDeleting(false);
                  if (res.ok) {
                    setDeleteTarget(null);
                  }
                }}
              >
                <Icon name="trash" size={14} /> {deleting ? 'Deleting…' : 'Confirm Delete'}
              </button>
            </div>
          }
        >
          <div style={{ padding: '6px 0' }}>
            <p style={{ margin: '0 0 12px' }}>
              Are you sure you want to permanently delete hostel <strong>{deleteTarget.name}</strong>?
            </p>
            <div className="info-grid" style={{ marginBottom: 14 }}>
              <div className="info-item"><div className="info-k">Hostel ID</div><div className="info-v">{deleteTarget.id}</div></div>
              <div className="info-item"><div className="info-k">Hostel Name</div><div className="info-v">{deleteTarget.name}</div></div>
              <div className="info-item"><div className="info-k">Configured Rooms</div><div className="info-v">{deleteTarget.rooms.length} rooms</div></div>
              <div className="info-item"><div className="info-k">Total Capacity</div><div className="info-v">{deleteTarget.rooms.reduce((s, r) => s + r.capacity, 0)} beds</div></div>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              ⚠️ Trainee master records and historical data will be preserved. This action cannot be undone.
            </p>
          </div>
        </Modal>
      )}
      {occupiedRoomWarning && (
        <Modal
          title={`Cannot Delete Room — Room ${occupiedRoomWarning.room.no} (${occupiedRoomWarning.hostel.name})`}
          onClose={() => setOccupiedRoomWarning(null)}
          actions={
            <button className="btn btn-primary" onClick={() => setOccupiedRoomWarning(null)}>
              Understood
            </button>
          }
        >
          <div className="alert-banner bad" style={{ marginBottom: 12 }}>
            <Icon name="alert" size={18} />
            <div className="alert-text">
              <strong>Direct deletion blocked:</strong> Room &ldquo;{occupiedRoomWarning.room.no}&rdquo; in hostel &ldquo;{occupiedRoomWarning.hostel.name}&rdquo; currently has{' '}
              {occupiedRoomWarning.occupants.length} active resident trainee(s).
            </div>
          </div>
          <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            Please reassign all active occupants to another room or hostel before deleting this room. Trainee master records and historical data are preserved.
          </p>
          <Table
            headers={['S.No', 'Trainee Name', 'Trainee ID', 'Status']}
            rows={occupiedRoomWarning.occupants.map((t, idx) => [
              idx + 1,
              <strong>{t.name}</strong>,
              t.traineeId || t.qrId,
              <Badge key={t.traineeId || t.qrId} status={t.hostelStatus} />,
            ])}
          />
        </Modal>
      )}

      {deleteRoomTarget && (
        <Modal
          title={`Confirm Delete Room — Room ${deleteRoomTarget.room.no}`}
          onClose={() => !deletingRoom && setDeleteRoomTarget(null)}
          actions={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setDeleteRoomTarget(null)} disabled={deletingRoom}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={deletingRoom}
                onClick={async () => {
                  setDeletingRoom(true);
                  const res = await deleteRoom(deleteRoomTarget.hostel.id, deleteRoomTarget.room.no);
                  setDeletingRoom(false);
                  if (res.ok) {
                    setDeleteRoomTarget(null);
                  }
                }}
              >
                <Icon name="trash" size={14} /> {deletingRoom ? 'Deleting…' : 'Delete Room'}
              </button>
            </div>
          }
        >
          <div style={{ padding: '6px 0' }}>
            <p style={{ margin: '0 0 12px' }}>
              Are you sure you want to permanently delete <strong>Room {deleteRoomTarget.room.no}</strong> from hostel <strong>{deleteRoomTarget.hostel.name}</strong>?
            </p>
            <div className="info-grid" style={{ marginBottom: 14 }}>
              <div className="info-item"><div className="info-k">Hostel</div><div className="info-v">{deleteRoomTarget.hostel.name}</div></div>
              <div className="info-item"><div className="info-k">Room Number</div><div className="info-v">Room {deleteRoomTarget.room.no}</div></div>
              <div className="info-item"><div className="info-k">Configured Capacity</div><div className="info-v">{deleteRoomTarget.room.capacity} beds</div></div>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>
              ⚠️ Trainee master records and historical data will be preserved. This action cannot be undone.
            </p>
          </div>
        </Modal>
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

/* ---------------- Email Management (Super Admin Only) ---------------- */
const DYNAMIC_PLACEHOLDERS = [
  ['{{traineeName}}', 'Trainee Full Name'],
  ['{{traineeId}}', 'Trainee ID Number'],
  ['{{qrId}}', 'QR Code Identifier'],
  ['{{traineeEmail}}', 'Trainee Email Address'],
  ['{{hostelName}}', 'Assigned Hostel Block'],
  ['{{roomNumber}}', 'Assigned Room Number'],
  ['{{joiningDate}}', 'Joining Date (DD/MM/YYYY)'],
  ['{{freeValidityStartDate}}', 'Free Accommodation Start Date'],
  ['{{freeValidityEndDate}}', 'Free Accommodation End Date (3 Months)'],
  ['{{organizationName}}', 'Organization Name'],
  ['{{organizationLogo}}', 'Organization Logo URL'],
  ['{{idCardAttachment}}', 'Digital ID Card Badge / URL'],
];

const EMAIL_WORKFLOW_TYPES = [
  { id: 'WELCOME', label: 'Trainee Welcome Email' },
  { id: 'ID_CARD', label: 'Trainee ID Card Email' },
  { id: 'ID_CARD_UPDATED', label: 'ID Card Updated Email' },
  { id: 'APPROVAL', label: 'Approval Request Email' },
  { id: 'SYSTEM', label: 'System Notifications' },
];

function EmailRecipientModal({ recipient, onClose, onSaved }) {
  const { notify } = useStore();
  const isEdit = Boolean(recipient?.id);
  const [f, setF] = useState(
    recipient || {
      name: '',
      email: '',
      type: 'CC',
      emailTypes: ['WELCOME', 'ID_CARD', 'APPROVAL', 'ID_CARD_UPDATED', 'SYSTEM'],
      enabled: true,
      description: '',
    }
  );
  const [saving, setSaving] = useState(false);

  const toggleType = (tid) => {
    const list = f.emailTypes || [];
    if (list.includes(tid)) {
      setF({ ...f, emailTypes: list.filter((x) => x !== tid) });
    } else {
      setF({ ...f, emailTypes: [...list, tid] });
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!f.email || !f.email.includes('@')) {
      notify('Please enter a valid email address.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api(`/api/admin/email-recipients/${recipient.id}`, { method: 'PUT', body: f });
        notify('✓ Recipient updated successfully.');
      } else {
        await api('/api/admin/email-recipients', { method: 'POST', body: f });
        notify('✓ New recipient added successfully.');
      }
      onSaved?.();
      onClose();
    } catch (err) {
      notify('Error saving recipient: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isEdit ? 'Edit Email Recipient' : 'Add Email Recipient'} onClose={onClose}>
      <form onSubmit={handleSave}>
        <label className="field-label">Recipient Name *</label>
        <input
          className="input"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="e.g. HR Manager / Security Supervisor"
          required
        />

        <label className="field-label" style={{ marginTop: 12 }}>Email Address *</label>
        <input
          className="input"
          type="email"
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
          placeholder="e.g. hr.hostel@apollotyres.com"
          required
        />

        <div className="two-col" style={{ marginTop: 12 }}>
          <div>
            <label className="field-label">Delivery Type</label>
            <select
              className="input"
              value={f.type}
              onChange={(e) => setF({ ...f, type: e.target.value })}
            >
              <option value="TO">TO (Direct Recipient)</option>
              <option value="CC">CC (Carbon Copy)</option>
              <option value="BCC">BCC (Blind Carbon Copy)</option>
            </select>
          </div>
          <div>
            <label className="field-label">Status</label>
            <div style={{ marginTop: 8 }}>
              <Switch
                checked={f.enabled !== false}
                onChange={(v) => setF({ ...f, enabled: v })}
                label={f.enabled !== false ? 'Active & Receiving' : 'Disabled (Paused)'}
              />
            </div>
          </div>
        </div>

        <label className="field-label" style={{ marginTop: 14 }}>Role Description / Notes</label>
        <input
          className="input"
          value={f.description || ''}
          onChange={(e) => setF({ ...f, description: e.target.value })}
          placeholder="e.g. Receives hostel allocation updates for employee onboarding"
        />

        <label className="field-label" style={{ marginTop: 16 }}>
          Assign to Email Workflows:
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {EMAIL_WORKFLOW_TYPES.map((t) => (
            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={(f.emailTypes || []).includes(t.id)}
                onChange={() => toggleType(t.id)}
              />
              <span>{t.label} (<code>{t.id}</code>)</span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 24 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            <Icon name="check" size={14} /> {saving ? 'Saving…' : isEdit ? 'Update Recipient' : 'Add Recipient'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------- Admin Notification Email Configuration ---------------- */
function AdminNotificationEmailConfig() {
  const { notify } = useStore();
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const loadAdminEmail = async () => {
    try {
      setLoading(true);
      const res = await api('/api/admin/notification-email');
      const cur = res.adminNotificationEmail || '';
      setEmail(cur);
      setSavedEmail(cur);
    } catch (err) {
      notify('Failed to load admin notification email: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminEmail();
  }, []);

  const handleSave = async (e) => {
    e?.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!clean || !clean.includes('@') || !clean.includes('.')) {
      notify('Please enter a valid administrator email address.');
      return;
    }
    setSaving(true);
    setTestResult(null);
    try {
      const res = await api('/api/admin/notification-email', {
        method: 'PUT',
        body: { email: clean },
      });
      setSavedEmail(res.adminNotificationEmail);
      setEmail(res.adminNotificationEmail);
      notify('✓ Admin notification email updated and saved in MongoDB.');
    } catch (err) {
      notify('Error updating admin notification email: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!savedEmail) {
      notify('Please save a valid admin notification email first.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api('/api/admin/notification-email/test', {
        method: 'POST',
        body: { targetEmail: savedEmail },
      });
      setTestResult({ ok: true, recipient: res.recipient, message: 'Test alert dispatched successfully.' });
      notify(`✓ Test notification sent to ${res.recipient}.`);
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
      notify('Failed to dispatch test notification: ' + err.message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card
      title="Admin Notification Email Configuration"
      sub="Single source of truth in MongoDB for system alerts, approval notifications, and administrator communications."
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
          color: '#ffffff',
          padding: '16px 20px',
          borderRadius: 8,
          marginBottom: 20,
          border: '1px solid #4338ca',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>🛡️</div>
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#e0e7ff', marginBottom: 2 }}>
              MongoDB Single Source of Truth
            </div>
            This email address is saved directly in MongoDB and is used for all administrative notifications,
            new trainee approval requests, and system alerts. It permanently replaces any default addresses and
            persists across page reloads, logouts, and server restarts.
          </div>
        </div>
      </div>

      <form onSubmit={handleSave}>
        <div style={{ maxWidth: 540 }}>
          <label className="field-label" style={{ fontWeight: 600 }}>
            Admin Notification Recipient Email *
          </label>
          <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. admin@apollotyres.com or qa-admin@gmail.com"
              required
              disabled={loading || saving}
              style={{ fontSize: 14 }}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || saving || (email.trim().toLowerCase() === savedEmail && Boolean(savedEmail))}
              style={{ whiteSpace: 'nowrap' }}
            >
              <Icon name="check" size={14} /> {saving ? 'Saving to MongoDB…' : 'Save Admin Email'}
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
            Currently active in MongoDB:{' '}
            <strong style={{ color: savedEmail ? '#7c3aed' : '#dc2626', fontFamily: 'monospace' }}>
              {savedEmail || 'No admin email configured'}
            </strong>
          </div>
        </div>
      </form>

      <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--text)' }}>
            Verify Admin Notification Delivery
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
            Dispatch a verified test alert directly to the saved admin address to confirm deliverability.
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={handleSendTest}
          disabled={testing || !savedEmail}
        >
          <Icon name="send" size={13} /> {testing ? 'Sending Test…' : 'Send Test Notification'}
        </button>
      </div>

      {testResult && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 14px',
            borderRadius: 6,
            fontSize: 13,
            background: testResult.ok ? '#dcfce7' : '#fee2e2',
            color: testResult.ok ? '#15803d' : '#b91c1c',
            border: `1px solid ${testResult.ok ? '#86efac' : '#fca5a5'}`,
          }}
        >
          {testResult.ok ? `✓ ${testResult.message} Sent to ${testResult.recipient}.` : `✗ Error: ${testResult.error}`}
        </div>
      )}
    </Card>
  );
}

function EmailRecipientManagement() {
  const { notify } = useStore();
  const [recipients, setRecipients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalItem, setModalItem] = useState(null); // null, 'new', or recipient object

  const loadRecipients = async () => {
    try {
      setLoading(true);
      const res = await api('/api/admin/email-recipients');
      setRecipients(res.recipients || []);
    } catch (err) {
      notify('Failed to load email recipients: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRecipients();
  }, []);

  const handleToggleActive = async (rec) => {
    try {
      const updated = { ...rec, enabled: !rec.enabled };
      await api(`/api/admin/email-recipients/${rec.id}`, { method: 'PUT', body: updated });
      setRecipients((prev) => prev.map((r) => (r.id === rec.id ? updated : r)));
      notify(`✓ ${rec.name} ${updated.enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      notify('Error toggling recipient status: ' + err.message);
    }
  };

  const handleDelete = async (rec) => {
    if (!window.confirm(`Are you sure you want to delete recipient "${rec.name}" (${rec.email})?`)) {
      return;
    }
    try {
      await api(`/api/admin/email-recipients/${rec.id}`, { method: 'DELETE' });
      setRecipients((prev) => prev.filter((r) => r.id !== rec.id));
      notify(`✓ Recipient "${rec.name}" deleted.`);
    } catch (err) {
      notify('Error deleting recipient: ' + err.message);
    }
  };

  return (
    <div>
      {/* Primary Recipient Info Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #2E1065 0%, #4C1D95 100%)',
          color: '#ffffff',
          padding: '16px 20px',
          borderRadius: 10,
          marginBottom: 20,
          boxShadow: '0 2px 10px rgba(76, 29, 149, 0.15)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ fontSize: 24, lineHeight: 1 }}>✉</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '0.01em' }}>
              Primary Recipient Rule
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#e9d5ff', lineHeight: 1.5 }}>
              The <strong>Primary Recipient</strong> for all automated trainee communications (Welcome Email, ID Card,
              Updates) is strictly the <strong>trainee's registered personal email address</strong> (e.g. <code>@gmail.com</code>).
              Any additional recipients configured below are automatically added as <strong>TO</strong>, <strong>CC</strong>,
              or <strong>BCC</strong> copies according to their assigned workflows.
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
            Configured Email Recipients ({recipients.length})
          </h3>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Configure administrators, wardens, HR staff, and security personnel who receive automated notifications.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setModalItem('new')}>
          <Icon name="plus" size={14} /> Add Recipient
        </button>
      </div>

      {loading ? (
        <Card>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
            Loading configured recipients…
          </div>
        </Card>
      ) : recipients.length === 0 ? (
        <Card>
          <div style={{ padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>👥</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>No additional recipients configured</div>
            <p style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 440, margin: '6px auto 16px auto' }}>
              All emails currently go only to the individual trainee's registered email address. Add HR, warden, or security addresses to receive copies.
            </p>
            <button className="btn btn-primary btn-sm" onClick={() => setModalItem('new')}>
              <Icon name="plus" size={14} /> Add First Recipient
            </button>
          </div>
        </Card>
      ) : (
        <Table
          headers={['Recipient Name & Email', 'Delivery Type', 'Assigned Workflows', 'Notes / Role', 'Status', 'Actions']}
          rows={recipients.map((r) => [
            <div key="info">
              <div style={{ fontWeight: 600, color: 'var(--text)' }}>{r.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{r.email}</div>
            </div>,
            <Badge
              key="type"
              tone={r.type === 'TO' ? 'primary' : r.type === 'CC' ? 'accent' : 'neutral'}
            >
              {r.type}
            </Badge>,
            <div key="types" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 260 }}>
              {(r.emailTypes || []).map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 11,
                    background: '#ede9fe',
                    color: '#5b21b6',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontWeight: 600,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>,
            <span key="desc" style={{ fontSize: 12, color: 'var(--muted)' }}>
              {r.description || '—'}
            </span>,
            <Switch
              key="status"
              checked={r.enabled !== false}
              onChange={() => handleToggleActive(r)}
              label={r.enabled !== false ? 'Active' : 'Disabled'}
            />,
            <div key="actions" style={{ display: 'flex', gap: 6 }}>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => setModalItem(r)}
                title="Edit Recipient"
              >
                <Icon name="edit" size={13} />
              </button>
              <button
                className="btn btn-ghost btn-xs"
                style={{ color: '#dc2626' }}
                onClick={() => handleDelete(r)}
                title="Delete Recipient"
              >
                <Icon name="trash" size={13} />
              </button>
            </div>,
          ])}
        />
      )}

      {modalItem && (
        <EmailRecipientModal
          recipient={modalItem === 'new' ? null : modalItem}
          onClose={() => setModalItem(null)}
          onSaved={loadRecipients}
        />
      )}
    </div>
  );
}

/* ---------------- Email Template Editor (Super Admin Only) ---------------- */
const TEMPLATE_TABS = [
  ['welcome', 'Trainee Welcome Email'],
  ['idCard', 'Trainee ID Card Email'],
  ['idCardUpdated', 'ID Card Updated Email'],
  ['approval', 'Approval Request Email'],
];

function EmailTemplateEditor() {
  const { config, setConfig, notify } = useStore();
  const [activeType, setActiveType] = useState('welcome');
  const branding = config.orgBranding || DEFAULT_ORG_BRANDING;
  const currentTemplates = {
    ...DEFAULT_EMAIL_TEMPLATES,
    ...(config.emailTemplates || {}),
  };
  const [form, setForm] = useState(currentTemplates[activeType] || DEFAULT_EMAIL_TEMPLATES[activeType]);
  const [saving, setSaving] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    const tpl = (config.emailTemplates && config.emailTemplates[activeType]) || DEFAULT_EMAIL_TEMPLATES[activeType];
    setForm(tpl || {});
  }, [activeType, config.emailTemplates]);

  const handleInsertPlaceholder = (token) => {
    setForm((p) => ({
      ...p,
      bodyText: (p.bodyText || '') + ' ' + token,
    }));
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const res = await api(`/api/admin/email-templates/${activeType}`, {
        method: 'PUT',
        body: form,
      });
      setConfig((prev) => ({
        ...prev,
        emailTemplates: {
          ...(prev.emailTemplates || {}),
          [activeType]: res.template,
        },
      }));
      notify(`✓ ${TEMPLATE_TABS.find((t) => t[0] === activeType)?.[1] || activeType} template saved successfully.`);
    } catch (err) {
      notify('Error saving template: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (window.confirm(`Reset "${TEMPLATE_TABS.find((t) => t[0] === activeType)?.[1]}" to system defaults?`)) {
      try {
        const res = await api(`/api/admin/email-templates/${activeType}/reset`, { method: 'POST' });
        setForm(res.template);
        setConfig((prev) => ({
          ...prev,
          emailTemplates: {
            ...(prev.emailTemplates || {}),
            [activeType]: res.template,
          },
        }));
        notify('✓ Template reset to default.');
      } catch (err) {
        notify('Error resetting template: ' + err.message);
      }
    }
  };

  const handleSendTest = async () => {
    if (!testEmail.trim() || !testEmail.includes('@')) {
      notify('Please enter a valid email address to receive the test dispatch.');
      return;
    }
    setSendingTest(true);
    try {
      const res = await api(`/api/admin/email-templates/${activeType}/test`, {
        method: 'POST',
        body: { targetEmail: testEmail.trim(), templateData: form },
      });
      notify(`✓ Test email dispatched to ${res.recipient}. Status: ${res.dispatch?.status || 'SENT'}`);
    } catch (err) {
      notify('Failed to send test email: ' + err.message);
    } finally {
      setSendingTest(false);
    }
  };

  // Sample data for live preview
  const sampleOrg = branding.orgName || 'APOLLO TYRES LTD';
  const sampleLogo = form.logoUrl || branding.logo || '';
  const sampleData = {
    traineeName: 'Rahul Sharma',
    traineeId: 'TR-APOLLO-001',
    qrId: 'QR-APOLLO-001',
    traineeEmail: 'rahul.sharma@gmail.com',
    hostelName: 'Apollo Campus Block A',
    roomNumber: '102',
    joiningDate: '15/01/2026',
    freeValidityStartDate: '15/01/2026',
    freeValidityEndDate: '15/04/2026',
    organizationName: sampleOrg,
    organizationLogo: sampleLogo,
    idCardAttachment: 'https://hostel.apollotyres.com/#/verify/QR-APOLLO-001',
  };

  const replaceTokens = (str) => {
    if (!str) return '';
    let out = String(str);
    Object.entries(sampleData).forEach(([k, v]) => {
      out = out.split(`{{${k}}}`).join(v || '');
    });
    return out;
  };

  const previewSubject = replaceTokens(form.subject);
  const previewHeading = replaceTokens(form.heading);
  const previewSubheading = replaceTokens(form.subheading);
  const previewBody = replaceTokens(form.bodyText);
  const previewFooter = replaceTokens(form.footerText);

  return (
    <div>
      {/* Template selector tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TEMPLATE_TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm ${activeType === id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveType(id)}
            style={{ fontWeight: 600 }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid-2">
        {/* Editor Form */}
        <Card
          title={`Edit ${TEMPLATE_TABS.find((t) => t[0] === activeType)?.[1]}`}
          sub="Customize email subject, banner heading, accent colors, body copy, and layout."
        >
          <form onSubmit={handleSave}>
            <label className="field-label">Subject Line *</label>
            <input
              className="input"
              value={form.subject || ''}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="e.g. Welcome to {{organizationName}} Hostel — {{traineeName}}"
              required
            />

            <div className="two-col" style={{ marginTop: 14 }}>
              <div>
                <label className="field-label">Banner Heading</label>
                <input
                  className="input"
                  value={form.heading || ''}
                  onChange={(e) => setForm({ ...form, heading: e.target.value })}
                  placeholder="Welcome to Trainee Hostel"
                />
              </div>
              <div>
                <label className="field-label">Banner Subheading</label>
                <input
                  className="input"
                  value={form.subheading || ''}
                  onChange={(e) => setForm({ ...form, subheading: e.target.value })}
                  placeholder="Official Accommodation Allotment"
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
                <label className="field-label">Accent / Highlight Color</label>
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

            <div style={{ marginTop: 16 }}>
              <label className="field-label">Dynamic Placeholders</label>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '2px 0 8px 0' }}>
                Click any tag below to insert it at the end of the message:
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 110, overflowY: 'auto', padding: 4 }}>
                {DYNAMIC_PLACEHOLDERS.map(([token, desc]) => (
                  <button
                    key={token}
                    type="button"
                    className="btn btn-ghost btn-xs"
                    style={{
                      fontSize: 11,
                      background: '#ede9fe',
                      color: '#5b21b6',
                      border: '1px solid #ddd6fe',
                      padding: '3px 8px',
                    }}
                    onClick={() => handleInsertPlaceholder(token)}
                    title={`Insert ${desc}`}
                  >
                    + {token}
                  </button>
                ))}
              </div>
            </div>

            <label className="field-label" style={{ marginTop: 16 }}>
              Email Body Content *
            </label>
            <textarea
              className="input"
              rows={8}
              value={form.bodyText || ''}
              onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
              placeholder="Write your email body message here. Use {{traineeName}}, {{hostelName}}, etc."
              required
            />

            <label className="field-label" style={{ marginTop: 14 }}>Footer Text</label>
            <input
              className="input"
              value={form.footerText || ''}
              onChange={(e) => setForm({ ...form, footerText: e.target.value })}
              placeholder="Hostel Administration Office · Contact: hostel@apollotyres.com"
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
              Dispatch a test rendering of this template to verify email presentation in Outlook, Gmail, or mobile clients.
            </p>
            <div style={{ display: 'flex', gap: 10, maxWidth: 440 }}>
              <input
                className="input"
                type="email"
                placeholder="e.g. admin@apollotyres.com"
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

        {/* Live Email Preview */}
        <Card title="Live Email Preview" sub="Real-time preview rendered with sample Apollo Tyres Ltd data.">
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              overflow: 'hidden',
              background: '#ffffff',
              boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
            }}
          >
            {/* Mock Subject Bar */}
            <div
              style={{
                background: '#f8fafc',
                padding: '10px 16px',
                borderBottom: '1px solid #e2e8f0',
                fontSize: 12.5,
                color: '#334155',
              }}
            >
              <div><strong>Subject:</strong> {previewSubject}</div>
              <div style={{ marginTop: 2, fontSize: 11.5, color: '#64748b' }}>
                <strong>To:</strong> rahul.sharma@gmail.com (Trainee)
              </div>
            </div>

            {/* Email Header Banner */}
            <div
              style={{
                background: form.headerBg || '#2E1065',
                color: '#ffffff',
                padding: '18px 22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '0.01em' }}>
                  {previewHeading}
                </div>
                <div style={{ fontSize: 12, color: '#ddd6fe', marginTop: 3 }}>
                  {previewSubheading || `${sampleOrg} — Trainee Hostel Operations`}
                </div>
              </div>
              {sampleLogo ? (
                <img
                  src={sampleLogo}
                  alt="Logo"
                  style={{ maxHeight: 38, maxWidth: 110, objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: 13, fontWeight: 700, color: '#ddd6fe' }}>{sampleOrg}</span>
              )}
            </div>

            {/* Email Content Body */}
            <div style={{ padding: 22 }}>
              <div
                style={{
                  fontSize: 14,
                  color: '#1e293b',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-line',
                  marginBottom: 16,
                }}
              >
                {previewBody}
              </div>

              {/* Trainee Details Highlight Box */}
              <div
                style={{
                  background: '#f8fafc',
                  borderLeft: `4px solid ${form.accentColor || '#7C3AED'}`,
                  padding: '14px 18px',
                  borderRadius: 6,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                <div><strong>Trainee:</strong> Rahul Sharma (<span style={{ fontFamily: 'monospace', fontWeight: 700, color: form.accentColor || '#7C3AED' }}>TR-APOLLO-001</span>)</div>
                <div style={{ marginTop: 4 }}><strong>Hostel & Room:</strong> Apollo Campus Block A · Room 102</div>
                <div style={{ marginTop: 4 }}><strong>Free Stay Period:</strong> 15/01/2026 → 15/04/2026 (3 Months)</div>
              </div>

              {/* Mock Action Badge / Link */}
              <div style={{ margin: '22px 0', textAlign: 'center' }}>
                <div
                  style={{
                    background: form.accentColor || '#7C3AED',
                    color: '#ffffff',
                    padding: '11px 22px',
                    borderRadius: 8,
                    display: 'inline-block',
                    fontWeight: 700,
                    fontSize: 13.5,
                  }}
                >
                  View Digital ID Card & Details →
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  borderTop: '1px solid #f1f5f9',
                  paddingTop: 14,
                  fontSize: 11.5,
                  color: '#94a3b8',
                  textAlign: 'center',
                }}
              >
                {previewFooter || 'Hostel Administration Office · Security & Compliance'}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Email Delivery History & Audit Logs ---------------- */
function EmailDeliveryHistory() {
  const { notify } = useStore();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [retryingId, setRetryingId] = useState(null);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const res = await api('/api/admin/email-logs');
      setLogs(res.logs || []);
    } catch (err) {
      notify('Failed to load email logs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleRetryWelcome = async (traineeId) => {
    if (!traineeId) return;
    setRetryingId(traineeId);
    try {
      const res = await api(`/api/trainees/${traineeId}/send-welcome-email`, { method: 'POST' });
      notify(`✓ Welcome email re-dispatched for ${traineeId}. Status: ${res.dispatch?.status || 'SENT'}`);
      loadLogs();
    } catch (err) {
      notify('Failed to retry welcome email: ' + err.message);
    } finally {
      setRetryingId(null);
    }
  };

  const filteredLogs = logs.filter((l) => {
    if (filterType !== 'ALL' && l.type !== filterType) return false;
    if (filterStatus !== 'ALL' && l.status !== filterStatus) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const matchTo = (l.to || '').toLowerCase().includes(q);
      const matchSub = (l.subject || '').toLowerCase().includes(q);
      const matchName = (l.traineeName || '').toLowerCase().includes(q);
      const matchTid = (l.traineeId || '').toLowerCase().includes(q);
      if (!matchTo && !matchSub && !matchName && !matchTid) return false;
    }
    return true;
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text)' }}>
            Email Delivery History ({filteredLogs.length})
          </h3>
          <p style={{ margin: '2px 0 0 0', fontSize: 13, color: 'var(--muted)' }}>
            Complete audit trail of automated welcome emails, ID cards, approvals, and system notifications.
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={loadLogs} disabled={loading}>
          <Icon name="refresh" size={14} /> Refresh Logs
        </button>
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Search by trainee, email, or subject…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select
          className="input"
          style={{ width: 'auto' }}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="ALL">All Email Types</option>
          <option value="WELCOME">Welcome Email</option>
          <option value="ID_CARD">ID Card Email</option>
          <option value="ID_CARD_UPDATED">ID Card Updated</option>
          <option value="APPROVAL">Approval Request</option>
          <option value="TEST">Test Preview</option>
        </select>
        <select
          className="input"
          style={{ width: 'auto' }}
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
        >
          <option value="ALL">All Statuses</option>
          <option value="SENT">Sent</option>
          <option value="FAILED">Failed</option>
        </select>
      </div>

      {loading ? (
        <Card>
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
            Loading email logs…
          </div>
        </Card>
      ) : filteredLogs.length === 0 ? (
        <Card>
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
            No email delivery logs match the selected filters.
          </div>
        </Card>
      ) : (
        <Table
          headers={['Sent Time', 'Workflow / Type', 'Trainee', 'Recipient (TO / CC)', 'Subject', 'Status', 'Actions']}
          rows={filteredLogs.map((l) => [
            <span key="time" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
              {fmtDate(l.sentAt)} {l.sentAt ? new Date(l.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            </span>,
            <Badge
              key="type"
              tone={
                l.type === 'WELCOME' ? 'primary'
                  : l.type === 'ID_CARD' ? 'accent'
                  : l.type === 'APPROVAL' ? 'warning'
                  : 'neutral'
              }
            >
              {l.type}
            </Badge>,
            <div key="trainee">
              {l.traineeName ? (
                <>
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{l.traineeName}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', fontFamily: 'monospace' }}>{l.traineeId}</div>
                </>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
              )}
            </div>,
            <div key="to">
              <div style={{ fontSize: 12.5, color: 'var(--text)' }}>{l.to}</div>
              {l.cc && l.cc.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  CC: {Array.isArray(l.cc) ? l.cc.join(', ') : l.cc}
                </div>
              )}
              {l.bcc && l.bcc.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  BCC: {Array.isArray(l.bcc) ? l.bcc.join(', ') : l.bcc}
                </div>
              )}
            </div>,
            <span key="sub" style={{ fontSize: 12.5, color: 'var(--text)' }} title={l.subject}>
              {(l.subject || '').slice(0, 48)}{(l.subject || '').length > 48 ? '…' : ''}
            </span>,
            <div key="status">
              <Badge tone={l.status === 'SENT' ? 'success' : 'danger'}>
                {l.status}
              </Badge>
              {l.error && (
                <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2, maxWidth: 160 }} title={l.error}>
                  {l.error.slice(0, 40)}…
                </div>
              )}
            </div>,
            <div key="actions">
              {l.type === 'WELCOME' && l.traineeId ? (
                <button
                  className="btn btn-ghost btn-xs"
                  onClick={() => handleRetryWelcome(l.traineeId)}
                  disabled={retryingId === l.traineeId}
                  title="Re-send Welcome Email"
                >
                  <Icon name="refresh" size={12} /> {retryingId === l.traineeId ? 'Sending…' : 'Retry'}
                </button>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>—</span>
              )}
            </div>,
          ])}
        />
      )}
    </div>
  );
}

/* ---------------- Combined Email Management Container ---------------- */
function EmailManagement() {
  const [subTab, setSubTab] = useState('admin-email');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12, flexWrap: 'wrap' }}>
        <button
          className={`btn btn-sm ${subTab === 'admin-email' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('admin-email')}
          style={{ fontWeight: 600 }}
        >
          <Icon name="sliders" size={14} /> Admin Notification Email
        </button>
        <button
          className={`btn btn-sm ${subTab === 'recipients' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('recipients')}
          style={{ fontWeight: 600 }}
        >
          <Icon name="users" size={14} /> Recipient Management
        </button>
        <button
          className={`btn btn-sm ${subTab === 'templates' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('templates')}
          style={{ fontWeight: 600 }}
        >
          <Icon name="edit" size={14} /> Template Editor
        </button>
        <button
          className={`btn btn-sm ${subTab === 'history' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('history')}
          style={{ fontWeight: 600 }}
        >
          <Icon name="clock" size={14} /> Delivery History & Logs
        </button>
      </div>

      {subTab === 'admin-email' && <AdminNotificationEmailConfig />}
      {subTab === 'recipients' && (
        <>
          <div style={{ marginBottom: 20 }}>
            <AdminNotificationEmailConfig />
          </div>
          <EmailRecipientManagement />
        </>
      )}
      {subTab === 'templates' && <EmailTemplateEditor />}
      {subTab === 'history' && <EmailDeliveryHistory />}
    </div>
  );
}

/* ---------------- Combined Users & Roles Container ---------------- */
function UsersAndRoles() {
  const [subTab, setSubTab] = useState('users');
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
        <button
          className={`btn btn-sm ${subTab === 'users' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('users')}
          style={{ fontWeight: 600 }}
        >
          <Icon name="user" size={14} /> Login Members
        </button>
        <button
          className={`btn btn-sm ${subTab === 'roles' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setSubTab('roles')}
          style={{ fontWeight: 600 }}
        >
          <Icon name="shield" size={14} /> Role Permissions
        </button>
      </div>

      {subTab === 'users' ? <Users /> : <Roles />}
    </div>
  );
}

/* ---------------- Reorganized Admin Console Tabs ---------------- */
const CONSOLE_TABS = [
  ['email', 'Email Management'],
  ['branding', 'Organization Branding'],
  ['idcard', 'ID Card Design'],
  ['users', 'Users & Roles'],
  ['approvers', 'Approvers Configuration'],
  ['hostels', 'Hostels & Rooms'],
  ['look', 'Appearance'],
  ['pages', 'Pages & Fields'],
];

export default function Console() {
  const { isSuper } = useStore();
  const [tab, setTab] = useState('email');

  if (!isSuper) {
    return (
      <Card title="Access Restricted" sub="Admin Console requires Super Administrator permissions.">
        <div style={{ padding: 24, textAlign: 'center', color: '#dc2626' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔒</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Super Administrator Access Only</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
            You do not have permission to modify system configurations, email recipients, or hostel settings.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="tabbar scroll-x">
        {CONSOLE_TABS.map(([id, label]) => (
          <button
            key={id}
            className={`tab ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'email' ? <EmailManagement />
        : tab === 'branding' ? <OrganizationBranding />
        : tab === 'idcard' ? <IdCardDesignSettings />
        : tab === 'users' ? <UsersAndRoles />
        : tab === 'approvers' ? <Approvers />
        : tab === 'hostels' ? <Hostels />
        : tab === 'look' ? <Appearance />
        : <PagesAndFields />}
    </>
  );
}
