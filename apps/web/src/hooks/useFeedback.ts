'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useCheckIns() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'checkins'],
    queryFn: () => api.feedback.listCheckIns(token!),
    enabled: !!token,
  });
}

export function useCreateCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.feedback.createCheckIn(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useUpdateCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.feedback.updateCheckIn(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useCompleteCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: { notes?: string; actionItems?: any[]; rating?: number } }) =>
      api.feedback.completeCheckIn(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useReceivedFeedback() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'received'],
    queryFn: () => api.feedback.receivedFeedback(token!),
    enabled: !!token,
  });
}

export function useGivenFeedback() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'given'],
    queryFn: () => api.feedback.givenFeedback(token!),
    enabled: !!token,
  });
}

export function useSendQuickFeedback() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.feedback.sendQuickFeedback(token!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedback', 'given'] });
      qc.invalidateQueries({ queryKey: ['feedback', 'summary'] });
    },
  });
}

export function useFeedbackSummary() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'summary'],
    queryFn: () => api.feedback.summary(token!),
    enabled: !!token,
  });
}

export function useRejectCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.feedback.rejectCheckIn(token!, id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useMeetingLocations() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'locations'],
    queryFn: () => api.feedback.listLocations(token!),
    enabled: !!token,
  });
}

export function useCreateLocation() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.feedback.createLocation(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'locations'] }),
  });
}

export function useUpdateLocation() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.feedback.updateLocation(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'locations'] }),
  });
}

export function useDeleteLocation() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.feedback.deleteLocation(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'locations'] }),
  });
}
