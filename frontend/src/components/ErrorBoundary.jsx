import React, { Component } from 'react';
import { Icon } from './ui.jsx';

/**
 * Standard React Error Boundary component.
 * Catches runtime rendering errors in child components and displays a clean, user-friendly fallback
 * instead of letting an unhandled exception crash the React tree to a blank white screen.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="card"
          style={{
            padding: 24,
            margin: '16px 0',
            border: '1px solid #fecaca',
            background: '#fff5f5',
            borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ fontSize: 28, lineHeight: 1 }}>⚠️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: '#991b1b', marginBottom: 4 }}>
                {this.props.fallbackTitle || 'Unable to display this view'}
              </div>
              <p style={{ fontSize: 13.5, color: '#b91c1c', margin: '0 0 14px', lineHeight: 1.5 }}>
                {this.state.error?.message || 'An unexpected runtime error occurred while rendering this section.'}
              </p>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                style={{ borderColor: '#f87171', color: '#991b1b', fontWeight: 600 }}
                onClick={this.handleRetry}
              >
                <Icon name="back" size={14} /> Retry View
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
