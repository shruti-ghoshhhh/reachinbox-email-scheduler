'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { QueueStats } from '@/types';
import { Clock3, Send, Hourglass, Activity, TriangleAlert } from 'lucide-react';

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
  const deliveryUnknown = stats?.emails?.DELIVERY_UNKNOWN ?? 0;
  const active = stats?.queue?.active ?? 0;
  const items = [
    { label: 'In the queue', value: scheduled, note: 'scheduled + queued', icon: <Clock3 size={17} /> },
    { label: 'Delivered', value: sent, note: 'all time', icon: <Send size={17} /> },
    { label: 'Pacing', value: rateLimited, note: 'waiting for capacity', icon: <Hourglass size={17} /> },
    { label: 'Needs review', value: deliveryUnknown, note: 'delivery outcome unknown', icon: <TriangleAlert size={17} />, alert: deliveryUnknown > 0 },
    { label: 'Sending now', value: active, note: 'in progress', icon: <Activity size={17} /> },
  ];

  return (
    <div className="stats-grid" role="group" aria-label="Email delivery overview" aria-busy={stats === null}>
      {items.map((item) => (
        <div className="stat-item" key={item.label} data-alert={item.alert ? 'true' : 'false'}>
          <div className="stat-icon" aria-hidden="true">{item.icon}</div>
          <div>
            <p className="stat-value">{stats ? item.value.toLocaleString() : '—'}</p>
            <p className="stat-label">{item.label}</p>
            <p className="stat-note">{item.note}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
