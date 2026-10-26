import { useState } from 'react';
import { useStore } from '../store.jsx';
import { ASSIGNABLE_PAGES, DEFAULT_CONFIG, FONTS, PAGES, SUPER_ROLE, THEME_PRESETS, WIDGET_LABELS } from '../data/defaults.js';
import { Badge, Card, Icon, Modal, Table } from '../components/ui.jsx';
import { resizeBackground, resizeImage } from '../utils/image.js';

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
    if (!f.email?.trim() && !f.mobile?.trim()) {
      notify('Please enter at least one contact method (Email or Mobile).');
      return;
    }
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
          <label className="field-label">Email ID</label>
          <input className="input" type="email" placeholder="e.g. user@example.com" value={f.email || ''} onChange={set('email')} />
        </div>
        <div>
          <label className="field-label">Mobile Number</label>
          <input className="input" type="tel" placeholder="e.g. 9876543210" value={f.mobile || ''} onChange={set('mobile')} />
        </div>
      </div>
      <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
        * At least one (Email or Mobile) is mandatory for OTP password reset.
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
          <div style={{ alignSelf: 'end' }}>{config.logo && <button className="btn btn-ghost btn-sm" onClick={() => top({ logo: '' })}>Remove logo</button>}</div>
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
      {db.hostels.map((h) => (
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
      ))}
    </>
  );
}

const TABS = [['users', 'Login members'], ['roles', 'Roles'], ['look', 'Look & feel'], ['pages', 'Pages & fields'], ['hostels', 'Hostels & rooms']];
export default function Console() {
  const [tab, setTab] = useState('users');
  return (
    <>
      <div className="tabbar scroll-x">
        {TABS.map(([id, l]) => <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{l}</button>)}
      </div>
      {tab === 'users' ? <Users /> : tab === 'roles' ? <Roles /> : tab === 'look' ? <Appearance /> : tab === 'pages' ? <PagesAndFields /> : <Hostels />}
    </>
  );
}
