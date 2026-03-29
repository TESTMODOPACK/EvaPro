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
