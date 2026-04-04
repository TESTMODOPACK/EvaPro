'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface PositionItem {
  name: string;
  level: number;
}

/**
 * Hook to fetch the tenant's configured positions catalog.
 */
export function usePositions() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ['positions-catalog'],
    queryFn: () => api.tenants.getPositionsCatalog(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  return {
    positions: query.data ?? [],
    isLoading: query.isLoading,
  };
}
