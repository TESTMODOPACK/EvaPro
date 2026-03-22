'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function usePeerAssignments(cycleId: string) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['peerAssignments', cycleId],
    queryFn: () => api.peerAssignments.list(token!, cycleId),
    enabled: !!token && !!cycleId,
  });
}

export function useAddPeerAssignment() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cycleId, evaluateeId, evaluatorId }: { cycleId: string; evaluateeId: string; evaluatorId: string }) =>
      api.peerAssignments.add(token!, cycleId, { evaluateeId, evaluatorId }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['peerAssignments', vars.cycleId] }),
  });
}

export function useRemovePeerAssignment() {
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cycleId, id }: { cycleId: string; id: string }) =>
      api.peerAssignments.remove(token!, cycleId, id),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['peerAssignments', vars.cycleId] }),
  });
}
