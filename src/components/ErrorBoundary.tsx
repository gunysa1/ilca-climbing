import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tStatic } from '../lib/i18n';

/** A render error shows a friendly message and a reload button instead of a blank page.
 *  `onError` reports it (staff app); the viewer passes none, since it never writes. */
export class ErrorBoundary extends Component<{ children: ReactNode; onError?: (error: Error, info: ErrorInfo) => void; viewer?: boolean }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try { this.props.onError?.(error, info); } catch { /* reporting only */ }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const Wrapper = this.props.viewer ? 'main' : 'div';
    return (
      // Staff: inside the layout's <main>. Viewer: the boundary is the whole page, so it brings its own.
      <Wrapper className={this.props.viewer ? 'page' : undefined}>
        <div className="notice" role="alert">
          <p><strong>{tStatic('errorBoundaryTitle')}</strong></p>
          <p>{tStatic(this.props.viewer ? 'errorBoundaryTextViewer' : 'errorBoundaryText')}</p>
          <button className="primary" onClick={() => window.location.reload()}>{tStatic('reloadPage')}</button>
        </div>
      </Wrapper>
    );
  }
}
