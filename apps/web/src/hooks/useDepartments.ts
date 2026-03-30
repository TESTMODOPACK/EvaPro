'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { CUSTOM_SETTINGS_DEFAULTS } from '@/lib/constants';

/**
 * Hook to fetch the tenant's configured departments from Custom Settings.
 * Falls back to CUSTOM_SETTINGS_DEFAULTS.departments if not configured.
 */
export function useDepartments() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ['custom-settings', 'departments'],
    queryFn: async () => {
      const result = await api.tenants.getCustomSetting(token!, 'departments');
      return Array.isArray(result) && result.length > 0
        ? result
        : CUSTOM_SETTINGS_DEFAULTS.departments;
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  return {
    departments: query.data ?? CUSTOM_SETTINGS_DEFAULTS.departments,
    isLoading: query.isLoading,
  };
}
