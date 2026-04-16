'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Providers enabled in this deployment. Used by `PayInvoiceModal` to show
 * only the options that will actually work. Cached for 5 minutes because
 * env config rarely changes at runtime.
 */
export function usePaymentProviders() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'providers'],
    queryFn: () => api.payments.listProviders(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

/** Fire a new checkout request. The `onSuccess` callback receives the URL
 *  the browser should redirect to — the hook does NOT redirect on its
 *  own to keep it composable. */
export function useCreateCheckout() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: (vars: { invoiceId: string; provider: 'stripe' | 'mercadopago' }) =>
      api.payments.createCheckout(token!, vars.invoiceId, vars.provider),
  });
}

/**
 * Poll a session. Used by `/pago/exitoso` to wait for the webhook to land.
 *
 * Polling interval ramps down:
 *   - `status=pending`: 3s (fast initial attention)
 *   - any terminal status: stops (returns `false`).
 *
 * We stop after 60s regardless so the page never polls forever.
 */
export function usePaymentSession(sessionId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['payments', 'session', sessionId],
    queryFn: () => api.payments.getSession(token!, sessionId!),
    enabled: !!token && !!sessionId,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return 3000;
      if (data.status === 'pending') return 3000;
      return false;
    },
    // Give up polling after 20 retries (≈60s) even if still pending —
    // network or provider sometimes takes longer; user can refresh.
    retry: 20,
  });
}
