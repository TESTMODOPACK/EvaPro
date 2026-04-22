'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/**
 * v3.1 Tema B — Hooks para reuniones de equipo (N participantes).
 * Entidad paralela a check-ins 1:1; comparte el catálogo de locations
 * pero tiene su propio ciclo de vida.
 */

export function useTeamMeetings() {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['team-meetings'],
    queryFn: () => api.teamMeetings.list(token!),
    enabled: !!token,
  });
}

export function useTeamMeeting(id: string | null | undefined) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['team-meetings', id],
    queryFn: () => api.teamMeetings.getById(token!, id!),
    enabled: !!token && !!id,
  });
}

export function useCreateTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.teamMeetings.create>[1]) =>
      api.teamMeetings.create(token!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
    },
  });
}

export function useUpdateTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.teamMeetings.update(token!, id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
      qc.invalidateQueries({ queryKey: ['team-meetings', vars.id] });
    },
  });
}

export function useCancelTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.teamMeetings.cancel(token!, id, reason),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
      qc.invalidateQueries({ queryKey: ['team-meetings', vars.id] });
    },
  });
}

export function useCompleteTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.teamMeetings.complete>[2] }) =>
      api.teamMeetings.complete(token!, id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
      qc.invalidateQueries({ queryKey: ['team-meetings', vars.id] });
    },
  });
}

export function useRespondTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      declineReason,
    }: {
      id: string;
      status: 'accepted' | 'declined';
      declineReason?: string;
    }) => api.teamMeetings.respond(token!, id, status, declineReason),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
      qc.invalidateQueries({ queryKey: ['team-meetings', vars.id] });
    },
  });
}

/**
 * v3.1 — Edición retroactiva de reunión COMPLETED (ej. auto-cerrada por
 * cron +5 días). Solo organizador o admin.
 */
export function useEditCompletedTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof api.teamMeetings.editCompleted>[2] }) =>
      api.teamMeetings.editCompleted(token!, id, data),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
      qc.invalidateQueries({ queryKey: ['team-meetings', vars.id] });
    },
  });
}

export function useAddTopicToTeamMeeting() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api.teamMeetings.addTopic(token!, id, text),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['team-meetings'] });
      qc.invalidateQueries({ queryKey: ['team-meetings', vars.id] });
    },
  });
}
