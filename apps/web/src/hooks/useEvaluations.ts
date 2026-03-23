'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
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
