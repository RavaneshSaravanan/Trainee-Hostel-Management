import { useState } from 'react';
import { useStore } from '../store.jsx';
import { Icon } from './ui.jsx';

import { CONSOLE_PAGE, PAGES } from '../data/defaults.js';
import { isComplete } from '../utils/details.js';

/** Sidebar items = built-in pages + the Super Admin's renames / hide / order (config.pages), limited by role. */
export function navItems(config, can) {
  const items = PAGES.map((p, i) => {
    const o = config.pages[p.id] || {};
    return { ...p, label: o.label || p.label, visible: o.visible !== false, order: o.order ?? i };
  }).filter((p) => p.visible && can(p.id)).sort((a, b) => a.order - b.order);
  return can('console') ? [...items, CONSOLE_PAGE] : items;
}

export default function Layout({ children }) {
  const { session, route, navigate, logout, getTrainee, db, config, can, roleName, syncError } = useStore();
  const NAV = navItems(config, can);
  const pendingDetails = db.trainees.filter((t) => t.hostelStatus !== 'INACTIVE' && t.employmentStatus === 'ACTIVE' && !isComplete(t, config.customFields)).length;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const activeId = route.view === 'trainee-profile' ? 'trainees' : route.view;
  const title = route.view === 'trainee-profile' ? 'Trainee Profile' : (NAV.find((n) => n.id === activeId) || {}).label;

  // Primary search = Trainee ID. Exact ID (or single match) opens the profile directly.
  const search = () => {
    const query = q.trim();
    if (!query) return;
    const exact = getTrainee(query.toUpperCase()) || getTrainee(query);
    if (exact) { navigate('trainee-profile', { id: exact.traineeId }); setQ(''); return; }
    const lc = query.toLowerCase();
    const matches = db.trainees.filter((t) =>
      [t.traineeId, t.hostelId, t.name, t.mobile, t.hostel, t.roomNo].some((v) => String(v || '').toLowerCase().includes(lc))
    );
    if (matches.length === 1) navigate('trainee-profile', { id: matches[0].traineeId });
    else navigate('trainees', { q: query });
    setQ('');
  };

  const go = (id) => { navigate(id); setOpen(false); };

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="side-brand">
          <div className="brand-mark small">{config.logo ? <img src={config.logo} alt="" className="brand-logo" /> : <Icon name="home" size={20} />}</div>
          <div>
            <div className="side-brand-title">{config.appName}</div>
            <div className="side-brand-sub">{config.appSub}</div>
          </div>
        </div>
        <nav className="side-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`side-link ${activeId === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
              <Icon name={n.icon} size={18} /><span>{n.label}</span>
              {n.id === 'trainees' && pendingDetails > 0 && <span className="nav-badge" title="Trainees with pending details">{pendingDetails}</span>}
            </button>
          ))}
        </nav>
        <div className="side-user">
          <div className="side-user-avatar">{session.name.charAt(0).toUpperCase()}</div>
          <div className="side-user-info">
            <div className="side-user-role">{roleName.toUpperCase()}</div>
            <div className="side-user-name">{session.name}</div>
          </div>
          <button className="icon-btn" title="Log out" onClick={logout}><Icon name="logout" size={17} /></button>
        </div>
      </aside>
      {open && <div className="sidebar-scrim open" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-menu-btn" onClick={() => setOpen(!open)}><Icon name="grid" size={18} /></button>
          <div className="topbar-title">{title}</div>
          <div className="topbar-search">
            <Icon name="search" size={16} />
            <input
              className="topbar-search-input"
              placeholder="Search by Trainee ID, name, mobile, room…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </div>
          <div className="topbar-right">
            <span className="topbar-role-pill">{roleName}</span>
          </div>
        </header>
        <main className="content">
          {syncError && <div className="notice" style={{ color: 'var(--red)' }}>Not saved yet — server unreachable. Retrying… ({syncError})</div>}
          {children}
        </main>
      </div>
    </div>
  );
}
