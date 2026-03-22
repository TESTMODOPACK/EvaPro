'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useCycles() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['cycles'],
    queryFn: () => api.cycles.list(token!),
    enabled: !!token,
  });
}

export function useCycleById(id: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['cycles', id],
    queryFn: () => api.cycles.getById(token!, id),
    enabled: !!token && !!id,
  });
}

export function useCycleAssignments(cycleId: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['cycles', cycleId, 'assignments'],
    queryFn: () => api.cycles.getAssignments(token!, cycleId),
    enabled: !!token && !!cycleId,
  });
}

export function useCreateCycle() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.cycles.create(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycles'] }),
  });
}

export function useUpdateCycle() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.cycles.update(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycles'] }),
  });
}

export function useLaunchCycle() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cycles.launch(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycles'] }),
  });
}

export function useCloseCycle() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cycles.close(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cycles'] }),
  });
}
