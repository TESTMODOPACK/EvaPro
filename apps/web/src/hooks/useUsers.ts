'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/** P8-C: límite unificado para pickers globales (reconocimientos, feedback,
 *  evaluaciones al asignar, etc.). Antes estaba hardcoded a 500 en múltiples
 *  archivos. Si un tenant excede este valor conviene migrar a autocomplete
 *  con server-side search (SearchableSelect ya lo soporta). */
export const PICKER_USERS_LIMIT = 500;

export function useUsers(
  page = 1,
  limit = 10,
  filters?: { search?: string; department?: string; role?: string; position?: string; status?: string },
) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['users', page, limit, filters?.search, filters?.department, filters?.role, filters?.position, filters?.status],
    queryFn: () => api.users.list(token!, page, limit, filters),
    enabled: !!token,
  });
}

/**
 * P8-C: hook especializado para pickers (dropdowns, SearchableSelect) que
 * necesitan "todos los usuarios activos" en UI. Cachea 5 min porque el
 * dataset cambia lentamente, y limita a usuarios activos solamente para
 * reducir payload. Si el tenant tiene >500 usuarios, migrar a
 * autocomplete con backend search.
 */
export function useActiveUsersForPicker() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['users', 'active-picker'],
    queryFn: () => api.users.list(token!, 1, PICKER_USERS_LIMIT, { status: 'active' }),
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // 5 min
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
