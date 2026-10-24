'use client';

import Image from 'next/image';
import { LogOut, Bell, BellRing, Zap, ChevronDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import ThemeToggle from '@/components/ui/ThemeToggle';

interface HeaderProps {
  onSlackConnect?: () => void;
  onSlackDisconnect?: () => void;
  slackConnected?: boolean;
}

export default function Header({ onSlackConnect, onSlackDisconnect, slackConnected = false }: HeaderProps) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    router.push('/login');
  };

  return (
    <header className="site-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div className="brand-mark"><Zap size={17} /></div>
        <div>
          <div className="brand-name">ReachInbox</div>
          <div className="brand-caption">Email scheduler</div>
        </div>
      </div>

      <div className="header-right">
        <ThemeToggle />
        <button
          className="slack-toggle"
          onClick={slackConnected ? onSlackDisconnect : onSlackConnect}
          title={slackConnected ? 'Slack connected · activate to disconnect' : 'Slack disconnected · activate to connect'}
          aria-label={slackConnected ? 'Slack connected. Activate to disconnect.' : 'Slack disconnected. Activate to connect.'}
          aria-pressed={slackConnected}
          style={{ minHeight: 44, padding: '0 14px', color: slackConnected ? 'var(--success)' : undefined }}
        >
          <span className="slack-icon-wrap" aria-hidden="true">
            {slackConnected ? <BellRing size={17} /> : <Bell size={17} />}
            <span className="slack-state-dot" />
          </span>
        </button>

        <div style={{ position: 'relative' }}>
          <button
            className="user-trigger"
            onClick={() => setShowMenu(!showMenu)}
            aria-expanded={showMenu}
            aria-haspopup="menu"
            aria-label="Open account menu"
          >
            {user?.avatar ? (
              <Image className="user-avatar" src={user.avatar} alt={user.name} width={32} height={32} />
            ) : (
              <span className="user-avatar">{user?.name?.[0]?.toUpperCase() ?? 'U'}</span>
            )}
            <span className="header-user-copy" style={{ textAlign: 'left' }}>
              <span style={{ display: 'block', color: 'var(--ink)', fontSize: 12, fontWeight: 600, lineHeight: 1.25 }}>{user?.name ?? 'User'}</span>
              <span style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>{user?.email ?? ''}</span>
            </span>
            <ChevronDown size={13} color="var(--muted)" />
          </button>

          {showMenu && (
            <div className="user-menu" role="menu">
              <div className="menu-meta">
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 11 }}>Signed in as</p>
                <p style={{ margin: '3px 0 0', color: 'var(--ink)', fontSize: 12, fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</p>
              </div>
              <button className="menu-action" role="menuitem" onClick={handleLogout}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
