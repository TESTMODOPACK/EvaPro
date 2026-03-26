'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useDemographics() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['dei', 'demographics'],
    queryFn: () => api.dei.demographics(token!),
    enabled: !!token,
  });
}

export function useEquityAnalysis(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['dei', 'equity', cycleId],
    queryFn: () => api.dei.equity(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}

export function useGapReport(cycleId: string | null, dimension = 'gender') {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['dei', 'gap', cycleId, dimension],
    queryFn: () => api.dei.gapReport(token!, cycleId!, dimension),
    enabled: !!token && !!cycleId,
  });
}
