'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useNotifications(limit?: number) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['notifications', 'list', limit],
    queryFn: () => api.notifications.list(token!, limit),
    enabled: !!token,
    refetchInterval: 60000, // Poll every 60s
  });
}

export function useUnreadCount() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notifications.unreadCount(token!),
    enabled: !!token,
    refetchInterval: 30000, // Poll every 30s
  });
}

export function useMarkAsRead() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notifications.markAsRead(token!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllAsRead() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markAllAsRead(token!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
