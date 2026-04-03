'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * Silently log AI errors instead of blocking UI with alert().
 * The mutation's isPending/isError states handle UI feedback.
 */
function handleAiError(error: any) {
  const msg = error?.message || error?.data?.message || 'Error al comunicarse con la IA';
  console.warn('[AI]', msg);
  // Don't alert — let the component handle error state via mutation.isError
}

export function useAiSummary(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'summary', cycleId, userId],
    queryFn: () => api.ai.getSummary(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
    retry: false,
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
      qc.invalidateQueries({ queryKey: ['ai', 'quota'] }); // Refresh quota
    },
    onError: handleAiError,
  });
}

export function useAiBias(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'bias', cycleId],
    queryFn: () => api.ai.getBias(token!, cycleId!),
    enabled: !!token && !!cycleId,
    retry: false,
  });
}

export function useAnalyzeBias() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cycleId: string) => api.ai.analyzeBias(token!, cycleId),
    onSuccess: (_data, cycleId) => {
      qc.invalidateQueries({ queryKey: ['ai', 'bias', cycleId] });
      qc.invalidateQueries({ queryKey: ['ai', 'quota'] }); // Refresh quota
    },
    onError: handleAiError,
  });
}

export function useAiSuggestions(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'suggestions', cycleId, userId],
    queryFn: () => api.ai.getSuggestions(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
    retry: false,
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
      qc.invalidateQueries({ queryKey: ['ai', 'quota'] }); // Refresh quota
    },
    onError: handleAiError,
  });
}

export function useFlightRisk() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'flight-risk'],
    queryFn: () => api.ai.getFlightRisk(token!),
    enabled: !!token,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function usePerformancePrediction(userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'prediction', userId],
    queryFn: () => api.ai.getPerformancePrediction(token!, userId!),
    enabled: !!token && !!userId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRetentionRecommendations() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'retention'],
    queryFn: () => api.ai.getRetentionRecommendations(token!),
    enabled: !!token,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useExplainability(userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['ai', 'explainability', userId],
    queryFn: () => api.ai.getExplainability(token!, userId!),
    enabled: !!token && !!userId,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
