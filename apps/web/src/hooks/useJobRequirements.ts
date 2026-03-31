'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { CUSTOM_SETTINGS_DEFAULTS } from '@/lib/constants';

/**
 * Hook to fetch the tenant's configured job requirements from Custom Settings.
 * Falls back to CUSTOM_SETTINGS_DEFAULTS.jobRequirements if not configured.
 */
export function useJobRequirements() {
  const token = useAuthStore((s) => s.token);

  const query = useQuery({
    queryKey: ['custom-settings', 'jobRequirements'],
    queryFn: async () => {
      const result = await api.tenants.getCustomSetting(token!, 'jobRequirements');
      return Array.isArray(result) && result.length > 0
        ? result
        : CUSTOM_SETTINGS_DEFAULTS.jobRequirements;
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });

  return {
    requirements: query.data ?? CUSTOM_SETTINGS_DEFAULTS.jobRequirements,
    isLoading: query.isLoading,
  };
}
