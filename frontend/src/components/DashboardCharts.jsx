import React, { useState } from 'react';

/**
 * Apollo Tyres Enterprise Violet / Purple Palette
 */
const THEME = {
  purple900: '#2E1065',
  purple800: '#4C1D95',
  purple700: '#5B21B6',
  purple600: '#6D28D9',
  purple500: '#7C3AED',
  purple400: '#8B5CF6',
  purple300: '#A78BFA',
  purple200: '#DDD6FE',
  purple100: '#EDE9FE',
  green: '#16A34A',
  amber: '#D97706',
  red: '#DC2626',
  gray200: '#E2E8F0',
  gray600: '#475569',
};

// ---------------- Chart 1: Hostel Occupancy Comparison (Grouped Bar) ----------------
export function HostelOccupancyChart({ data = [] }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No hostel occupancy data available.</div>;
  }

  const maxVal = Math.max(10, ...data.map((d) => Math.max(d.cap || 0, d.occupied || 0)));
  const h = 200;
  const w = 460;
  const paddingX = 40;
  const paddingY = 30;
  const chartW = w - paddingX * 2;
  const chartH = h - paddingY * 2;
  const groupW = chartW / data.length;
  const barW = Math.min(22, (groupW - 12) / 2);

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', minWidth: 320, display: 'block' }}>
        {/* Grid lines */}
        {[0, 0.5, 1].map((pct, i) => {
          const y = paddingY + chartH * (1 - pct);
          const val = Math.round(maxVal * pct);
          return (
            <g key={i}>
              <line x1={paddingX} y1={y} x2={w - paddingX} y2={y} stroke={THEME.gray200} strokeDasharray="3 3" />
              <text x={paddingX - 6} y={y + 3} textAnchor="end" fontSize="10" fill={THEME.gray600}>
                {val}
              </text>
            </g>
          );
        })}

        {/* Grouped Bars */}
        {data.map((d, i) => {
          const groupCenterX = paddingX + i * groupW + groupW / 2;
          const capH = (d.cap / maxVal) * chartH;
          const occH = (d.occupied / maxVal) * chartH;
          const capX = groupCenterX - barW - 2;
          const occX = groupCenterX + 2;
          const capY = paddingY + chartH - capH;
          const occY = paddingY + chartH - occH;

          return (
            <g key={d.name || i}>
              <title>{`${d.name}: ${d.occupied} occupied / ${d.cap} capacity (${d.pct}%)`}</title>
              {/* Capacity bar (light violet) */}
              <rect x={capX} y={capY} width={barW} height={capH} rx="3" fill={THEME.purple200} />
              {/* Occupied bar (deep violet) */}
              <rect x={occX} y={occY} width={barW} height={occH} rx="3" fill={THEME.purple600} />
              {/* X Axis Label */}
              <text x={groupCenterX} y={h - 10} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={THEME.gray600}>
                {d.name.length > 12 ? d.name.slice(0, 11) + '…' : d.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 6, fontSize: 11.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: THEME.purple600 }} /> Occupied Beds
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: THEME.purple200 }} /> Total Capacity
        </span>
      </div>
    </div>
  );
}

// ---------------- Chart 2: Free vs Paid Stay Distribution (Donut Chart) ----------------
export function FreeVsPaidDonutChart({ free = 0, paid = 0 }) {
  const total = free + paid;
  const [hovered, setHovered] = useState(null);

  if (total === 0) {
    return <div className="empty-state">No active trainee stay data available.</div>;
  }

  const freePct = Math.round((free / total) * 100);
  const paidPct = 100 - freePct;

  const r = 60;
  const cx = 90;
  const cy = 90;
  const strokeW = 28;
  const circum = 2 * Math.PI * r;
  const freeStroke = (freePct / 100) * circum;
  const paidStroke = circum - freeStroke;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 14, flexWrap: 'wrap' }}>
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F3E8FF" strokeWidth={strokeW} />
        {/* Paid Slice */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={THEME.amber}
          strokeWidth={strokeW}
          strokeDasharray={`${paidStroke} ${circum}`}
          strokeDashoffset={-freeStroke}
          style={{ transition: 'stroke-width .2s', cursor: 'pointer' }}
          onMouseEnter={() => setHovered('PAID')}
          onMouseLeave={() => setHovered(null)}
        />
        {/* Free Slice */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={THEME.purple600}
          strokeWidth={strokeW}
          strokeDasharray={`${freeStroke} ${circum}`}
          strokeDashoffset="0"
          style={{ transition: 'stroke-width .2s', cursor: 'pointer' }}
          onMouseEnter={() => setHovered('FREE')}
          onMouseLeave={() => setHovered(null)}
        />
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="16" fontWeight="800" fill={THEME.purple900}>
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill={THEME.gray600}>
          TRAINEES
        </text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: THEME.purple600 }} />
          <div>
            <strong>Free Stay:</strong> {free} ({freePct}%)
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: THEME.amber }} />
          <div>
            <strong>Paid Stay:</strong> {paid} ({paidPct}%)
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Chart 3: Available Beds by Hostel Block (Bar Chart) ----------------
export function AvailableBedsBarChart({ data = [] }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No bed vacancy data available.</div>;
  }

  const maxVal = Math.max(5, ...data.map((d) => d.freeBeds || 0));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d) => {
        const pct = Math.min(100, Math.round(((d.freeBeds || 0) / maxVal) * 100));
        return (
          <div key={d.name}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <strong>{d.name}</strong>
              <span style={{ color: THEME.purple700, fontWeight: 700 }}>
                {d.freeBeds} Free Bed{d.freeBeds !== 1 ? 's' : ''} ({d.freePct || 0}% vacant)
              </span>
            </div>
            <div style={{ width: '100%', height: 14, background: THEME.gray200, borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: `linear-gradient(90deg, ${THEME.purple500}, ${THEME.purple400})`,
                  borderRadius: 6,
                  transition: 'width .3s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Chart 4: 7-Day Attendance Trend (Smooth SVG Line Chart) ----------------
export function AttendanceTrendLineChart({ data = [] }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No 7-day attendance trend records available.</div>;
  }

  const w = 460;
  const h = 180;
  const padX = 36;
  const padY = 24;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;
  const maxVal = Math.max(10, ...data.map((d) => d.count || 0));

  const points = data.map((d, i) => {
    const x = padX + (i / Math.max(1, data.length - 1)) * chartW;
    const y = padY + chartH - ((d.count || 0) / maxVal) * chartH;
    return { x, y, count: d.count, label: d.label };
  });

  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaStr = `${points[0].x},${padY + chartH} ` + polylineStr + ` ${points[points.length - 1].x},${padY + chartH}`;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', minWidth: 320, display: 'block' }}>
        <defs>
          <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={THEME.purple500} stopOpacity="0.35" />
            <stop offset="100%" stopColor={THEME.purple500} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Area Fill */}
        <polygon points={areaStr} fill="url(#attGrad)" />

        {/* Line Stroke */}
        <polyline points={polylineStr} fill="none" stroke={THEME.purple600} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {/* Data Circles & Value Labels */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4.5" fill="#FFFFFF" stroke={THEME.purple700} strokeWidth="2.5" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="10" fontWeight="700" fill={THEME.purple900}>
              {p.count}
            </text>
            <text x={p.x} y={h - 6} textAnchor="middle" fontSize="10" fill={THEME.gray600}>
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------------- Chart 5: Shift-wise Attendance (Bar Chart) ----------------
export function ShiftAttendanceChart({ data = [] }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No shift attendance records for today.</div>;
  }

  const maxVal = Math.max(5, ...data.map((d) => d.count || 0));

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: 160, paddingTop: 20 }}>
      {data.map((d) => {
        const heightPct = Math.max(8, Math.round((d.count / maxVal) * 100));
        return (
          <div key={d.shift} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 44 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: THEME.purple900, marginBottom: 4 }}>
              {d.count}
            </span>
            <div
              style={{
                width: 28,
                height: `${heightPct}%`,
                maxHeight: 110,
                background: d.count > 0 ? THEME.purple600 : THEME.gray200,
                borderRadius: '5px 5px 0 0',
                transition: 'height .3s ease',
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 600, color: THEME.gray600, marginTop: 6 }}>
              {d.label || d.shift}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Chart 6: Monthly Joining Trends (Area Chart) ----------------
export function MonthlyJoiningChart({ data = [] }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No historical onboarding trend records available.</div>;
  }

  const w = 460;
  const h = 180;
  const padX = 36;
  const padY = 24;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;
  const maxVal = Math.max(5, ...data.map((d) => d.count || 0));

  const points = data.map((d, i) => {
    const x = padX + (i / Math.max(1, data.length - 1)) * chartW;
    const y = padY + chartH - ((d.count || 0) / maxVal) * chartH;
    return { x, y, count: d.count, month: d.month };
  });

  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ');
  const areaStr = `${points[0].x},${padY + chartH} ` + polylineStr + ` ${points[points.length - 1].x},${padY + chartH}`;

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', minWidth: 320, display: 'block' }}>
        <defs>
          <linearGradient id="joinGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={THEME.purple400} stopOpacity="0.4" />
            <stop offset="100%" stopColor={THEME.purple400} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        <polygon points={areaStr} fill="url(#joinGrad)" />
        <polyline points={polylineStr} fill="none" stroke={THEME.purple700} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4.5" fill="#FFFFFF" stroke={THEME.purple600} strokeWidth="2.5" />
            <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={THEME.purple900}>
              {p.count}
            </text>
            <text x={p.x} y={h - 6} textAnchor="middle" fontSize="10" fill={THEME.gray600}>
              {p.month}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ---------------- Chart 7: Leave vs Outing Daily Distribution (Grouped Bar) ----------------
export function LeaveVsOutingChart({ data = [] }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No leave or outing operational activity recorded.</div>;
  }

  const maxVal = Math.max(5, ...data.map((d) => Math.max(d.leaves || 0, d.outings || 0)));
  const w = 460;
  const h = 180;
  const padX = 36;
  const padY = 24;
  const chartW = w - padX * 2;
  const chartH = h - padY * 2;
  const groupW = chartW / data.length;
  const barW = Math.min(18, (groupW - 10) / 2);

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto', minWidth: 320, display: 'block' }}>
        {data.map((d, i) => {
          const groupCenterX = padX + i * groupW + groupW / 2;
          const leaveH = (d.leaves / maxVal) * chartH;
          const outingH = (d.outings / maxVal) * chartH;
          const leaveX = groupCenterX - barW - 2;
          const outingX = groupCenterX + 2;

          return (
            <g key={d.date || i}>
              <title>{`${d.label}: ${d.leaves} Leaves, ${d.outings} Outings`}</title>
              {/* Leaves Bar */}
              <rect x={leaveX} y={padY + chartH - leaveH} width={barW} height={leaveH} rx="2" fill={THEME.amber} />
              {/* Outings Bar */}
              <rect x={outingX} y={padY + chartH - outingH} width={barW} height={outingH} rx="2" fill={THEME.purple600} />
              {/* Date Label */}
              <text x={groupCenterX} y={h - 6} textAnchor="middle" fontSize="10" fill={THEME.gray600}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 4, fontSize: 11.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: THEME.amber }} /> Leaves Taken
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: THEME.purple600 }} /> Outings Logged
        </span>
      </div>
    </div>
  );
}

// ---------------- Chart 8: Free Stay Expiry Timeline (Next 30 Days Bar) ----------------
export function FreeStayExpiryTimelineChart({ data = { critical: 0, approaching: 0, upcoming: 0, safe: 0 } }) {
  const buckets = [
    { label: '0 – 7 Days (Urgent)', count: data.critical || 0, color: THEME.red },
    { label: '8 – 15 Days (Approaching)', count: data.approaching || 0, color: THEME.amber },
    { label: '16 – 30 Days (Upcoming)', count: data.upcoming || 0, color: THEME.purple500 },
    { label: '30+ Days (Safe)', count: data.safe || 0, color: THEME.green },
  ];

  const total = buckets.reduce((s, b) => s + b.count, 0);
  const maxVal = Math.max(5, ...buckets.map((b) => b.count));

  if (total === 0) {
    return <div className="empty-state">No free stay validity records found.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {buckets.map((b) => {
        const pct = Math.round((b.count / maxVal) * 100);
        return (
          <div key={b.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{b.label}</span>
              <strong style={{ color: b.color }}>{b.count} Trainee{b.count !== 1 ? 's' : ''}</strong>
            </div>
            <div style={{ width: '100%', height: 12, background: THEME.gray200, borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: b.color,
                  borderRadius: 6,
                  transition: 'width .3s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Chart 9: Overall Room Occupancy Radial Gauge ----------------
export function OccupancyRadialGauge({ occupied = 0, capacity = 0 }) {
  const pct = capacity > 0 ? Math.min(100, Math.round((occupied / capacity) * 100)) : 0;
  const color = pct >= 95 ? THEME.red : pct >= 85 ? THEME.amber : THEME.purple600;

  const r = 58;
  const cx = 80;
  const cy = 80;
  const strokeW = 16;
  const circum = 2 * Math.PI * r;
  const strokeDash = (pct / 100) * circum;

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: 14 }}>
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#F1F5F9" strokeWidth={strokeW} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={`${strokeDash} ${circum}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray .5s ease' }}
        />
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="22" fontWeight="800" fill={THEME.purple900}>
          {pct}%
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={THEME.gray600}>
          OCCUPIED
        </text>
      </svg>
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div>
          <span className="muted">Occupied:</span> <strong>{occupied} Beds</strong>
        </div>
        <div>
          <span className="muted">Capacity:</span> <strong>{capacity} Beds</strong>
        </div>
        <div>
          <span className="muted">Vacant:</span> <strong>{Math.max(0, capacity - occupied)} Beds</strong>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className="chip" style={{ background: pct >= 90 ? '#FEE2E2' : '#EDE9FE', color: color, fontWeight: 700 }}>
            {pct >= 95 ? 'Critically Full' : pct >= 85 ? 'High Occupancy' : 'Optimal Capacity'}
          </span>
        </div>
      </div>
    </div>
  );
}
