import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tStatic } from '../lib/i18n';

/** A render error shows a friendly message and a reload button instead of a blank page.
 *  `onError` reports it (staff app); the viewer passes none, since it never writes. */
export class ErrorBoundary extends Component<{ children: ReactNode; onError?: (error: Error, info: ErrorInfo) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try { this.props.onError?.(error, info); } catch { /* reporting only */ }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page">
        <div className="notice" role="alert">
          <p><strong>{tStatic('errorBoundaryTitle')}</strong></p>
          <p>{tStatic('errorBoundaryText')}</p>
          <button className="primary" onClick={() => window.location.reload()}>{tStatic('reloadPage')}</button>
        </div>
      </main>
    );
  }
}
