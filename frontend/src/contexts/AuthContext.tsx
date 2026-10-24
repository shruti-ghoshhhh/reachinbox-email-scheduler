'use client';

import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import { User } from '@/types';
import { api } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  login: (token: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: User }>('/api/auth/me');
      if (res.success) {
        setUser(res.data!);
        setToken(localStorage.getItem('token'));
      }
    } catch {
      setUser(null);
      setToken(null);
      localStorage.removeItem('token');
    }
  }, []);

  const login = useCallback(async (newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
    await refreshUser();
  }, [refreshUser]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    Promise.resolve().then(() => {
      if (!localStorage.getItem('token')) {
        setIsLoading(false);
        return;
      }
      return refreshUser().finally(() => setIsLoading(false));
    });
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
