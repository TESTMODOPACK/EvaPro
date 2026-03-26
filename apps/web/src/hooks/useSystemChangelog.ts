'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useChangelog(limit = 5) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['system', 'changelog', limit],
    queryFn: () => api.system.changelog(token!, limit),
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // Cache 5 min — changelog changes rarely
  });
}
