'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
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

/**
 * Hook to fetch ALL positions (catalog + in-use by users).
 * Use this for filters/dropdowns where you need to show all possible positions.
 */
export function usePositionsAll() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ['positions-all'],
    queryFn: () => api.tenants.getPositionsAll(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  return {
    positions: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** Invalidate positions cache (call after creating user with custom position) */
export function useInvalidatePositions() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['positions-catalog'] });
    qc.invalidateQueries({ queryKey: ['positions-all'] });
  };
}
