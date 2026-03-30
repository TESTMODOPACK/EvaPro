'use client';

import { useState, useCallback } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
import { useCompetencyRadar, useSelfVsOthers, useHeatmap, useBellCurve, useCompetencyHeatmap } from '@/hooks/useReports';
import { useCycles } from '@/hooks/useCycles';
import { useUsers } from '@/hooks/useUsers';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
  ComposedChart,
  Area,
} from 'recharts';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  minWidth: '220px',
};

const relationLabels: Record<string, string> = {
  self: 'Autoevaluaci\u00f3n',
  manager: 'Encargado',
  peer: 'Par',
  direct_report: 'Reporte directo',
  external: 'Externo',
};

const relationColors: Record<string, string> = {
  self: '#6366f1',
  manager: '#10b981',
  peer: '#f59e0b',
  direct_report: '#8b5cf6',
  external: '#ec4899',
};

function scoreColor(score: number): string {
  if (score < 4) return 'var(--danger)';
  if (score < 7) return 'var(--warning)';
  return 'var(--success)';
}

function scoreLabel(score: number): string {
  if (score < 4) return 'Bajo';
  if (score < 7) return 'Medio';
  return 'Alto';
}

/* ─── Competency Bar Chart Section (replaces Radar) ─────────────── */

function CompetencyRadarSection({ cycleId, userId }: { cycleId: string; userId: string }) {
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

  const allRelations: string[] = Array.from(
    new Set(data.sections.flatMap((s: any) => Object.keys(s.byRelation))),
  ) as string[];

  const maxScale = Math.max(...data.sections.map((s: any) => s.maxScale || 5));

  // One entry per section — dynamic keys for each relation type
  const chartData = data.sections.map((s: any) => ({
    section:
      (s.section || 'Sin nombre').length > 24
        ? (s.section || '').slice(0, 22) + '\u2026'
        : (s.section || 'Sin nombre'),
    fullName: s.section || 'Sin nombre',
    ...s.byRelation,
  }));

  // Height scales with number of sections × number of relation bars
  const chartHeight = Math.max(260, data.sections.length * Math.max(52, allRelations.length * 22 + 16));

  const barTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.78rem' }}>
        <p style={{ fontWeight: 700, marginBottom: '0.3rem' }}>{payload[0]?.payload?.fullName}</p>
        {payload.map((p: any) => (
          <p key={p.dataKey} style={{ color: p.fill || 'var(--text-secondary)', margin: '0.1rem 0' }}>
            {p.name}: <strong>{p.value?.toFixed(2)}</strong> / {maxScale}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        {'Puntaje por Secci\u00f3n y Evaluador'}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        {'Puntaje promedio por secci\u00f3n de la plantilla, desglosado por tipo de evaluador'}
      </p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ top: 4, right: 30, bottom: 4, left: 8 }}
          barGap={3}
          barCategoryGap="28%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, maxScale]}
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={{ stroke: 'var(--border)' }}
          />
          <YAxis
            type="category"
            dataKey="section"
            width={148}
            tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={{ stroke: 'var(--border)' }}
          />
          <Tooltip content={barTooltip} />
          <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
          {allRelations.map((rel) => (
            <Bar
              key={rel}
              dataKey={rel}
              name={relationLabels[rel] || rel}
              fill={relationColors[rel] || 'var(--accent)'}
              radius={[0, 3, 3, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Self vs Others Section ───────────────────────────────────────── */

function SelfVsOthersSection({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data, isLoading } = useSelfVsOthers(cycleId, userId);

  if (isLoading) return <Spinner />;
  if (!data || (data.selfScore == null && data.othersAvg == null)) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{'Sin datos suficientes para comparar'}</p>
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
        {'Autoevaluaci\u00f3n vs Evaluadores'}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {'Comparaci\u00f3n entre la autoevaluaci\u00f3n y los puntajes otorgados por otros'}
      </p>

      {/* Gap indicator */}
      {data.gap != null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', padding: '0.75rem', background: Math.abs(data.gap) > 1 ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 800, color: Math.abs(data.gap) > 1 ? 'var(--danger)' : 'var(--success)' }}>
            {data.gap > 0 ? '+' : ''}{data.gap.toFixed(2)}
          </span>
          <div>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, margin: 0 }}>{'Brecha (Gap)'}</p>
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
          <Bar dataKey="score" radius={[4, 4, 0, 0]}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ─── Heatmap Section ──────────────────────────────────────────────── */

function HeatmapSection({ cycleId }: { cycleId: string }) {
  const { data, isLoading } = useHeatmap(cycleId);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (isLoading) return <Spinner />;
  if (!data || !data.heatmap || data.heatmap.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{'Sin datos para el heatmap'}</p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        {'Mapa de Calor por Departamento'}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
        {'Distribuci\u00f3n de colaboradores por nivel de desempe\u00f1o en cada departamento'}
      </p>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.72rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--danger)', display: 'inline-block' }} /> {'Bajo (<4)'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--warning)', display: 'inline-block' }} /> {'Medio (4-7)'}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--success)', display: 'inline-block' }} /> {'Alto (\u22657)'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {data.heatmap.map((dept: any) => {
          const total = dept.total || 1;
          return (
            <div key={dept.department}>
              <div
                className="card"
                style={{ padding: '0.75rem 1rem', cursor: 'pointer' }}
                onClick={() => setExpanded(expanded === dept.department ? null : dept.department)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{dept.department}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: scoreColor(dept.avgScore) }}>
                      {dept.avgScore.toFixed(1)}
                    </span>
                    <span className={`badge ${dept.avgScore >= 7 ? 'badge-success' : dept.avgScore >= 4 ? 'badge-warning' : 'badge-danger'}`} style={{ fontSize: '0.65rem' }}>
                      {scoreLabel(dept.avgScore)}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {dept.total} {dept.total === 1 ? 'persona' : 'personas'}
                    {' '}{expanded === dept.department ? '\u25BC' : '\u25B6'}
                  </span>
                </div>

                {/* Stacked bar */}
                <div style={{ display: 'flex', height: '16px', borderRadius: '8px', overflow: 'hidden', background: 'var(--border)' }}>
                  {dept.low > 0 && (
                    <div style={{ width: `${(dept.low / total) * 100}%`, background: 'var(--danger)', transition: 'width 0.3s' }} title={`Bajo: ${dept.low}`} />
                  )}
                  {dept.mid > 0 && (
                    <div style={{ width: `${(dept.mid / total) * 100}%`, background: 'var(--warning)', transition: 'width 0.3s' }} title={`Medio: ${dept.mid}`} />
                  )}
                  {dept.high > 0 && (
                    <div style={{ width: `${(dept.high / total) * 100}%`, background: 'var(--success)', transition: 'width 0.3s' }} title={`Alto: ${dept.high}`} />
                  )}
                </div>
              </div>

              {/* Expanded user list */}
              {expanded === dept.department && (
                <div style={{ padding: '0.5rem 1rem', marginTop: '-0.25rem' }}>
                  {dept.privacyRestricted ? (
                    <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 6px)' }}>
                      Detalle individual no disponible — se requieren al menos 5 personas en el departamento para garantizar privacidad
                    </div>
                  ) : dept.users && dept.users.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {dept.users.map((u: any, i: number) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.8rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{u.name}</span>
                          <span style={{ fontWeight: 700, color: scoreColor(u.score) }}>{u.score.toFixed(1)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: '0.5rem', textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Sin detalle disponible
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Bell Curve Section ──────────────────────────────────────────── */

function BellCurveSection({ cycleId }: { cycleId: string }) {
  const { data, isLoading } = useBellCurve(cycleId);

  if (isLoading) return <Spinner />;
  if (!data || !data.histogram || data.count === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos suficientes para la curva de distribución</p>
      </div>
    );
  }

  if (data.privacyRestricted) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600 }}>
          {data.message || `Se requieren al menos 5 evaluaciones para mostrar la distribución (actualmente: ${data.count})`}
        </p>
      </div>
    );
  }

  // ── Compute zone breakdown from histogram buckets ──
  const total = data.count || 1;
  let cntLow = 0, cntMid = 0, cntHigh = 0;
  for (const bucket of (data.histogram as any[])) {
    const start = parseFloat((bucket.range as string).split('-')[0]);
    if (!isNaN(start)) {
      if (start < 4) cntLow += bucket.count;
      else if (start < 7) cntMid += bucket.count;
      else cntHigh += bucket.count;
    }
  }
  const pctLow = Math.round((cntLow / total) * 100);
  const pctMid = Math.round((cntMid / total) * 100);
  const pctHigh = Math.round((cntHigh / total) * 100);

  const mean = Number(data.mean);
  const stddev = Number(data.stddev);

  // ── Interpretive messages ──
  const meanMsg =
    mean >= 7.5 ? { text: 'Puntaje promedio muy alto — tendencia generalizada de buenos resultados. Verificar si puede haber sesgo de leniencia.', color: 'var(--success)' }
    : mean >= 6.0 ? { text: 'Puntaje promedio alto — la organización muestra buen desempeño general.', color: 'var(--success)' }
    : mean >= 4.5 ? { text: 'Puntaje promedio en rango medio — desempeño heterogéneo entre colaboradores.', color: 'var(--warning)' }
    : { text: 'Puntaje promedio bajo — existen áreas de mejora significativas en la organización.', color: 'var(--danger)' };

  const dispMsg =
    stddev < 1.0 ? { text: 'Dispersión muy baja (σ=' + data.stddev + '): los evaluadores tienden a asignar puntajes muy similares, lo que puede indicar poca diferenciación o uniformidad de criterios.', icon: '⚠️' }
    : stddev > 2.5 ? { text: 'Dispersión alta (σ=' + data.stddev + '): hay mucha variabilidad entre los puntajes, lo que puede reflejar criterios inconsistentes entre jefaturas o equipos.', icon: '⚠️' }
    : { text: 'Dispersión normal (σ=' + data.stddev + '): la variabilidad es saludable y permite distinguir bien los niveles de desempeño.', icon: '✅' };

  const biasMsg =
    pctHigh > 60 ? '⚠️ Más del 60% de las evaluaciones quedaron en zona alta. Posible sesgo de leniencia — considerar calibración.'
    : pctLow > 60 ? '⚠️ Más del 60% de las evaluaciones quedaron en zona baja. Puede haber sesgo de dureza o problemas de desempeño generalizados.'
    : pctMid > 65 ? '⚠️ Alta concentración en la franja media. Baja diferenciación — la escala puede no estar siendo bien utilizada.'
    : null;

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        Distribución de Puntajes (Curva de Bell)
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Histograma de puntajes con curva normal superpuesta
      </p>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.85rem', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Promedio: </span>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{data.mean}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Desv. Estándar: </span>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{data.stddev}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Total evaluaciones: </span>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{data.count}</span>
        </div>
      </div>

      {/* How to read */}
      <div style={{ padding: '0.55rem 0.85rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem', fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>¿Cómo leer este gráfico?</strong>
        {' '}Las barras muestran cuántos colaboradores obtuvieron cada rango de puntaje.
        La línea amarilla es la curva normal teórica con la misma media y desviación.
        Si las barras siguen de cerca esa línea, la distribución es equilibrada.
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data.histogram} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={1} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.78rem' }}>
                  <p style={{ fontWeight: 700 }}>Rango: {d?.rangeLabel}</p>
                  <p style={{ color: '#6366f1' }}>Cantidad: {d?.count}</p>
                  <p style={{ color: '#f59e0b' }}>Curva normal: {d?.normalY?.toFixed(1)}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill="#6366f1" fillOpacity={0.7} radius={[2, 2, 0, 0]} name="Evaluaciones" />
          <Area type="monotone" dataKey="normalY" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} name="Curva Normal" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* ── Análisis de resultados ── */}
      <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.85rem', color: 'var(--text-primary)' }}>
          Análisis de resultados
        </p>

        {/* Zone breakdown */}
        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Distribución por zona
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Bajo (<4)', pct: pctLow, cnt: cntLow, color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
              { label: 'Medio (4–7)', pct: pctMid, cnt: cntMid, color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
              { label: 'Alto (>7)', pct: pctHigh, cnt: cntHigh, color: 'var(--success)', bg: 'rgba(16,185,129,0.08)' },
            ].map((z) => (
              <div key={z.label} style={{ flex: '1 1 120px', padding: '0.6rem 0.85rem', background: z.bg, borderRadius: 'var(--radius-sm)', border: `1px solid ${z.color}33` }}>
                <p style={{ fontSize: '1.3rem', fontWeight: 800, color: z.color, margin: 0 }}>{z.pct}%</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>{z.label}</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{z.cnt} persona{z.cnt !== 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Interpretive bullets */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          {/* Mean */}
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <span style={{ color: meanMsg.color, fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>
              {mean >= 6.0 ? '✅' : mean >= 4.5 ? '⚠️' : '🔴'}
            </span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <strong>Tendencia central:</strong> {meanMsg.text}
            </span>
          </div>

          {/* Dispersion */}
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>{dispMsg.icon}</span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <strong>Dispersión:</strong> {dispMsg.text}
            </span>
          </div>

          {/* Bias warning if applicable */}
          {biasMsg && (
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
              <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>🔔</span>
              <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <strong>Alerta de distribución:</strong> {biasMsg.replace(/^⚠️\s*/, '')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Competency Heatmap Section ──────────────────────────────────── */

function heatColor(avg: number | null, maxScale: number): string {
  if (avg === null) return 'var(--bg-surface)';
  const ratio = avg / maxScale;
  if (ratio >= 0.75) return 'rgba(16,185,129,0.22)';
  if (ratio >= 0.55) return 'rgba(245,158,11,0.18)';
  return 'rgba(239,68,68,0.20)';
}

function CompetencyHeatmapSection({
  cycleId,
  deptFilter,
  posFilter,
}: {
  cycleId: string;
  deptFilter?: string;
  posFilter?: string;
}) {
  const activeFilters =
    deptFilter || posFilter
      ? { department: deptFilter, position: posFilter }
      : undefined;
  const { data, isLoading } = useCompetencyHeatmap(cycleId, activeFilters);

  if (isLoading) return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Cargando mapa de competencias...</p>
    </div>
  );

  if (!data || !data.grid || data.grid.length === 0) {
    return (
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>
          Mapa de Competencias por Departamento
        </h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {(data as any)?.message || 'Sin datos disponibles para este ciclo'}
        </p>
      </div>
    );
  }

  const { departments, grid, privacyThreshold } = data;
  const hasPrivacyRows = (departments as string[]).some((d) =>
    (grid as any[]).some((r: any) => r.values.find((v: any) => v.department === d && v.privacyRestricted)),
  );

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.2rem' }}>
            Mapa de Competencias por Departamento
          </h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Puntaje promedio por secci&oacute;n &mdash; filas: competencias, columnas: departamentos
            {(deptFilter || posFilter) && (
              <span style={{ color: 'var(--accent)', marginLeft: '0.4rem' }}>
                &bull; filtrado por {[deptFilter, posFilter].filter(Boolean).join(' / ')}
              </span>
            )}
          </p>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(16,185,129,0.22)', borderRadius: 2, border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)', marginRight: '0.4rem' }}>Alto</span>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(245,158,11,0.18)', borderRadius: 2, border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)', marginRight: '0.4rem' }}>Medio</span>
          <span style={{ display: 'inline-block', width: 12, height: 12, background: 'rgba(239,68,68,0.20)', borderRadius: 2, border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)' }}>Bajo</span>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '500px' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', minWidth: '150px' }}>
                Secci&oacute;n / Competencia
              </th>
              {(departments as string[]).map((dept: string) => (
                <th key={dept} style={{ padding: '0.5rem', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', maxWidth: '110px' }} title={dept}>
                  {dept.length > 14 ? dept.slice(0, 13) + '\u2026' : dept}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(grid as any[]).map((row: any) => (
              <tr key={row.section} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                  {row.section}
                </td>
                {row.values.map((cell: any) => (
                  <td
                    key={cell.department}
                    style={{
                      padding: '0.55rem 0.5rem',
                      textAlign: 'center',
                      background: cell.privacyRestricted
                        ? 'transparent'
                        : heatColor(cell.avg, row.maxScale ?? 5),
                      fontWeight: cell.avg !== null && !cell.privacyRestricted ? 700 : 400,
                      color: cell.privacyRestricted
                        ? 'var(--text-muted)'
                        : cell.avg !== null
                          ? 'var(--text-primary)'
                          : 'var(--text-muted)',
                      fontSize: '0.82rem',
                    }}
                    title={
                      cell.privacyRestricted
                        ? `Privacidad: se requieren al menos ${privacyThreshold} evaluados`
                        : cell.avg !== null
                          ? `${cell.count} respuestas \u00b7 escala 1-${row.maxScale ?? 5}`
                          : 'Sin datos'
                    }
                  >
                    {cell.privacyRestricted ? '\uD83D\uDD12' : cell.avg !== null ? cell.avg.toFixed(1) : '\u2014'}
                    {!cell.privacyRestricted && cell.count > 0 && (
                      <span style={{ display: 'block', fontSize: '0.68rem', fontWeight: 400, opacity: 0.6 }}>
                        n={cell.count}
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasPrivacyRows && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
          {'\uD83D\uDD12 Departamentos con menos de '}{privacyThreshold}{' evaluados se ocultan para proteger la privacidad'}
        </p>
      )}
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────── */

export default function InformesPage() {
  const token = useAuthStore((s) => s.token);
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: usersPage } = useUsers();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = useCallback(async (format: 'pptx' | 'csv') => {
    if (!token || !selectedCycleId) return;
    setExporting(format);
    try {
      const res = await fetch(`${BASE_URL}/reports/cycle/${selectedCycleId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte-${selectedCycleId}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || 'Error al descargar el reporte');
    } finally {
      setExporting(null);
    }
  }, [token, selectedCycleId]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Advanced filters
  const [filterDepartment, setFilterDepartment] = useState('');
  const [filterPosition, setFilterPosition] = useState('');

  const users = usersPage?.data || [];

  // Reset user selection when filters change
  const filterKey = `${filterDepartment}|${filterPosition}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setSelectedUserId(null);
  }

  // Extract unique departments and positions from users
  const departments = Array.from(new Set(users.map((u: any) => u.department).filter(Boolean))).sort() as string[];
  const positions = Array.from(new Set(users.map((u: any) => u.position).filter(Boolean))).sort() as string[];
  const sortedCycles = cycles
    ? [...cycles].sort((a: any, b: any) => {
        if (a.status === 'closed' && b.status !== 'closed') return -1;
        if (a.status !== 'closed' && b.status === 'closed') return 1;
        return 0;
      })
    : [];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Informes Avanzados</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Distribuci&oacute;n de puntajes, mapa de competencias y an&aacute;lisis individual por colaborador
          </p>
        </div>
        {selectedCycleId && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-primary"
              style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
              onClick={() => handleExport('pptx')}
              disabled={exporting === 'pptx'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {exporting === 'pptx' ? 'Generando...' : 'PowerPoint'}
            </button>
            <button
              className="btn-ghost"
              style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
              onClick={() => handleExport('csv')}
              disabled={exporting === 'csv'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {exporting === 'csv' ? 'Generando...' : 'CSV'}
            </button>
          </div>
        )}
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button onClick={() => setShowGuide(!showGuide)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: 0 }}>
          {showGuide ? '\u25BC Ocultar gu\u00eda' : '\u25B6 \u00bfC\u00f3mo usar esta p\u00e1gina?'}
        </button>
        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--accent)' }}>
              Gu&iacute;a de uso: Informes Avanzados
            </h3>

            {/* Section A */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>📊</span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  Vista General &mdash; resultados del ciclo completo
                </span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li>
                  <strong>Distribuci&oacute;n de Puntajes (Curva de Bell):</strong>{' '}
                  Histograma que muestra cu&aacute;ntos colaboradores obtuvieron cada rango de puntaje en el ciclo.
                  La l&iacute;nea amarilla superpuesta es la curva normal te&oacute;rica.
                  Permite ver si los resultados siguen una distribuci&oacute;n balanceada o si hay un sesgo
                  (muchos puntajes muy altos o muy bajos), lo cual puede indicar leniencia, dureza o falta de diferenciaci&oacute;n en las evaluaciones.
                  Incluye media y desviaci&oacute;n est&aacute;ndar para comparar entre ciclos.
                </li>
                <li>
                  <strong>Mapa de Competencias por Departamento:</strong>{' '}
                  Tabla de calor (filas = secciones de la plantilla, columnas = departamentos).
                  El color indica el nivel: verde alto, amarillo medio, rojo bajo.
                  Permite identificar qu&eacute; &aacute;reas de competencia son d&eacute;biles en qu&eacute; departamentos.
                  Usa los filtros <em>Departamento</em> y <em>Cargo</em> para acotar la vista.
                  Departamentos con menos de 5 evaluados se ocultan por privacidad.
                </li>
                <li>
                  <strong>Mapa de Calor por Departamento:</strong>{' '}
                  Vista global de todos los departamentos con barra rojo/amarillo/verde mostrando
                  cu&aacute;ntos colaboradores est&aacute;n en nivel bajo, medio o alto.
                  Siempre muestra todos los departamentos del ciclo (no aplica filtros).
                  Haz clic en un departamento para ver el detalle individual.
                </li>
              </ul>
            </div>

            {/* Section B */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>👤</span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  Vista Individual &mdash; an&aacute;lisis de un colaborador espec&iacute;fico
                </span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li>
                  <strong>Puntaje por Secci&oacute;n y Evaluador:</strong>{' '}
                  Gr&aacute;fico de barras horizontales agrupadas: cada secci&oacute;n de la plantilla tiene una barra
                  por tipo de evaluador (autoevaluaci&oacute;n, encargado, par, reporte directo).
                  Permite comparar si el colaborador se eval&uacute;a igual o diferente a como lo ven sus evaluadores
                  secci&oacute;n por secci&oacute;n.
                </li>
                <li>
                  <strong>Autoevaluaci&oacute;n vs Evaluadores:</strong>{' '}
                  Compara el puntaje global del colaborador versus el promedio de sus evaluadores.
                  Incluye indicador de brecha (gap): un gap positivo grande significa que el colaborador
                  se eval&uacute;a mucho mejor de lo que lo ven otros; un gap negativo indica subestimaci&oacute;n.
                </li>
              </ul>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem', paddingLeft: '1.4rem' }}>
                Para ver esta secci&oacute;n, selecciona un colaborador en el selector inferior.
                Usa <em>Departamento</em> y <em>Cargo</em> para filtrar la lista.
              </p>
            </div>

            <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>Permisos:</strong>{' '}
              Solo Administradores y Encargados de Equipo pueden acceder a esta p&aacute;gina.
              Los colaboradores ven sus resultados individuales en <em>Mi Desempe&ntilde;o</em>.
            </div>
          </div>
        )}
      </div>

      {/* Selectors */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        {/* Row 1: Cycle */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{'Ciclo'}</label>
          {loadingCycles ? <Spinner /> : (
            <select style={selectStyle} value={selectedCycleId || ''} onChange={(e) => setSelectedCycleId(e.target.value || null)}>
              <option value="">{'Selecciona un ciclo'}</option>
              {sortedCycles.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.status === 'closed' ? 'Cerrado' : c.status})</option>
              ))}
            </select>
          )}
        </div>

        {/* Dept + Cargo filters — affect CompetencyHeatmap and collaborator list */}
        {selectedCycleId && (
          <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.65rem' }}>
              Filtros &mdash; Mapa de Competencias y lista de colaboradores
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Departamento</label>
                <select style={{ ...selectStyle, minWidth: '180px' }} value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)}>
                  <option value="">Todos</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Cargo</label>
                <select style={{ ...selectStyle, minWidth: '180px' }} value={filterPosition} onChange={(e) => setFilterPosition(e.target.value)}>
                  <option value="">Todos</option>
                  {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {(filterDepartment || filterPosition) && (
                <button
                  onClick={() => { setFilterDepartment(''); setFilterPosition(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: '0.45rem 0', alignSelf: 'flex-end' }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* No cycle selected */}
      {!selectedCycleId && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{'Selecciona un ciclo para ver los informes'}</p>
        </div>
      )}

      {/* Content */}
      {selectedCycleId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

          {/* ── SECCIÓN GENERAL ─────────────────────────────────────── */}
          <div>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--border)' }}>
              <span style={{ fontSize: '1.1rem' }}>📊</span>
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Vista General
                </h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                  Resultados del ciclo completo &mdash; Distribuci&oacute;n de puntajes y desempe&ntilde;o por departamento
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Bell Curve */}
              <BellCurveSection cycleId={selectedCycleId} />

              {/* Competency Heatmap — responds to Dept + Cargo page filters */}
              <CompetencyHeatmapSection
                cycleId={selectedCycleId}
                deptFilter={filterDepartment || undefined}
                posFilter={filterPosition || undefined}
              />

              {/* Heatmap por Departamento — always global, no filters applied */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Vista global del ciclo &mdash; muestra todos los departamentos sin importar los filtros activos
                  </span>
                </div>
                <HeatmapSection cycleId={selectedCycleId} />
              </div>
            </div>
          </div>

          {/* ── SECCIÓN INDIVIDUAL ──────────────────────────────────── */}
          <div>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--border)' }}>
              <span style={{ fontSize: '1.1rem' }}>👤</span>
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>
                  Vista Individual
                </h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
                  An&aacute;lisis de un colaborador espec&iacute;fico &mdash; Puntaje por secci&oacute;n y comparativa de evaluadores
                </p>
              </div>
            </div>

            {/* User selector */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                Colaborador
              </label>
              <select style={selectStyle} value={selectedUserId || ''} onChange={(e) => setSelectedUserId(e.target.value || null)}>
                <option value="">Selecciona un colaborador&hellip;</option>
                {users
                  .filter((u: any) => (!filterDepartment || u.department === filterDepartment) && (!filterPosition || u.position === filterPosition))
                  .map((u: any) => (
                    <option key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}{u.department ? ` \u2014 ${u.department}` : ''}{u.position ? ` (${u.position})` : ''}
                    </option>
                  ))
                }
              </select>
              {(filterDepartment || filterPosition) && (
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                  Lista filtrada por: {[filterDepartment, filterPosition].filter(Boolean).join(' / ')}
                </p>
              )}
            </div>

            {selectedUserId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <CompetencyRadarSection cycleId={selectedCycleId} userId={selectedUserId} />
                <SelfVsOthersSection cycleId={selectedCycleId} userId={selectedUserId} />
              </div>
            ) : (
              <div className="card" style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                  Selecciona un colaborador de la lista para ver su gr&aacute;fico de puntaje por secci&oacute;n y la comparativa Autoevaluaci&oacute;n vs Evaluadores
                </p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
