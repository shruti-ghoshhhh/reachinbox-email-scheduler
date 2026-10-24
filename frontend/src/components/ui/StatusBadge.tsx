'use client';

import { EmailStatus } from '@/types';

interface StatusBadgeProps {
  status: EmailStatus;
}

const STATUS_LABELS: Record<EmailStatus, string> = {
  SCHEDULED: 'Scheduled',
  QUEUED: 'Queued',
  SENDING: 'Sending',
  SENT: 'Sent',
  FAILED: 'Failed',
  RATE_LIMITED: 'Rate Limited',
  CANCELLED: 'Cancelled',
};

const STATUS_DOTS: Record<EmailStatus, string> = {
  SCHEDULED: '#60a5fa',
  QUEUED: '#818cf8',
  SENDING: '#fbbf24',
  SENT: '#4ade80',
  FAILED: '#f87171',
  RATE_LIMITED: '#fb923c',
  CANCELLED: '#94a3b8',
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const lowerStatus = status.toLowerCase();
  const dot = STATUS_DOTS[status];
  return (
    <span className={`badge badge-${lowerStatus}`}>
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dot,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}
