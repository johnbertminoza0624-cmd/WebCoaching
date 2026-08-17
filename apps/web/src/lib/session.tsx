'use client';

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { api, ApiError } from '@/lib/api-client';
import type { Role } from '@/lib/mock-data';

/**
 * Who is signed in — now answered by the API, not by a local switcher.
 *
 * The session is whatever `GET /api/auth/me` says, derived from an httpOnly
 * cookie the browser cannot read. There is no way to change identity from the
 * client any more: the previous "view as role" switcher was a stand-in for
 * authentication, and keeping it alongside real tokens would have let anyone
 * claim a role the server would then refuse.
 */

export interface SessionUser {
  id: string;
  email: string;
  eid: string | null;
  firstName: string;
  lastName: string;
  /** Convenience: the app renders full names everywhere. */
  name: string;
  role: Role;
  status: string;
  accountId: string | null;
  teamId: string | null;
  mustChangePassword: boolean;
}

export interface Principal {
  id: string;
  role: Role;
  accountId: string | null;
  teamId: string | null;
  ledTeamIds: string[];
}

interface MeResponse {
  user: Omit<SessionUser, 'name'>;
  principal: Principal;
}

interface SessionValue {
  user: SessionUser | null;
  principal: Principal | null;
  /** Null while the first `/auth/me` is still in flight. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const SessionContext = React.createContext<SessionValue | null>(null);

/** Routes that must render without a session. */
const PUBLIC_ROUTES = ['/login'];

const withName = (u: Omit<SessionUser, 'name'>): SessionUser => ({
  ...u,
  name: `${u.firstName} ${u.lastName}`.trim(),
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [principal, setPrincipal] = React.useState<Principal | null>(null);
  const [loading, setLoading] = React.useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const load = React.useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/auth/me');
      setUser(withName(me.user));
      setPrincipal(me.principal);
    } catch (err) {
      // 401 here is the normal "not signed in" case, not an error worth showing.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setUser(null);
      setPrincipal(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  // Send unauthenticated users to the login page, but only once the first
  // /auth/me has settled — redirecting while it is in flight would bounce a
  // signed-in user out on every refresh.
  React.useEffect(() => {
    if (loading) return;
    if (!user && !PUBLIC_ROUTES.includes(pathname)) router.replace('/login');
    if (user && pathname === '/login') router.replace('/dashboard/performance');
  }, [loading, user, pathname, router]);

  const login = React.useCallback(async (email: string, password: string) => {
    await api.post('/auth/login', { email, password }, { skipRefresh: true });
    await load();
  }, [load]);

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined, { skipRefresh: true });
    } finally {
      setUser(null);
      setPrincipal(null);
      router.replace('/login');
    }
  }, [router]);

  const value = React.useMemo(
    () => ({ user, principal, loading, login, logout, refreshUser: load }),
    [user, principal, loading, login, logout, load],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = React.useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}

/**
 * The session where a component already requires one.
 *
 * Everything inside the app shell renders only after the session resolves, so
 * these components would otherwise each need a null check for a state they can
 * never actually be in.
 */
export function useAuthedSession() {
  const ctx = useSession();
  if (!ctx.user || !ctx.principal) {
    throw new Error('useAuthedSession used outside an authenticated route');
  }
  return { ...ctx, user: ctx.user, principal: ctx.principal };
}

export const initials = (name: string) =>
  name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
