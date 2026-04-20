'use client';

import { useCompetencyRadar } from '@/hooks/useReports';
// P8-C: import dinámico de Recharts.
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip, Legend,
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

export default function CompetencyRadarChart({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data, isLoading } = useCompetencyRadar(cycleId, userId);

  if (isLoading) return <Spinner />;
  if (!data || !data.sections || data.sections.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {data?.message || 'Sin datos de competencias para este colaborador'}
        </p>
      </div>
    );
  }

  const radarData = data.sections.map((s: any) => ({
    subject: (s.section || '').length > 20 ? (s.section || '').slice(0, 18) + '...' : (s.section || 'Sin nombre'),
    fullName: s.section || 'Sin nombre',
    overall: s.overall,
    maxScale: s.maxScale,
    ...s.byRelation,
  }));

  const allRelations: string[] = Array.from(new Set(data.sections.flatMap((s: any) => Object.keys(s.byRelation)))) as string[];

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        Radar de Competencias
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        Puntaje promedio por secci&oacute;n de la plantilla, desglosado por tipo de evaluador
      </p>
      <ResponsiveContainer width="100%" height={380}>
        <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="var(--border)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
          <PolarRadiusAxis angle={90} domain={[0, Math.max(...radarData.map((d: any) => d.maxScale || 5))]} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
          {allRelations.map((rel) => (
            <Radar
              key={rel}
              name={relationLabels[rel] || rel}
              dataKey={rel}
              stroke={relationColors[rel] || 'var(--accent)'}
              fill={relationColors[rel] || 'var(--accent)'}
              fillOpacity={0.15}
              strokeWidth={2}
            />
          ))}
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              return (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.78rem' }}>
                  <p style={{ fontWeight: 700, marginBottom: '0.3rem' }}>{payload[0]?.payload?.fullName}</p>
                  {payload.map((p: any) => (
                    <p key={p.dataKey} style={{ color: p.stroke }}>
                      {p.name}: {p.value?.toFixed(2)}
                    </p>
                  ))}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
