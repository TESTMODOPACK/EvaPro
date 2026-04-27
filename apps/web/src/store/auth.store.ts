'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as Sentry from '@sentry/nextjs';
import { queryClient } from '@/lib/query-client';
import { api } from '@/lib/api';

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

/**
 * F3 Fase 2 — Auth basada en cookie httpOnly.
 *
 * Cambio importante: `token` ya NO se persiste en localStorage. El JWT
 * vive solo en la cookie httpOnly del navegador (no readable por
 * JavaScript), eliminando la superficie XSS sobre el token.
 *
 * Lo que persiste:
 * - `user`: para que el dashboard renderice rapido sin esperar API.
 * - `isAuthenticated`: flag derivado.
 * - `tokenExpiresAt`: timestamp ms de expiracion del JWT actual,
 *   computado del claim `exp` al login/refresh. Se usa por
 *   dashboard/layout.tsx para decidir cuando llamar /auth/refresh.
 *
 * Lo que NO persiste:
 * - `token`: el JWT crudo. La cookie es la unica fuente de verdad.
 */
interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** ms since epoch del claim `exp` del JWT activo. null cuando no hay
   *  sesion. Se usa para programar el refresh proactivo. */
  tokenExpiresAt: number | null;
  /**
   * @deprecated F3 Fase 2 — Ya NO contiene el JWT real (vive solo en
   * cookie httpOnly). Se mantiene como string truthy 'cookie' cuando
   * hay sesion activa y null cuando no, para preservar el patron de
   * `enabled: !!token` en hooks de React Query y `if (!token) return`
   * checks que existen en ~50 archivos del frontend. Migrar a
   * `isAuthenticated` cuando se toque cada archivo.
   */
  token: 'cookie' | null;
  _hasHydrated: boolean;
  setAuth: (user: AuthUser, expiresAtMs: number) => void;
  setTokenExpiresAt: (expiresAtMs: number) => void;
  /** Logout async: llama POST /auth/logout para limpiar la cookie
   *  server-side, despues limpia el estado local. Si el server falla,
   *  igual limpia el estado local (la cookie expirara naturalmente). */
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      tokenExpiresAt: null,
      token: null,
      _hasHydrated: false,

      setAuth: (user, expiresAtMs) => {
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
        set({ user, isAuthenticated: true, tokenExpiresAt: expiresAtMs, token: 'cookie' });
      },

      setTokenExpiresAt: (expiresAtMs) => {
        set({ tokenExpiresAt: expiresAtMs });
      },

      logout: async () => {
        // Server-side: limpia la cookie httpOnly del access_token.
        // Idempotente y no bloquea el logout local si falla (ej. red
        // caida o session ya expirada). Si la cookie no se puede borrar
        // server-side, igual el estado local queda limpio.
        try {
          await api.auth.logout();
        } catch { /* safe — se cae igual de sesion local */ }
        // Drop all React Query caches on logout. Without this, cached data
        // (e.g. useMySubscription, tenant name) survives the next login and
        // the new user sees the previous tenant's info.
        try { queryClient.clear(); } catch { /* safe in SSR */ }
        // Limpiar el usuario de Sentry para que errores post-logout no
        // queden atribuidos al usuario anterior.
        try { Sentry.setUser(null); } catch { /* safe in SSR */ }
        set({ user: null, isAuthenticated: false, tokenExpiresAt: null, token: null });
      },
    }),
    {
      name: 'evapro-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        tokenExpiresAt: state.tokenExpiresAt,
        token: state.token,
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

/**
 * Decodifica el claim `exp` del JWT y devuelve el timestamp ms de
 * expiracion. Devuelve `null` si el token no es parseable. Se usa una
 * sola vez (login/refresh) para alimentar `tokenExpiresAt` del store —
 * el JWT en si NO se guarda en JS.
 */
export function decodeJwtExpMs(token: string): number | null {
  try {
    const base64 = token.split('.')[1];
    const payload = JSON.parse(atob(base64));
    if (typeof payload.exp === 'number') return payload.exp * 1000;
    return null;
  } catch {
    return null;
  }
}
