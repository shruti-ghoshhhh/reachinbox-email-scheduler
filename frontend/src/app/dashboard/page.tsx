'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageLoader } from '@/components/ui/LoadingSpinner';
import Header from '@/components/dashboard/Header';
import StatsBar from '@/components/dashboard/StatsBar';
import ScheduledEmailsTable from '@/components/dashboard/ScheduledEmailsTable';
import SentEmailsTable from '@/components/dashboard/SentEmailsTable';
import ComposeModal from '@/components/dashboard/ComposeModal';
import { Plus, Clock, Send, LayoutDashboard, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { ApiResponse } from '@/types';
import toast from 'react-hot-toast';
import { Suspense } from 'react';
import { API_BASE } from '@/lib/api';

type Tab = 'scheduled' | 'sent';

function DashboardInner() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>('scheduled');
  const [showCompose, setShowCompose] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [slackConnected, setSlackConnected] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  // Check Slack status
  useEffect(() => {
    if (!user) return;
    api
      .get<ApiResponse<{ connected: boolean }>>('/api/slack/status')
      .then((res) => {
        if (res.success) setSlackConnected(res.data?.connected ?? false);
      })
      .catch(() => {});
  }, [user]);

  // Handle Slack callback params
  useEffect(() => {
    if (searchParams.get('slack_connected') === 'true') {
      toast.success('✅ Slack connected successfully!');
    }
    if (searchParams.get('slack_error') === 'true') {
      toast.error('Failed to connect Slack. Please try again.');
    }
  }, [searchParams]);

  const handleSlackConnect = async () => {
    try {
      const result = await api.get<{ success: boolean; url: string }>('/api/slack/connect');
      window.location.assign(result.url);
    } catch {
      toast.error('Could not start Slack connection. Please try again.');
    }
  };

  const handleComposeSuccess = () => {
    setRefreshTrigger((n) => n + 1);
    setActiveTab('scheduled');
  };

  if (isLoading) return <FullPageLoader />;
  if (!user) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)' }}>
      <Header onSlackConnect={handleSlackConnect} slackConnected={slackConnected} />

      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '28px 24px' }}>
        {/* Page header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <LayoutDashboard size={22} color="var(--accent)" />
            <div>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                Dashboard
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                Manage your email campaigns and track delivery
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <a
              href={`${API_BASE}/admin/queues`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ fontSize: 13, textDecoration: 'none' }}
            >
              <ExternalLink size={14} />
              Queue Board
            </a>
            <button
              onClick={() => setShowCompose(true)}
              className="btn-primary"
              style={{ fontSize: 14 }}
            >
              <Plus size={16} />
              Compose New Email
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ marginBottom: 28 }}>
          <StatsBar />
        </div>

        {/* Tabs */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              display: 'inline-flex',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 4,
              gap: 2,
            }}
          >
            {([
              { key: 'scheduled', label: 'Scheduled', icon: <Clock size={14} /> },
              { key: 'sent', label: 'Sent', icon: <Send size={14} /> },
            ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '8px 18px',
                  borderRadius: 7,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                  transition: 'all 0.2s',
                  background: activeTab === key
                    ? 'linear-gradient(135deg, #6366f1, #4f46e5)'
                    : 'transparent',
                  color: activeTab === key ? 'white' : 'var(--text-muted)',
                  boxShadow: activeTab === key ? '0 2px 8px rgba(99, 102, 241, 0.3)' : 'none',
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="animate-fade-in" key={activeTab}>
          {activeTab === 'scheduled' ? (
            <ScheduledEmailsTable refreshTrigger={refreshTrigger} />
          ) : (
            <SentEmailsTable refreshTrigger={refreshTrigger} />
          )}
        </div>
      </main>

      <ComposeModal
        isOpen={showCompose}
        onClose={() => setShowCompose(false)}
        onSuccess={handleComposeSuccess}
      />
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <DashboardInner />
    </Suspense>
  );
}
