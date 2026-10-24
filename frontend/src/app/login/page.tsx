'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Mail, Shield, ArrowRight, Clock } from 'lucide-react';
import { API_BASE } from '@/lib/api';
import ThemeToggle from '@/components/ui/ThemeToggle';
import { useAuth } from '@/contexts/AuthContext';
import { FullPageLoader } from '@/components/ui/LoadingSpinner';

const GOOGLE_AUTH_URL = `${API_BASE}/api/auth/google`;

function FeatureChip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      className="login-feature-chip"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        background: 'var(--canvas-soft)',
        border: '1px solid var(--hairline-soft)',
        borderRadius: 9999,
        padding: '6px 14px',
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}
    >
      <span style={{ color: 'var(--ink)' }}>{icon}</span>
      {text}
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) router.replace('/dashboard');
  }, [isLoading, user, router]);

  if (isLoading || user) return <FullPageLoader />;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <ThemeToggle className="login-theme-toggle" />
      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          top: '20%',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 600,
          height: 600,
          background: 'none',
          pointerEvents: 'none',
        }}
      />

      <div
        className="animate-fade-in"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 32,
          maxWidth: 440,
          width: '100%',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              background: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'none',
            }}
          >
            <Zap size={32} color="var(--on-ink)" />
          </div>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', lineHeight: 1.1 }}>
              Reach<span className="gradient-text">Inbox</span>
            </h1>
            <p style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 6 }}>
              Production-grade email scheduler
            </p>
          </div>
        </div>

        {/* Feature chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          <FeatureChip icon={<Clock size={13} />} text="BullMQ Scheduler" />
          <FeatureChip icon={<Mail size={13} />} text="Bulk Email Campaigns" />
          <FeatureChip icon={<Shield size={13} />} text="Rate Limiting" />
        </div>

        {/* Login Card */}
        <div
          className="glass"
          style={{
            width: '100%',
            borderRadius: 16,
            padding: 32,
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          }}
        >
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              Sign in to get started
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 6 }}>
              Connect your Google account to access the email scheduler dashboard.
            </p>
          </div>

          <a
            href={GOOGLE_AUTH_URL}
            className="google-login"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              background: 'white',
              color: '#1a1a1a',
              border: 'none',
              borderRadius: 10,
              padding: '13px 20px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              textDecoration: 'none',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 15px rgba(255,255,255,0.1)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 25px rgba(255,255,255,0.15)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 15px rgba(255,255,255,0.1)';
            }}
          >
            {/* Google logo */}
            <svg width="20" height="20" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
            <ArrowRight size={16} style={{ marginLeft: 'auto' }} />
          </a>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
            By continuing, you agree to our terms of service. Your email data is stored securely and only used for scheduling.
          </p>
        </div>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          Powered by BullMQ + Redis • Built for ReachInbox
        </p>
      </div>
    </div>
  );
}
