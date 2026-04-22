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

/**
 * v3.1 — Historial de temas usados en check-ins previos para autocompletar.
 * Admin ve todo el tenant; manager solo los suyos. StaleTime 5 min: los temas
 * no cambian tan seguido y evitamos refetch en cada keystroke del combobox.
 */
export function useMyTopicsHistory(options?: { enabled?: boolean }) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'my-topics'],
    queryFn: () => api.feedback.getMyTopicsHistory(token!),
    enabled: !!token && options?.enabled !== false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.feedback.createCheckIn(token!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] });
      // v3.1 — el nuevo check-in agrega una entrada al historial de temas.
      qc.invalidateQueries({ queryKey: ['feedback', 'my-topics'] });
    },
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

export function useRequestCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { topic: string; suggestedDate?: string }) =>
      api.feedback.requestCheckIn(token!, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useAcceptCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: { scheduledDate?: string; scheduledTime?: string; locationId?: string } }) =>
      api.feedback.acceptCheckInRequest(token!, id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useDeleteCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.feedback.deleteCheckIn(token!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] }),
  });
}

export function useCancelCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.feedback.updateCheckIn(token!, id, { status: 'cancelled' }),
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

/**
 * v3.1 — Permite a un participante (manager o employee) proponer un
 * tema para el 1:1 scheduled. Tras éxito invalida la lista de check-ins
 * y la query de la agenda mágica de ese check-in específico.
 */
export function useAddTopicToCheckIn() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.feedback.addTopicToCheckIn(token!, id, text),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] });
      qc.invalidateQueries({ queryKey: ['feedback', 'checkin', vars.id, 'agenda'] });
    },
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

// ─── v3.1 F1 — Agenda Mágica de 1:1 ────────────────────────────────────

/**
 * Lee el magicAgenda de un check-in (NO regenera — usa el dato persistido).
 * Retorna null en `magicAgenda` si nunca se generó.
 */
export function useCheckInAgenda(checkinId: string | null | undefined) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['feedback', 'checkin', checkinId, 'agenda'],
    queryFn: () => api.feedback.getMagicAgenda(token!, checkinId!),
    enabled: !!token && !!checkinId,
    // La agenda se puede ver N veces; cache 10 min es razonable porque
    // los datos subyacentes (OKRs, feedback) cambian lento.
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Genera o regenera la agenda mágica on-demand.
 * Input: `{ checkinId, force? }`. Force=true consume crédito IA.
 * Tras éxito, invalida la agenda del checkin y la lista de checkins.
 */
export function useGenerateMagicAgenda() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      checkinId,
      force,
      includeAi,
    }: {
      checkinId: string;
      force?: boolean;
      /** false para saltar la llamada IA y ahorrar crédito. Default true. */
      includeAi?: boolean;
    }) =>
      api.feedback.generateMagicAgenda(token!, checkinId, { force, includeAi }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['feedback', 'checkin', vars.checkinId, 'agenda'] });
      qc.invalidateQueries({ queryKey: ['feedback', 'checkins'] });
      // v3.1 — invalidar quota IA para refrescar la barra si el plan tiene IA.
      qc.invalidateQueries({ queryKey: ['ai', 'quota'] });
    },
  });
}

/**
 * Dismissea sugerencias IA individuales (soft — no las borra).
 */
export function usePatchMagicAgenda() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ checkinId, dismissedSuggestionIds }: { checkinId: string; dismissedSuggestionIds: string[] }) =>
      api.feedback.patchMagicAgenda(token!, checkinId, dismissedSuggestionIds),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['feedback', 'checkin', vars.checkinId, 'agenda'] });
    },
  });
}
