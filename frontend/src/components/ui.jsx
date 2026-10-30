import { useState } from 'react';
import { STATUS_COLOR } from '../data/constants.js';

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17.3" cy="9.2" r="2.4"/><path d="M14.9 20c.3-2.6 1.9-4.6 4.1-5.1"/>',
  userPlus: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><line x1="18" y1="8" x2="18" y2="14"/><line x1="15" y1="11" x2="21" y2="11"/>',
  checkSquare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>',
  calendarX: '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="14" x2="13" y2="18"/><line x1="13" y1="14" x2="9" y2="18"/>',
  arrowBox: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="12" x2="15" y2="12"/><path d="M12 8l4 4-4 4"/>',
  doorExit: '<path d="M15 3H6a2 2 0 00-2 2v14a2 2 0 002 2h9"/><line x1="10" y1="12" x2="21" y2="12"/><path d="M17 8l4 4-4 4"/>',
  message: '<path d="M4 4h16v12H8l-4 4V4z"/>',
  bar: '<line x1="4" y1="20" x2="4" y2="10"/><line x1="10" y1="20" x2="10" y2="4"/><line x1="16" y1="20" x2="16" y2="13"/><line x1="3" y1="21" x2="21" y2="21"/>',
  settings: '<circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="2"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="5" y1="12" x2="2" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="7.05" y1="7.05" x2="4.9" y2="4.9"/><line x1="16.95" y1="16.95" x2="19.1" y2="19.1"/><line x1="7.05" y1="16.95" x2="4.9" y2="19.1"/><line x1="16.95" y1="7.05" x2="19.1" y2="4.9"/>',
  search: '<circle cx="10" cy="10" r="7"/><line x1="16" y1="16" x2="21" y2="21"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="15" y="15" width="2.2" height="2.2"/><rect x="18.8" y="15" width="2.2" height="2.2"/><rect x="15" y="18.8" width="2.2" height="2.2"/><rect x="18.8" y="18.8" width="2.2" height="2.2"/>',
  logout: '<path d="M15 3H6a2 2 0 00-2 2v14a2 2 0 002 2h9"/><line x1="10" y1="12" x2="21" y2="12"/><path d="M17 8l4 4-4 4"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  bed: '<rect x="3" y="10" width="18" height="8" rx="1"/><path d="M3 10V6a2 2 0 012-2h4a2 2 0 012 2v4"/><line x1="3" y1="18" x2="3" y2="20"/><line x1="21" y1="18" x2="21" y2="20"/>',
  edit: '<path d="M4 20h4l11-11-4-4L4 16v4z"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  x: '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="4" y="9" width="16" height="8"/><path d="M6 17h12v4H6z"/>',
  check: '<path d="M4 12l5 5 11-11"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3"/><path d="M20 8V5a1 1 0 00-1-1h-3"/><path d="M4 16v3a1 1 0 001 1h3"/><path d="M20 16v3a1 1 0 01-1 1h-3"/><line x1="4" y1="12" x2="20" y2="12"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  sliders: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  alert: '<path d="M12 3l10 18H2z"/><line x1="12" y1="10" x2="12" y2="15"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  idCard: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><line x1="15" y1="8" x2="17" y2="8"/><line x1="15" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="17" y2="16"/>',
};

export function Icon({ name, size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} className="icon" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] || '' }}
    />
  );
}

export function Badge({ status }) {
  return <span className={`badge badge-${STATUS_COLOR[status] || 'gray'}`}>{status}</span>;
}

/** Trainee photo with a purple initial fallback (works offline / if the photo URL breaks). */
export function Avatar({ trainee, size = 'sm' }) {
  const [broken, setBroken] = useState(false);
  const cls = `avatar-${size}`;
  if (!trainee.photo || broken) {
    return <div className={`${cls} avatar-fallback`}>{(trainee.name || '?').charAt(0)}</div>;
  }
  return <img className={cls} src={trainee.photo} alt="" onError={() => setBroken(true)} />;
}

export function Table({ headers, rows, empty = 'No records found.', rowClass }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i} className={rowClass ? rowClass(i) : undefined}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))
          ) : (
            <tr><td colSpan={headers.length} className="empty-cell">{empty}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Card({ title, sub, action, children, noPad }) {
  return (
    <div className="card">
      {(title || action) && (
        <div className="card-head">
          <div className="card-title">{title}</div>
          {sub && <div className="card-sub">{sub}</div>}
          {action}
        </div>
      )}
      <div className={`card-body ${noPad ? 'no-pad' : ''}`}>{children}</div>
    </div>
  );
}

export function Modal({ title, onClose, onSubmit, submitLabel = 'Save', action, actions, children }) {
  const extraAction = action || actions;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          if (onSubmit) onSubmit(e);
        }}
      >
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button type="button" className="icon-btn" onClick={onClose}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-foot">
          {extraAction}
          <button type="button" className="btn btn-ghost" onClick={onClose}>{onSubmit ? 'Cancel' : 'Close'}</button>
          {onSubmit && (
            <button type="submit" className="btn btn-primary"><Icon name="check" size={15} /> {submitLabel}</button>
          )}
        </div>
      </form>
    </div>
  );
}

/** Trainee ID text box with a searchable dropdown of all trainees. */
export function TraineeIdInput({ trainees, defaultValue = '', name = 'traineeId' }) {
  return (
    <>
      <input className="input" name={name} list="trainee-ids" defaultValue={defaultValue} required />
      <datalist id="trainee-ids">
        {trainees.map((t) => <option key={t.traineeId} value={t.traineeId}>{t.name}</option>)}
      </datalist>
    </>
  );
}

export const formData = (e) => Object.fromEntries(new FormData(e.target));
