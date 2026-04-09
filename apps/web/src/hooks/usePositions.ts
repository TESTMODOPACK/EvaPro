'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, PositionData } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface PositionItem {
  name: string;
  level: number;
}

/**
 * Hook to fetch positions from the positions table (new v2).
 * Falls back to legacy catalog endpoint.
 */
export function usePositionsV2() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ['positions-v2'],
    queryFn: async () => {
      try {
        const result = await api.tenants.getPositionsV2(token!);
        if (Array.isArray(result) && result.length > 0) {
          return result.filter(p => p.isActive);
        }
      } catch {
        // Table endpoint not available — fall back to legacy
      }
      // Fallback: legacy {name, level}[] endpoint
      const legacy = await api.tenants.getPositionsCatalog(token!);
      if (Array.isArray(legacy) && legacy.length > 0) {
        return legacy.map(p => ({
          id: '', name: p.name, level: p.level, isActive: true,
          tenantId: '', createdAt: '', updatedAt: '',
        })) as PositionData[];
      }
      return [];
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  return {
    positions: query.data ?? [],
    positionNames: (query.data ?? []).map(p => p.name),
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch the tenant's configured positions catalog (legacy).
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
    qc.invalidateQueries({ queryKey: ['positions-v2'] });
  };
}
