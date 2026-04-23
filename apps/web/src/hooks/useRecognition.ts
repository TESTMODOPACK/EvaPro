'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface WallFilters {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  valueId?: string;
  departmentId?: string;
  scope?: 'all' | 'received' | 'sent' | 'mine';
}

export function useRecognitionWall(page = 1, filters: WallFilters = {}) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['recognition', 'wall', page, filters],
    queryFn: () => api.recognition.wall(token!, page, 20, filters),
    enabled: !!token,
  });
}

export function useCreateRecognition() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { toUserId: string; message: string; valueId?: string; points?: number }) =>
      api.recognition.create(token!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recognition'] });
    },
  });
}

export function useAddReaction() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, emoji }: { id: string; emoji: string }) =>
      api.recognition.addReaction(token!, id, emoji),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recognition', 'wall'] });
    },
  });
}

export function useBadges() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['recognition', 'badges'],
    queryFn: () => api.recognition.badges(token!),
    enabled: !!token,
  });
}

export function useMyBadges() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['recognition', 'badges', 'mine'],
    queryFn: () => api.recognition.myBadges(token!),
    enabled: !!token,
  });
}

export function useMyPoints() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['recognition', 'points', 'mine'],
    queryFn: () => api.recognition.myPoints(token!),
    enabled: !!token,
  });
}

export function useLeaderboard(period = 'year') {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['recognition', 'leaderboard', period],
    queryFn: () => api.recognition.leaderboard(token!, period),
    enabled: !!token,
  });
}

export function useRecognitionStats() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['recognition', 'stats'],
    queryFn: () => api.recognition.stats(token!),
    enabled: !!token,
  });
}
