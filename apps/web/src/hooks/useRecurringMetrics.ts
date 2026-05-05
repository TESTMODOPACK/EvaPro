/**
 * useRecurringMetrics.ts — Audit P2, Tarea 10.4.
 *
 * Hooks para el módulo de métricas recurrentes (KPI semánticamente
 * correctos). UI dedicada (`/dashboard/metricas`) queda deferida a un
 * PR aparte; estos hooks dejan la API consumible para esa iteración.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

const ROOT_KEY = 'recurring-metrics';

export function useRecurringMetrics(opts?: {
  ownerUserId?: string;
  isActive?: boolean;
}) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: [ROOT_KEY, 'list', opts?.ownerUserId ?? null, opts?.isActive ?? null],
    queryFn: () => api.recurringMetrics.list(token!, opts),
    enabled: !!token,
  });
}

export function useRecurringMetric(id: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: [ROOT_KEY, 'detail', id],
    queryFn: () => api.recurringMetrics.getById(token!, id!),
    enabled: !!token && !!id,
  });
}

/** Estado actual con cálculo de status (green/yellow/red/no_data) y overdue. */
export function useRecurringMetricState(id: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: [ROOT_KEY, 'state', id],
    queryFn: () => api.recurringMetrics.getState(token!, id!),
    enabled: !!token && !!id,
  });
}

export function useRecurringMetricMeasurements(
  id: string | null,
  limit?: number,
) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: [ROOT_KEY, 'measurements', id, limit ?? 50],
    queryFn: () => api.recurringMetrics.listMeasurements(token!, id!, limit),
    enabled: !!token && !!id,
  });
}

export function useCreateRecurringMetric() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.recurringMetrics.create(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROOT_KEY] }),
  });
}

export function useUpdateRecurringMetric() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.recurringMetrics.update(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROOT_KEY] }),
  });
}

export function useDeactivateRecurringMetric() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.recurringMetrics.deactivate(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [ROOT_KEY] }),
  });
}

export function useAddMetricMeasurement() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { value: number; observedAt?: string; notes?: string };
    }) => api.recurringMetrics.addMeasurement(token!, id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [ROOT_KEY, 'state', vars.id] });
      qc.invalidateQueries({ queryKey: [ROOT_KEY, 'measurements', vars.id] });
      qc.invalidateQueries({ queryKey: [ROOT_KEY, 'list'] });
    },
  });
}
