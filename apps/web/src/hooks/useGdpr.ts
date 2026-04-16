"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";

/** User's own GDPR request history (last 30 days). */
export function useGdprMyRequests() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["gdpr", "my-requests"],
    queryFn: () => api.gdpr.myRequests(token!),
    enabled: !!token,
    // Exports usually complete in <10s; poll every 10s so the UI updates
    // from "processing" to "completed" without a manual refresh.
    refetchInterval: (q) => {
      const data = q.state.data;
      const inFlight = data?.some((r) =>
        ["pending", "processing", "confirmed_pending"].includes(r.status),
      );
      return inFlight ? 10000 : false;
    },
  });
}

/** Trigger a data export request for the current user. */
export function useRequestGdprExport() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.gdpr.exportMyData(token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdpr", "my-requests"] });
    },
  });
}

/** Step 1 of account deletion: email the 6-digit confirmation code. */
export function useRequestAccountDeletion() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: () => api.gdpr.requestDelete(token!),
  });
}

/**
 * Step 2 of account deletion: verify the code and run the cascade.
 *
 * The caller MUST handle logout in its own `onSuccess` (clearing auth
 * store + redirecting to /login?deleted=1) because the backend has now
 * invalidated the JWT via tokenVersion bump.
 */
export function useConfirmAccountDeletion() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: (vars: { requestId: string; code: string }) =>
      api.gdpr.confirmDelete(token!, vars.requestId, vars.code),
  });
}

/** Tenant-wide export (tenant_admin). */
export function useRequestTenantExport() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { anonymize?: boolean }) =>
      api.gdpr.exportTenantData(token!, vars.anonymize ?? false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gdpr", "tenant-requests"] });
    },
  });
}

/** Tenant-wide request history (tenant_admin). */
export function useGdprTenantRequests() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ["gdpr", "tenant-requests"],
    queryFn: () => api.gdpr.tenantRequests(token!),
    enabled: !!token,
  });
}
