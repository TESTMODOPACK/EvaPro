'use client';

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api, type EvalListParams } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function usePendingEvaluations() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['evaluations', 'pending'],
    queryFn: () => api.evaluations.pending(token!),
    enabled: !!token,
  });
}

export function useMyCompletedEvaluations() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['evaluations', 'completed'],
    queryFn: () => api.evaluations.completed(token!),
    enabled: !!token,
  });
}

/**
 * Variantes paginadas — devuelven PaginatedResponse<T> ({ data, total, page,
 * limit }). Usar en pantallas que tienen muchas filas y necesitan search +
 * paginación server-side. Para counts/badges en widgets sigue usándose el
 * hook legacy (que carga todo y .length).
 *
 * `keepPreviousData` evita el flicker al cambiar de página: mientras la
 * nueva query carga, sigue mostrando la página previa.
 */
export function usePendingEvaluationsPaged(opts: EvalListParams) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['evaluations', 'pending', 'paged', opts],
    queryFn: () => api.evaluations.pendingPaged(token!, opts),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}

export function useMyCompletedEvaluationsPaged(opts: EvalListParams) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['evaluations', 'completed', 'paged', opts],
    queryFn: () => api.evaluations.completedPaged(token!, opts),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}

/**
 * KPI stats agregados de la bandeja del usuario. Devuelve conteos REALES
 * (sobre todo el dataset, no la página actual) + breakdown por ciclo.
 * Usar para los 3 KPI cards y las opciones de los dropdowns de ciclo.
 */
export function useEvaluationStats() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['evaluations', 'stats'],
    queryFn: () => api.evaluations.stats(token!),
    enabled: !!token,
    placeholderData: keepPreviousData,
  });
}

export function useEvaluationDetail(assignmentId: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['evaluations', assignmentId],
    queryFn: () => api.evaluations.getDetail(token!, assignmentId),
    enabled: !!token && !!assignmentId,
  });
}

export function useSaveResponse() {
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: ({ assignmentId, answers }: { assignmentId: string; answers: any }) =>
      api.evaluations.saveResponse(token!, assignmentId, answers),
  });
}

export function useSubmitResponse() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, answers }: { assignmentId: string; answers: any }) =>
      api.evaluations.submit(token!, assignmentId, answers),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['evaluations'] }),
  });
}
