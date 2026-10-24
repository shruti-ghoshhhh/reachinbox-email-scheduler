'use client';

import { Mail, Send } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: 'scheduled' | 'sent';
  action?: React.ReactNode;
}

export default function EmptyState({ title, description, icon = 'scheduled', action }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        gap: 16,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: '50%',
          background: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 8,
        }}
      >
        {icon === 'sent' ? (
          <Send size={28} color="#818cf8" />
        ) : (
          <Mail size={28} color="#818cf8" />
        )}
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</h3>
      <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 360 }}>{description}</p>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
