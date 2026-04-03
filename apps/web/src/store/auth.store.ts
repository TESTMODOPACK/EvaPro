'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  firstName: string;
  lastName: string;
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

      setAuth: (token, user) =>
        set({ token, user, isAuthenticated: true }),

      logout: () =>
        set({ token: null, user: null, isAuthenticated: false }),
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
    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      firstName: payload.firstName || '',
      lastName: payload.lastName || '',
    };
  } catch {
    return null;
  }
}
