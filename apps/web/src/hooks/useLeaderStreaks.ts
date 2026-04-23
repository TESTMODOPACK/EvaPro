'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/** v3.1 F6 — hooks de Leader Streaks. */
export function useMyLeaderStreaks(options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['leader-streaks', 'me'],
    queryFn: () => api.leaderStreaks.me(token!),
    enabled: !!token && options?.enabled !== false,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

export function useTenantLeaderStreaks(options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['leader-streaks', 'tenant'],
    queryFn: () => api.leaderStreaks.tenant(token!),
    enabled: !!token && options?.enabled !== false,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
