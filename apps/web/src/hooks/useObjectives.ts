'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useObjectives(userId?: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', userId || 'mine'],
    queryFn: () => api.objectives.list(token!, userId),
    enabled: !!token,
  });
}

export function useObjectiveById(id: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', id],
    queryFn: () => api.objectives.getById(token!, id),
    enabled: !!token && !!id,
  });
}

export function useCreateObjective() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.objectives.create(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

export function useUpdateObjective() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.objectives.update(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

export function useDeleteObjective() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.objectives.remove(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

export function useAddObjectiveProgress() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.objectives.addProgress(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

export function useSubmitForApproval() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.objectives.submitForApproval(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

export function useApproveObjective() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.objectives.approve(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

export function useRejectObjective() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => api.objectives.reject(token!, id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

/** T7.5 — Audit P1: cancela un objetivo por decisión de negocio. Razón obligatoria. */
export function useCancelObjective() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.objectives.cancel(token!, id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['objectives'] }),
  });
}

/** T8.2 — Audit P1: historial de rechazos del objetivo. Habilitado solo cuando hay objectiveId. */
export function useObjectiveRejectionHistory(objectiveId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', objectiveId, 'rejection-history'],
    queryFn: () => api.objectives.rejectionHistory(token!, objectiveId!),
    enabled: !!token && !!objectiveId,
  });
}

export function useObjectiveHistory(id: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', id, 'history'],
    queryFn: () => api.objectives.history(token!, id),
    enabled: !!token && !!id,
  });
}

// ─── Key Results ──────────────────────────────────────────────────────────────

export function useKeyResults(objectiveId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', objectiveId, 'key-results'],
    queryFn: () => api.objectives.listKeyResults(token!, objectiveId!),
    enabled: !!token && !!objectiveId,
  });
}

export function useCreateKeyResult() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ objectiveId, data }: { objectiveId: string; data: any }) =>
      api.objectives.createKeyResult(token!, objectiveId, data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['objectives', vars.objectiveId, 'key-results'] });
      qc.invalidateQueries({ queryKey: ['objectives'] });
    },
  });
}

export function useUpdateKeyResult() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ krId, data }: { krId: string; data: any }) =>
      api.objectives.updateKeyResult(token!, krId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
    },
  });
}

export function useDeleteKeyResult() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (krId: string) => api.objectives.deleteKeyResult(token!, krId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
    },
  });
}

// ─── Team Summary ─────────────────────────────────────────────────────────────

export function useTeamObjectivesSummary() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', 'team-summary'],
    queryFn: () => api.objectives.teamSummary(token!),
    enabled: !!token,
  });
}

// ─── At Risk ──────────────────────────────────────────────────────────────────

export function useAtRiskObjectives(userId?: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', 'at-risk', userId],
    queryFn: () => api.objectives.atRisk(token!, userId),
    enabled: !!token,
  });
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export function useObjectiveComments(objectiveId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', objectiveId, 'comments'],
    queryFn: () => api.objectives.listComments(token!, objectiveId!),
    enabled: !!token && !!objectiveId,
  });
}

export function useCreateObjectiveComment() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ objectiveId, data }: { objectiveId: string; data: { content: string; type?: string; attachmentUrl?: string; attachmentName?: string } }) =>
      api.objectives.createComment(token!, objectiveId, data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['objectives', vars.objectiveId, 'comments'] }),
  });
}

export function useDeleteObjectiveComment() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ objectiveId, commentId }: { objectiveId: string; commentId: string }) =>
      api.objectives.deleteComment(token!, objectiveId, commentId),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['objectives', vars.objectiveId, 'comments'] }),
  });
}

export function useObjectiveTree() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', 'tree'],
    queryFn: () => api.objectives.tree(token!),
    enabled: !!token,
    staleTime: 30_000,
  });
}
