'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, DepartmentData } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { CUSTOM_SETTINGS_DEFAULTS } from '@/lib/constants';

/**
 * Hook to fetch departments from the departments table (new).
 * Falls back to legacy custom-settings endpoint, then to defaults.
 *
 * Returns:
 * - departments: string[] — backward compatible, for dropdowns that use d as string
 * - departmentRecords: DepartmentData[] — full objects with id, for ID-based operations
 */
export function useDepartments() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ['departments-table'],
    queryFn: async () => {
      try {
        const result = await api.tenants.getDepartmentsTable(token!);
        if (Array.isArray(result) && result.length > 0) {
          return result.filter(d => d.isActive);
        }
      } catch {
        // Table endpoint not available — fall back to legacy
      }
      // Fallback: legacy string[] endpoint
      const legacy = await api.tenants.getCustomSetting(token!, 'departments');
      if (Array.isArray(legacy) && legacy.length > 0) {
        return legacy.map((name, i) => ({
          id: '', name, isActive: true, sortOrder: i,
          tenantId: '', createdAt: '', updatedAt: '',
        })) as DepartmentData[];
      }
      return CUSTOM_SETTINGS_DEFAULTS.departments.map((name, i) => ({
        id: '', name, isActive: true, sortOrder: i,
        tenantId: '', createdAt: '', updatedAt: '',
      })) as DepartmentData[];
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  const records = query.data ?? [];

  return {
    /** string[] — backward compatible for existing dropdowns */
    departments: records.map(d => d.name),
    /** DepartmentData[] — full objects with id for new ID-based operations */
    departmentRecords: records,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/** Invalidate departments cache */
export function useInvalidateDepartments() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['departments-table'] });
    qc.invalidateQueries({ queryKey: ['custom-settings', 'departments'] });
  };
}
