'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Shared subscription hook — single API call cached across all components.
 * Replaces independent calls in layout.tsx, TopBar.tsx, and Sidebar.tsx.
 * Cache: 5 minutes stale time to avoid redundant requests.
 */
export function useMySubscription() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);

  return useQuery({
    queryKey: ['my-subscription'],
    queryFn: () => api.subscriptions.mySubscription(token!),
    enabled: !!token && role !== 'super_admin',
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,   // 10 minutes garbage collection
    retry: 1,
  });
}
