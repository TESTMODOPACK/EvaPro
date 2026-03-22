'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useUsers(page = 1, limit = 50) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['users', page, limit],
    queryFn: () => api.users.list(token!, page, limit),
    enabled: !!token,
  });
}

export function useCurrentUser() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api.users.me(token!),
    enabled: !!token,
  });
}

export function useCreateUser() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.users.create(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.users.update(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useRemoveUser() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.users.remove(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useBulkImport() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) => api.users.bulkImport(token!, csv),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
