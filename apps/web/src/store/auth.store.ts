'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as Sentry from '@sentry/nextjs';
import { queryClient } from '@/lib/query-client';

export interface AuthUser {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  firstName: string;
  lastName: string;
  /** Populated when the active JWT is an impersonation token. Drives the
   *  red banner + "Salir de impersonación" button. */
  impersonatedBy?: string;
  impersonationReason?: string;
  impersonationExpiresAt?: string; // ISO 8601
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;
  setAuth: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      _hasHydrated: false,

      setAuth: (token, user) => {
        // Clear any cached data from a previous session before setting new auth.
        // This prevents cross-tenant cache leaks when a user logs out and a
        // different user (possibly from a different tenant) logs in.
        try { queryClient.clear(); } catch { /* safe in SSR */ }
        // Identificar al usuario en Sentry para que cada error capturado
        // venga con el userId + tenantId + role. NO mandamos email (GDPR).
        // Si Sentry esta desactivado (sin DSN), setUser es no-op.
        try {
          Sentry.setUser({
            id: user.userId,
            username: `${user.firstName} ${user.lastName}`.trim() || undefined,
          });
          Sentry.setTag('tenantId', user.tenantId);
          Sentry.setTag('role', user.role);
        } catch { /* safe in SSR / Sentry not loaded */ }
        set({ token, user, isAuthenticated: true });
      },

      logout: () => {
        // Drop all React Query caches on logout. Without this, cached data
        // (e.g. useMySubscription, tenant name) survives the next login and
        // the new user sees the previous tenant's info.
        try { queryClient.clear(); } catch { /* safe in SSR */ }
        // Limpiar el usuario de Sentry para que errores post-logout no
        // queden atribuidos al usuario anterior.
        try { Sentry.setUser(null); } catch { /* safe in SSR */ }
        set({ token: null, user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'evapro-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ _hasHydrated: true });
      },
    },
  ),
);

/** Decode a JWT payload (no verification — trust the server) */
export function decodeJwtPayload(token: string): AuthUser | null {
  try {
    const base64 = token.split('.')[1];
    const payload = JSON.parse(atob(base64));
    const impersonatedBy = payload.impersonatedBy as string | undefined;
    const impersonationReason = payload.impersonationReason as string | undefined;
    const impersonationExpiresAt =
      typeof payload.exp === 'number' && impersonatedBy
        ? new Date(payload.exp * 1000).toISOString()
        : undefined;
    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
      impersonatedBy,
      impersonationReason,
      impersonationExpiresAt,
    };
  } catch {
    return null;
  }
}
