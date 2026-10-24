'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { QueueStats } from '@/types';
import { Clock, Send, AlertTriangle, Activity } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '18px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        transition: 'border-color 0.2s, transform 0.2s',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-hover)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
        (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          background: color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
          {value.toLocaleString()}
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{label}</p>
      </div>
    </div>
  );
}

export default function StatsBar() {
  const [stats, setStats] = useState<QueueStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await api.get<{ success: boolean; data: QueueStats }>('/api/emails/stats');
        if (res.success) setStats(res.data!);
      } catch {}
    };

    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const scheduled = (stats?.emails?.SCHEDULED ?? 0) + (stats?.emails?.QUEUED ?? 0);
  const sent = stats?.emails?.SENT ?? 0;
  const rateLimited = stats?.emails?.RATE_LIMITED ?? 0;
  const active = stats?.queue?.active ?? 0;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      <StatCard
        label="Scheduled / Queued"
        value={scheduled}
        color="rgba(59, 130, 246, 0.15)"
        icon={<Clock size={20} color="#60a5fa" />}
      />
      <StatCard
        label="Emails Sent"
        value={sent}
        color="rgba(34, 197, 94, 0.15)"
        icon={<Send size={20} color="#4ade80" />}
      />
      <StatCard
        label="Rate Limited"
        value={rateLimited}
        color="rgba(251, 146, 60, 0.15)"
        icon={<AlertTriangle size={20} color="#fb923c" />}
      />
      <StatCard
        label="Active Workers"
        value={active}
        color="rgba(99, 102, 241, 0.15)"
        icon={<Activity size={20} color="#818cf8" />}
      />
    </div>
  );
}
