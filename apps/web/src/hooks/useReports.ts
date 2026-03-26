'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function useCycleSummary(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'summary', cycleId],
    queryFn: () => api.reports.cycleSummary(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}

export function useCompetencyRadar(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'radar', cycleId, userId],
    queryFn: () => api.reports.competencyRadar(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
  });
}

export function useSelfVsOthers(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'selfVsOthers', cycleId, userId],
    queryFn: () => api.reports.selfVsOthers(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
  });
}

export function useHeatmap(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'heatmap', cycleId],
    queryFn: () => api.reports.heatmap(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}

export function useBellCurve(cycleId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'bellCurve', cycleId],
    queryFn: () => api.reports.bellCurve(token!, cycleId!),
    enabled: !!token && !!cycleId,
  });
}

export function useGapAnalysisIndividual(cycleId: string | null, userId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'gapAnalysis', cycleId, userId],
    queryFn: () => api.reports.gapAnalysisIndividual(token!, cycleId!, userId!),
    enabled: !!token && !!cycleId && !!userId,
  });
}

export function useGapAnalysisTeam(cycleId: string | null, managerId: string | null) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'gapAnalysisTeam', cycleId, managerId],
    queryFn: () => api.reports.gapAnalysisTeam(token!, cycleId!, managerId!),
    enabled: !!token && !!cycleId && !!managerId,
  });
}

export function useCompetencyHeatmap(cycleId: string | null, filters?: { department?: string; position?: string }) {
  const token = useAuthStore((s) => s.token);
  return useQuery({
    queryKey: ['reports', 'competencyHeatmap', cycleId, filters?.department, filters?.position],
    queryFn: () => api.reports.competencyHeatmap(token!, cycleId!, filters),
    enabled: !!token && !!cycleId,
  });
}
