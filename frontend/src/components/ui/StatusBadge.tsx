'use client';

import { EmailStatus } from '@/types';

interface StatusBadgeProps {
  status: EmailStatus;
}

const STATUS_LABELS: Record<EmailStatus, string> = {
  SCHEDULED: 'Scheduled',
  QUEUED: 'Queued',
  SENDING: 'Sending',
  DELIVERY_UNKNOWN: 'Delivery unknown',
  SENT: 'Sent',
  FAILED: 'Failed',
  RATE_LIMITED: 'Rate Limited',
  CANCELLED: 'Cancelled',
};

const STATUS_DOTS: Record<EmailStatus, string> = {
  SCHEDULED: 'var(--muted)',
  QUEUED: 'var(--table-muted)',
  SENDING: 'var(--warning)',
  DELIVERY_UNKNOWN: 'var(--warning)',
  SENT: 'var(--success)',
  FAILED: 'var(--error)',
  RATE_LIMITED: 'var(--warning)',
  CANCELLED: 'var(--faint)',
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
