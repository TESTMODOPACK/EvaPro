'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Shared subscription hook — single API call cached across all components.
 * Replaces independent calls in layout.tsx, TopBar.tsx, and Sidebar.tsx.
 * Cache: 30 seconds stale time — short enough to reflect plan changes
 * made by super_admin within seconds, while still avoiding excessive requests.
 */
export function useMySubscription() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.userId);
  const tenantId = useAuthStore((s) => s.user?.tenantId);

  return useQuery({
    // Key is scoped by userId+tenantId so switching users doesn't return
    // the previous user's cached subscription (and tenant name).
    queryKey: ['my-subscription', userId, tenantId],
    queryFn: () => api.subscriptions.mySubscription(token!),
    enabled: !!token && role !== 'super_admin',
    staleTime: 30 * 1000,     // 30 seconds — reflects plan changes quickly
    gcTime: 5 * 60 * 1000,    // 5 minutes garbage collection
    retry: 1,
  });
}
