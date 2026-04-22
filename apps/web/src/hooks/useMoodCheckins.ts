'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * v3.1 F3 — Hooks para Mood Tracking.
 */

export function useMyMoodToday() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['mood', 'me', 'today'],
    queryFn: () => api.moodCheckins.getToday(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyMoodHistory(days: number = 30) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['mood', 'me', 'history', days],
    queryFn: () => api.moodCheckins.getMyHistory(token!, days),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSubmitMood() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { score: number; note?: string }) =>
      api.moodCheckins.submit(token!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mood'] });
    },
  });
}

export function useTeamMoodToday(options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['mood', 'team', 'today'],
    queryFn: () => api.moodCheckins.getTeamToday(token!),
    enabled: !!token && options?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useTeamMoodHistory(days: number = 14, options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['mood', 'team', 'history', days],
    queryFn: () => api.moodCheckins.getTeamHistory(token!, days),
    enabled: !!token && options?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}
