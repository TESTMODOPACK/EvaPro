'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function usePerformanceHistory(userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['performanceHistory', userId],
    queryFn: () => api.reports.performanceHistory(token!, userId!),
    enabled: !!token && !!userId,
  });
}

export function useAnalytics(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['analytics', cycleId],
    queryFn: () => api.reports.analytics(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}
