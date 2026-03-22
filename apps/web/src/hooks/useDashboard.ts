'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useDashboardStats() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: () => api.dashboard.stats(token!),
    enabled: !!token,
  });
}
