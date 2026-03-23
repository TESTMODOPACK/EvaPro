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

export function useObjectiveHistory(id: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['objectives', id, 'history'],
    queryFn: () => api.objectives.history(token!, id),
    enabled: !!token && !!id,
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
