'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageLoader } from '@/components/ui/LoadingSpinner';
import Header from '@/components/dashboard/Header';
import StatsBar from '@/components/dashboard/StatsBar';
import ScheduledEmailsTable from '@/components/dashboard/ScheduledEmailsTable';
import SentEmailsTable from '@/components/dashboard/SentEmailsTable';
import ComposeModal from '@/components/dashboard/ComposeModal';
import { Plus, Clock, Send, ExternalLink, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { ApiResponse } from '@/types';
import toast from 'react-hot-toast';
import { API_BASE } from '@/lib/api';

type Tab = 'scheduled' | 'sent' | 'review';

function DashboardInner() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('scheduled');
  const [showCompose, setShowCompose] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [slackConnectionStatus, setSlackConnectionStatus] = useState<boolean | null>(null);
  const slackConnected = slackConnectionStatus ?? user?.slackConnected ?? false;

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
        if (res.success) setSlackConnectionStatus(res.data?.connected ?? false);
      })
      .catch(() => {});
  }, [user]);

  // Handle Slack callback params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack_connected') === 'true') {
      toast.success('✅ Slack connected successfully!');
    }
    if (params.get('slack_error') === 'true') {
      toast.error('Failed to connect Slack. Please try again.');
    }
  }, []);

  const handleSlackConnect = async () => {
    try {
      const result = await api.get<{ success: boolean; url: string }>('/api/slack/connect');
      window.location.assign(result.url);
    } catch {
      toast.error('Could not start Slack connection. Please try again.');
    }
  };

  const handleSlackDisconnect = async () => {
    try {
      await api.delete<ApiResponse<unknown>>('/api/slack/disconnect');
      setSlackConnectionStatus(false);
      toast.success('Slack disconnected. Reconnect any time to resume alerts.');
    } catch {
      toast.error('Could not disconnect Slack. Please try again.');
    }
  };

  const handleComposeSuccess = () => {
    setRefreshTrigger((n) => n + 1);
    setActiveTab('scheduled');
  };

  if (isLoading) return <FullPageLoader />;
  if (!user) return null;

  return (
    <div className="dashboard-shell">
      <Header onSlackConnect={handleSlackConnect} onSlackDisconnect={handleSlackDisconnect} slackConnected={slackConnected} />

      <main className="dashboard-main">
        {/* Page header */}
        <div
          className="dashboard-heading"
        >
          <div>
            <div>
              <h2 className="dashboard-title">
                Campaigns.
              </h2>
              <p className="dashboard-subtitle">
                Keep every send on schedule and every delivery in view.
              </p>
            </div>
          </div>

          <div className="dashboard-actions">
            <a
              href={`${API_BASE}/admin/queues`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ textDecoration: 'none' }}
            >
              <ExternalLink size={14} />
              Queue Board
            </a>
            <button
              onClick={() => setShowCompose(true)}
              className="btn-primary"
            >
              <Plus size={16} />
              Compose New Email
            </button>
          </div>
        </div>

        {/* Stats */}
        <div>
          <StatsBar />
        </div>

        {/* Tabs */}
        <section className="email-section">
          <div className="section-topline">
            <div>
              <h3 className="section-title">Email activity</h3>
              <p className="section-caption">Search, review, and manage your delivery queue.</p>
            </div>
            <div className="segmented" role="group" aria-label="Email activity view">
            {([
              { key: 'scheduled', label: 'Scheduled', icon: <Clock size={14} /> },
              { key: 'sent', label: 'Sent', icon: <Send size={14} /> },
              { key: 'review', label: 'Needs review', icon: <TriangleAlert size={14} /> },
            ] as { key: Tab; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                aria-pressed={activeTab === key}
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
          ) : activeTab === 'sent' ? (
            <SentEmailsTable refreshTrigger={refreshTrigger} />
          ) : (
            <SentEmailsTable refreshTrigger={refreshTrigger} mode="review" />
          )}
        </div>
        </section>
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
  return <DashboardInner />;
}
