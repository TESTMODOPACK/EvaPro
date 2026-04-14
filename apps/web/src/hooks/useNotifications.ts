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
    refetchInterval: 60000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
  });
}

export function useUnreadCount() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.notifications.unreadCount(token!),
    enabled: !!token,
    refetchInterval: 30000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
  });
}

export function useMarkAsRead() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notifications.markAsRead(token!, id),
    onMutate: async (id) => {
      // Optimistic update: mark as read locally
      await qc.cancelQueries({ queryKey: ['notifications', 'list'] });
      qc.setQueriesData({ queryKey: ['notifications', 'list'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((n: any) => n.id === id ? { ...n, isRead: true } : n);
      });
      qc.setQueryData(['notifications', 'unread'], (old: any) => {
        if (!old) return old;
        return { count: Math.max(0, (old.count || 0) - 1) };
      });
    },
    onError: () => {
      // Revert on error
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    },
    onSettled: () => {
      // Refetch to sync after mutation
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    },
  });
}

export function useMarkAllAsRead() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.markAllAsRead(token!),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      qc.setQueriesData({ queryKey: ['notifications', 'list'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((n: any) => ({ ...n, isRead: true }));
      });
      qc.setQueryData(['notifications', 'unread'], { count: 0 });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
    },
  });
}

export function useDeleteNotification() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.notifications.deleteOne(token!, id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications', 'list'] });
      let wasUnread = false;
      qc.setQueriesData({ queryKey: ['notifications', 'list'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        const target = old.find((n: any) => n.id === id);
        if (target && !target.isRead) wasUnread = true;
        return old.filter((n: any) => n.id !== id);
      });
      if (wasUnread) {
        qc.setQueryData(['notifications', 'unread'], (old: any) => {
          if (!old) return old;
          return { count: Math.max(0, (old.count || 0) - 1) };
        });
      }
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
      qc.invalidateQueries({ queryKey: ['sidebar', 'badges'] });
    },
  });
}

export function useDeleteAllRead() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.notifications.deleteAllRead(token!),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications', 'list'] });
      qc.setQueriesData({ queryKey: ['notifications', 'list'] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.filter((n: any) => !n.isRead);
      });
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'list'] });
      qc.invalidateQueries({ queryKey: ['notifications', 'unread'] });
      qc.invalidateQueries({ queryKey: ['sidebar', 'badges'] });
    },
  });
}

export function useNotificationPreferences() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.notifications.getPreferences(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateNotificationPreferences() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Record<string, boolean>) => api.notifications.updatePreferences(token!, prefs),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['notifications', 'preferences'] });
    },
  });
}
