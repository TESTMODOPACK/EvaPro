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
