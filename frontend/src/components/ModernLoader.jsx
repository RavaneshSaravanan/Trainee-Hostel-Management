import { Icon } from './ui.jsx';

/**
 * Modern Animated Loading Component
 * Theme: Apollo Tyres Ltd Violet / Purple Enterprise Theme
 * Features:
 * - Layered rotating concentric gradient rings
 * - Pulse glow core with subtle brand indicator
 * - Shimmer typography
 * - Real progress bar for bulk upload/processing
 * - Reduced-motion accessibility compliance
 */
export default function ModernLoader({
  type = 'inline', // 'fullscreen' | 'card' | 'inline' | 'progress' | 'button'
  text = 'Loading…',
  sub = '',
  progress = null, // 0 - 100
  stats = null, // { current, total, success, partial, skipped }
  size = 'md', // 'sm' | 'md' | 'lg'
}) {
  if (type === 'button') {
    return (
      <span className="modern-loader-btn-wrap">
        <span className="modern-spinner-btn" />
        {text && <span>{text}</span>}
      </span>
    );
  }

  const isFullscreen = type === 'fullscreen';
  const isProgress = type === 'progress' || progress !== null;

  return (
    <div
      className={`modern-loader-container ${isFullscreen ? 'modern-loader-fullscreen' : ''} ${
        type === 'card' ? 'modern-loader-card' : ''
      }`}
      role="status"
      aria-live="polite"
    >
      <div className={`modern-loader-visual size-${size}`}>
        {/* Layer 1: Outer glowing gradient orbit ring */}
        <div className="modern-orbit-ring ring-outer" />

        {/* Layer 2: Mid counter-rotating faceted ring */}
        <div className="modern-orbit-ring ring-mid" />

        {/* Layer 3: Inner fast-spin gradient ring */}
        <div className="modern-orbit-ring ring-inner" />

        {/* Layer 4: Core glowing pulse indicator with brand mark */}
        <div className="modern-loader-core">
          <div className="modern-core-pulse" />
          <div className="modern-core-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" opacity="0.6" />
            </svg>
          </div>
        </div>
      </div>

      {/* Text block with subtle shimmer */}
      <div className="modern-loader-text-block">
        <div className="modern-loader-title">{text}</div>
        {sub && <div className="modern-loader-sub">{sub}</div>}

        {/* Real Progress Bar */}
        {isProgress && (
          <div className="modern-loader-progress-wrap">
            <div className="modern-loader-progress-track">
              <div
                className="modern-loader-progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, progress || 0))}%` }}
              />
            </div>
            <div className="modern-loader-progress-meta">
              <span>{Math.round(progress || 0)}% Complete</span>
              {stats && (
                <span>
                  Row {stats.current || 0} of {stats.total || 0}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Real Processing Counts Pills */}
        {stats && (
          <div className="modern-loader-stats-pills">
            {stats.success !== undefined && (
              <span className="stats-pill pill-green">✓ {stats.success} Valid</span>
            )}
            {stats.partial !== undefined && (
              <span className="stats-pill pill-amber">⚠️ {stats.partial} Partial</span>
            )}
            {stats.skipped !== undefined && stats.skipped > 0 && (
              <span className="stats-pill pill-red">✕ {stats.skipped} Skipped</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
