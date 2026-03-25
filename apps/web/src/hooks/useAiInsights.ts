'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useAiSummary(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'summary', cycleId, userId],
    queryFn: () => api.ai.getSummary(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
  });
}

export function useGenerateSummary() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cycleId, userId }: { cycleId: string; userId: string }) =>
      api.ai.generateSummary(token!, cycleId, userId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['ai', 'summary', vars.cycleId, vars.userId] });
    },
  });
}

export function useAiBias(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'bias', cycleId],
    queryFn: () => api.ai.getBias(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}

export function useAnalyzeBias() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) => api.ai.analyzeBias(token!, cycleId),
    onSuccess: (_data, cycleId) => {
      qc.invalidateQueries({ queryKey: ['ai', 'bias', cycleId] });
    },
  });
}

export function useAiSuggestions(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'suggestions', cycleId, userId],
    queryFn: () => api.ai.getSuggestions(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
  });
}

export function useGenerateSuggestions() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cycleId, userId }: { cycleId: string; userId: string }) =>
      api.ai.generateSuggestions(token!, cycleId, userId),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['ai', 'suggestions', vars.cycleId, vars.userId] });
    },
  });
}
