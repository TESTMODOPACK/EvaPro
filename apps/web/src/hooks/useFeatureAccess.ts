'use client';

import { useMySubscription } from './useSubscription';
import { useAuthStore } from '@/store/auth.store';
import { ROUTE_FEATURE_MAP, FEATURE_MIN_PLAN } from '@/lib/feature-routes';

/**
 * Hook to check feature access based on the tenant's subscription plan.
 * Super admins bypass all restrictions.
 */
export function useFeatureAccess() {
  const { data: sub, isLoading } = useMySubscription();
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === 'super_admin';

  const features: string[] = sub?.plan?.features || [];
  const planName: string = sub?.plan?.name || 'Sin plan';

  const hasFeature = (feature: string): boolean => {
    if (isSuperAdmin) return true;
    return features.includes(feature);
  };

  const canAccessRoute = (path: string): boolean => {
    if (isSuperAdmin) return true;
    const requiredFeature = ROUTE_FEATURE_MAP[path];
    if (!requiredFeature) return true;
    return features.includes(requiredFeature);
  };

  const getMinPlan = (feature: string): string => {
    return FEATURE_MIN_PLAN[feature] || 'Superior';
  };

  const getRouteFeature = (path: string): string | undefined => {
    return ROUTE_FEATURE_MAP[path];
  };

  return {
    hasFeature,
    canAccessRoute,
    getMinPlan,
    getRouteFeature,
    features,
    planName,
    isLoading,
    isSuperAdmin,
  };
}
