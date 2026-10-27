// ErrorBoundary.jsx ─────────────────────────────────────────────────────────
// Catches a render error in the current page so it shows a message and a way
// back instead of unmounting the whole app to a blank white screen. App keys it
// by the page on screen, so navigating anywhere starts fresh.
import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ui] page crashed:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page-body">
        <div style={{
          maxWidth: 520, margin: '40px auto', padding: 20, borderRadius: 8, textAlign: 'center',
          background: 'var(--bg-1, #fff)', border: '1px solid var(--border, #E2E8F0)',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fault, #DC2626)', marginBottom: 6 }}>
            This page couldn&rsquo;t be displayed
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-2, #475569)', marginBottom: 12 }}>
            {String(error?.message ?? error)}
          </div>
          <button type="button" className="back-btn"
                  onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }
}
