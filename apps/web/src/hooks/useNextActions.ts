'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export interface NextAction {
  type: 'evaluation' | 'okr' | 'checkin' | 'review';
  id: string;
  title: string;
  subtitle: string;
  dueDate: string | null;
  daysLeft: number | null;
  urgency: 'high' | 'medium' | 'low';
  href: string;
}

export interface NextActionsData {
  total: number;
  highPriority: number;
  actions: NextAction[];
}

export function useNextActions() {
  const token = useAuthStore((s) => s.token);
  return useQuery<NextActionsData>({
    queryKey: ['dashboard', 'next-actions'],
    queryFn: () => api.dashboard.nextActions(token!),
    enabled: !!token,
    staleTime: 2 * 60 * 1000, // 2 min
  });
}
