'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useTemplates() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => api.templates.list(token!),
    enabled: !!token,
  });
}

export function useCreateTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.templates.create(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useUpdateTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.templates.update(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useRemoveTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.templates.remove(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDuplicateTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.templates.duplicate(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useVersionHistory(id: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['template-versions', id],
    queryFn: () => api.templates.versionHistory(token!, id!),
    enabled: !!token && !!id,
  });
}

export function useRestoreVersion() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.templates.restoreVersion(token!, id, version),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template-versions', id] });
    },
  });
}

// ─── Fase 3 (Opción A) — subplantillas ────────────────────────────────────

/** Devuelve plantilla padre + subplantillas. Hace migración inline si aplica. */
export function useTemplateWithSubTemplates(id: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['template-sub-templates', id],
    queryFn: () => api.templates.getWithSubTemplates(token!, id!),
    enabled: !!token && !!id,
  });
}

export function useCreateSubTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, data }: { parentId: string; data: any }) =>
      api.templates.createSubTemplate(token!, parentId, data),
    onSuccess: (_, { parentId }) => {
      qc.invalidateQueries({ queryKey: ['template-sub-templates', parentId] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateSubTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subId, data }: { subId: string; data: any; parentId?: string }) =>
      api.templates.updateSubTemplate(token!, subId, data),
    onSuccess: (_, { parentId }) => {
      if (parentId) qc.invalidateQueries({ queryKey: ['template-sub-templates', parentId] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useDeleteSubTemplate() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ subId }: { subId: string; parentId?: string }) =>
      api.templates.deleteSubTemplate(token!, subId),
    onSuccess: (_, { parentId }) => {
      if (parentId) qc.invalidateQueries({ queryKey: ['template-sub-templates', parentId] });
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

export function useUpdateWeights() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, weights }: { parentId: string; weights: Record<string, number> }) =>
      api.templates.updateWeights(token!, parentId, weights),
    onSuccess: (_, { parentId }) => {
      qc.invalidateQueries({ queryKey: ['template-sub-templates', parentId] });
    },
  });
}

/** Save-all atomico: subs + pesos en una sola transaccion (Fase 3 opcion B). */
export function useSaveAllSubTemplates() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      parentId,
      data,
    }: {
      parentId: string;
      data: {
        subTemplates: Array<{
          id: string;
          sections?: any[];
          weight?: number;
          displayOrder?: number;
          isActive?: boolean;
        }>;
        changeNote?: string;
      };
    }) => api.templates.saveAllSubTemplates(token!, parentId, data),
    onSuccess: (_, { parentId }) => {
      qc.invalidateQueries({ queryKey: ['template-sub-templates', parentId] });
      qc.invalidateQueries({ queryKey: ['templates'] });
      qc.invalidateQueries({ queryKey: ['template-versions', parentId] });
    },
  });
}
