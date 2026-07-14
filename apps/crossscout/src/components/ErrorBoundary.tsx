import { Component } from 'react';
import type { ReactNode } from 'react';

interface ErrorBoundaryProps {
  /** Changing this key (e.g. on navigation) clears a caught failure. */
  resetKey: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time throws (malformed indexer data surfaces as exceptions by
 * design) so the shell, navigation and search stay usable; navigating to any
 * other route resets the failed subtree.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="no-results" role="alert">
          this page failed to render: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}
