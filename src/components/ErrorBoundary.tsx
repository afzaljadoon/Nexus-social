import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in component tree:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          width: '100vw',
          backgroundColor: 'var(--bg-primary, #090f1e)',
          color: 'var(--text-primary, #f3f4f6)',
          fontFamily: 'sans-serif',
          padding: '24px',
          textAlign: 'center',
          boxSizing: 'border-box'
        }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: '24px',
            padding: '40px',
            maxWidth: '480px',
            width: '100%',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)'
          }}>
            <span style={{ fontSize: '48px', marginBottom: '16px', display: 'block' }}>⚠️</span>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 12px 0', color: '#ef4444' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted, #9ca3af)', margin: '0 0 24px 0', lineHeight: '1.5' }}>
              An unexpected error occurred. You can try refreshing the page or contact support if the issue persists.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="btn btn-primary"
              style={{
                width: '100%',
                height: '42px',
                borderRadius: '10px',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
                background: 'linear-gradient(135deg, var(--color-primary, #06b6d4) 0%, var(--color-secondary, #3b82f6) 100%)',
                color: '#fff'
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.children;
  }
}
export default ErrorBoundary;
