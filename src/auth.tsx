import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api } from './lib/api';
import type { User } from './lib/types';

interface AuthState {
  user: User | null;
  permissions: string[];
  loading: boolean;
  login: (email: string, password: string) => Promise<{ user: User; permissions: string[] }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (perm: string | string[]) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ user: User; permissions: string[] }>('/auth/me');
      setUser(me.user);
      setPermissions(me.permissions);
    } catch {
      setUser(null);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: User; permissions: string[] }>('/auth/login', { email, password });
    setUser(res.user);
    setPermissions(res.permissions);
    return res;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/auth/logout'); } finally {
      setUser(null);
      setPermissions([]);
    }
  }, []);

  const can = useCallback((perm: string | string[]) => {
    const list = Array.isArray(perm) ? perm : [perm];
    return list.some((p) => permissions.includes(p));
  }, [permissions]);

  return (
    <Ctx.Provider value={{ user, permissions, loading, login, logout, refresh, can }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
