'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, ready, toggleTheme } = useTheme();
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const isDark = theme === 'dark';
  const modeLabel = isDark ? 'Dark mode on' : 'Dark mode off';

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={toggleTheme}
      disabled={!ready}
      aria-label={ready ? `${modeLabel}. Activate to turn ${nextTheme} mode on.` : 'Color theme loading'}
      aria-pressed={ready && isDark}
      title={ready ? `${modeLabel} · switch to ${nextTheme} mode` : 'Color theme loading'}
    >
      {ready ? (
        isDark ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />
      ) : (
        <span className="theme-toggle-placeholder" aria-hidden="true" />
      )}
    </button>
  );
}
