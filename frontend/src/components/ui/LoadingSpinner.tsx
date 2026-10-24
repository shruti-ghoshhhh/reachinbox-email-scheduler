'use client';

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
}

export default function LoadingSpinner({ size = 20, className = '' }: LoadingSpinnerProps) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid var(--hairline)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  );
}

export function FullPageLoader() {
  return (
    <div
      className="full-page-loader"
      role="status"
      aria-busy="true"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: '3px solid var(--hairline)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <span className="visually-hidden">Loading</span>
    </div>
  );
}
