'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface PasswordPolicy {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  expiryDays: number | null;
  historyCount: number;
  lockoutThreshold: number;
  lockoutDurationMinutes: number;
}

const DEFAULT_POLICY: PasswordPolicy = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: false,
  expiryDays: null,
  historyCount: 0,
  lockoutThreshold: 5,
  lockoutDurationMinutes: 15,
};

/** Current tenant's password policy — requires an authenticated session.
 *  Used in /perfil and /ajustes. */
export function usePasswordPolicy() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['password-policy', 'current'],
    queryFn: () => api.passwordPolicy.current(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Fetches the policy keyed by email for the unauthenticated force-change
 * modal on /login. We accept null/undefined during the initial render and
 * fall back to sensible defaults so the UI never flickers.
 */
export function usePasswordPolicyForEmail(email: string | null, tenantSlug?: string) {
  const [policy, setPolicy] = useState<PasswordPolicy>(DEFAULT_POLICY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) {
      setPolicy(DEFAULT_POLICY);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.passwordPolicy
      .byEmail(email, tenantSlug)
      .then((p) => {
        if (!cancelled) setPolicy(p as PasswordPolicy);
      })
      .catch(() => {
        if (!cancelled) setPolicy(DEFAULT_POLICY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [email, tenantSlug]);

  return { policy, loading };
}
