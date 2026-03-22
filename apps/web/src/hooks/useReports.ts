'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useCycleSummary(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'summary', cycleId],
    queryFn: () => api.reports.cycleSummary(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}
