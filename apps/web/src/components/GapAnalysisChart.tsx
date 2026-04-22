'use client';

import React from 'react';
// P8-C: import dinámico de Recharts.
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from '@/components/DynamicCharts';

interface GapItem {
  competencyId: string;
  competencyName: string;
  category: string | null;
  expectedLevel: number;
  observedLevel: number | null;
  gap: number | null;
  gapPercentage: number | null;
  status: string;
}

interface GapAnalysisData {
  userId: string;
  cycleId: string;
  userName: string;
  position: string;
  department: string;
  gaps: GapItem[];
  summary: {
    totalCompetencies: number;
    withData: number;
    avgGap: number;
    criticalGaps: number;
    meetsExpectation: number;
  };
  message?: string;
}

interface Props {
  data: GapAnalysisData | null | undefined;
  isLoading?: boolean;
}

const statusColors: Record<string, string> = {
  cumple: '#22c55e',
  brecha_menor: '#f59e0b',
  brecha_critica: '#ef4444',
  sin_datos: '#94a3b8',
};

const statusLabels: Record<string, string> = {
  cumple: 'Cumple',
  brecha_menor: 'Brecha menor',
  brecha_critica: 'Brecha critica',
  sin_datos: 'Sin datos',
};

export default function GapAnalysisChart({ data, isLoading }: Props) {
  if (isLoading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        Cargando gap analysis...
      </div>
    );
  }

  if (!data || data.gaps.length === 0) {
    return (
      <div style={{
        padding: '2rem',
        textAlign: 'center',
        color: 'var(--text-muted)',
        background: 'var(--bg-card)',
        borderRadius: '0.75rem',
        border: '1px solid var(--border)',
      }}>
        <p style={{ fontSize: '1rem', fontWeight: 600 }}>Sin datos de gap analysis</p>
        <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
          {data?.message || 'No hay perfil de competencias definido para este cargo o no hay evaluaciones completadas.'}
        </p>
      </div>
    );
  }

  const chartData = data.gaps
    .filter((g) => g.observedLevel !== null)
    .map((g) => ({
      name: g.competencyName.length > 18
        ? g.competencyName.substring(0, 16) + '...'
        : g.competencyName,
      fullName: g.competencyName,
      expected: g.expectedLevel,
      observed: g.observedLevel,
      gap: g.gap,
      status: g.status,
    }));

  return (
    <div style={{
      background: 'var(--bg-card)',
      borderRadius: '0.75rem',
      border: '1px solid var(--border)',
      padding: '1.5rem',
    }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          Gap Analysis — {data.userName}
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          {data.position} · {data.department}
        </p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <SummaryCard label="Competencias" value={data.summary.totalCompetencies} color="var(--text-primary)" />
        <SummaryCard label="Cumple" value={data.summary.meetsExpectation} color="#22c55e" />
        <SummaryCard label="Brechas criticas" value={data.summary.criticalGaps} color="#ef4444" />
        <SummaryCard label="Gap promedio" value={data.summary.avgGap > 0 ? `+${data.summary.avgGap}` : `${data.summary.avgGap}`} color={data.summary.avgGap >= 0 ? '#22c55e' : '#ef4444'} />
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <div style={{ width: '100%', height: Math.max(300, chartData.length * 45) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <XAxis type="number" domain={[0, 10]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  fontSize: '0.8rem',
                }}
                formatter={(value: any, name: any) => [
                  Number(value)?.toFixed(1),
                  name === 'expected' ? 'Esperado' : 'Observado',
                ]}
                labelFormatter={(label: any) => {
                  const item = chartData.find((d) => d.name === String(label));
                  return item?.fullName || String(label);
                }}
              />
              <Legend
                formatter={(value) => (value === 'expected' ? 'Nivel esperado' : 'Nivel observado')}
              />
              <Bar dataKey="expected" fill="#94a3b8" barSize={14} radius={[0, 4, 4, 0]} />
              {/* fill en Bar es fallback para Recharts v3 — sin él el
                  Bar renderiza negro antes de que los Cell lo sobreescriban. */}
              <Bar dataKey="observed" fill="#6366f1" barSize={14} radius={[0, 4, 4, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={statusColors[entry.status] || '#6366f1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Detailed list */}
      <div style={{ marginTop: '1.5rem' }}>
        <h4 style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
          Detalle por competencia
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {data.gaps.map((g) => (
            <div
              key={g.competencyId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.6rem 0.8rem',
                background: 'var(--bg-secondary)',
                borderRadius: '0.5rem',
                borderLeft: `3px solid ${statusColors[g.status]}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                  {g.competencyName}
                </span>
                {g.category && (
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginLeft: '0.5rem',
                    padding: '0.1rem 0.4rem',
                    background: 'var(--bg-tertiary)',
                    borderRadius: '0.25rem',
                  }}>
                    {g.category}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Esperado: <strong>{g.expectedLevel}</strong>
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Observado: <strong>{g.observedLevel !== null ? g.observedLevel.toFixed(1) : '—'}</strong>
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    padding: '0.15rem 0.5rem',
                    borderRadius: '1rem',
                    color: '#fff',
                    background: statusColors[g.status],
                    minWidth: '70px',
                    textAlign: 'center',
                  }}
                >
                  {g.gap !== null ? (g.gap >= 0 ? `+${g.gap.toFixed(1)}` : g.gap.toFixed(1)) : statusLabels[g.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '0.5rem',
      padding: '0.75rem',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{label}</div>
    </div>
  );
}
