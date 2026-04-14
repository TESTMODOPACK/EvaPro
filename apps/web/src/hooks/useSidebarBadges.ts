'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface SidebarBadges {
  notifications: number;
  evaluations: number;
  surveys: number;
  objectives: number;
}

export function useSidebarBadges() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === 'super_admin';

  return useQuery<SidebarBadges>({
    queryKey: ['sidebar', 'badges'],
    queryFn: async () => {
      const [unread, nextActions, pendingSurveys, pendingEvals] = await Promise.all([
        api.notifications.unreadCount(token!).catch(() => ({ count: 0 })),
        api.dashboard.nextActions(token!).catch(() => ({ actions: [] })),
        api.surveys.getMyPending(token!).catch(() => []),
        api.evaluations.pending(token!).catch(() => []),
      ]);

      const actions = nextActions?.actions || [];
      const evalCount = Array.isArray(pendingEvals) ? pendingEvals.length : 0;
      return {
        notifications: unread?.count || 0,
        evaluations: evalCount,
        surveys: Array.isArray(pendingSurveys) ? pendingSurveys.length : 0,
        objectives: actions.filter((a: any) => a.type === 'okr').length,
      };
    },
    enabled: !!token && !isSuperAdmin,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
