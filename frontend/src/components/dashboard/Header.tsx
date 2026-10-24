'use client';

import Image from 'next/image';
import { LogOut, Bell, Zap, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';

interface HeaderProps {
  onSlackConnect?: () => void;
  slackConnected?: boolean;
}

export default function Header({ onSlackConnect, slackConnected = false }: HeaderProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    router.push('/login');
  };

  return (
    <header
      style={{
        background: 'rgba(10, 10, 15, 0.95)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.4)',
          }}
        >
          <Zap size={16} color="white" />
        </div>
        <div>
          <h1 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
            ReachInbox
          </h1>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Email Scheduler
          </p>
        </div>
      </div>

      {/* Right */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Slack Connect */}
        <button
          onClick={onSlackConnect}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: slackConnected
              ? 'rgba(34, 197, 94, 0.1)'
              : 'var(--bg-card)',
            border: `1px solid ${slackConnected ? 'rgba(34, 197, 94, 0.2)' : 'var(--border)'}`,
            borderRadius: 8,
            padding: '7px 14px',
            cursor: 'pointer',
            color: slackConnected ? '#4ade80' : 'var(--text-secondary)',
            fontSize: 13,
            fontWeight: 500,
            transition: 'all 0.2s',
          }}
        >
          <Bell size={14} />
          {slackConnected ? 'Slack Connected' : 'Connect Slack'}
        </button>

        {/* User Menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '6px 12px 6px 6px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {user?.avatar ? (
              <Image
                src={user.avatar}
                alt={user.name}
                width={28}
                height={28}
                style={{ borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'white',
                }}
              >
                {user?.name?.[0]?.toUpperCase() ?? 'U'}
              </div>
            )}
            <div style={{ textAlign: 'left' }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                {user?.name ?? 'User'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {user?.email ?? ''}
              </p>
            </div>
            <ChevronDown size={13} color="var(--text-muted)" />
          </button>

          {showMenu && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
                minWidth: 180,
                overflow: 'hidden',
                zIndex: 200,
              }}
            >
              <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Signed in as</p>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.email}
                </p>
              </div>
              <button
                onClick={handleLogout}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#f87171',
                  fontSize: 13,
                  fontWeight: 500,
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.05)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <LogOut size={14} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
