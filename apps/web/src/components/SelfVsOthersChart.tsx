'use client';

import { useSelfVsOthers } from '@/hooks/useReports';
// P8-C: import dinámico de Recharts.
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer,
} from '@/components/DynamicCharts';

const relationLabels: Record<string, string> = {
  self: 'Autoevaluaci\u00f3n', manager: 'Encargado', peer: 'Par',
  direct_report: 'Reporte directo', external: 'Externo',
};

const relationColors: Record<string, string> = {
  self: '#6366f1', manager: '#10b981', peer: '#f59e0b',
  direct_report: '#8b5cf6', external: '#ec4899',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
      <span className="spinner" />
    </div>
  );
}

export default function SelfVsOthersChart({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data, isLoading } = useSelfVsOthers(cycleId, userId);

  if (isLoading) return <Spinner />;
  if (!data || (data.selfScore == null && data.othersAvg == null)) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos suficientes para comparar</p>
      </div>
    );
  }

  const chartData = [
    { name: 'Autoevaluaci\u00f3n', score: data.selfScore || 0, fill: '#6366f1' },
    { name: 'Promedio Otros', score: data.othersAvg || 0, fill: '#10b981' },
    ...Object.entries(data.byRelation || {})
      .filter(([, score]) => score != null && score !== 0)
      .map(([rel, score]) => ({
        name: relationLabels[rel] || rel,
        score: score as number,
        fill: relationColors[rel] || 'var(--accent)',
      })),
  ];

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        Autopercepci&oacute;n vs Percepci&oacute;n Externa
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Comparaci&oacute;n entre la autoevaluaci&oacute;n y los puntajes otorgados por otros
      </p>

      {data.gap != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', padding: '0.75rem', background: Math.abs(data.gap) > 1 ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: Math.abs(data.gap) > 1 ? 'var(--danger)' : 'var(--success)' }}>
            {data.gap > 0 ? '+' : ''}{data.gap.toFixed(2)}
          </span>
          <div>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: 0 }}>Brecha (Gap)</p>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>{data.interpretation}</p>
          </div>
        </div>
      )}

      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <YAxis domain={[0, 10]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <Tooltip
            content={({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.78rem' }}>
                  <p style={{ fontWeight: 700 }}>{label}</p>
                  <p style={{ color: payload[0]?.payload?.fill }}>{payload[0]?.value?.toFixed(2)}</p>
                </div>
              );
            }}
          />
          {/* fill en Bar es fallback para Recharts v3 — sin él el Bar
              renderiza negro antes de que los Cell apliquen entry.fill. */}
          <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
