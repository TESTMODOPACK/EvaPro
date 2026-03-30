'use client';

import { useState, useEffect } from 'react';
import { useAnalytics } from '@/hooks/usePerformanceHistory';
import { useCycles } from '@/hooks/useCycles';
import { useCompetencyHeatmap, useBellCurve } from '@/hooks/useReports';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
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

function heatColor(avg: number | null, maxScale: number): string {
  if (avg === null) return 'var(--bg-surface)';
  const ratio = avg / maxScale;
  if (ratio >= 0.75) return 'rgba(16,185,129,0.25)';
  if (ratio >= 0.55) return 'rgba(245,158,11,0.20)';
  return 'rgba(239,68,68,0.22)';
}

function CompetencyHeatmapSection({ cycleId }: { cycleId: string }) {
  const [deptFilter, setDeptFilter] = useState('');
  const [sortByAvg, setSortByAvg] = useState(false);

  // Reset filters when cycle changes to avoid stale dept selection
  useEffect(() => {
    setDeptFilter('');
    setSortByAvg(false);
  }, [cycleId]);

  // Unfiltered query — used to populate department dropdown and as base data
  const { data: unfilteredData } = useCompetencyHeatmap(cycleId);

  // Filtered query — only different from above when a filter is active
  const activeFilters = deptFilter ? { department: deptFilter } : undefined;
  const { data, isLoading } = useCompetencyHeatmap(cycleId, activeFilters);

  // Derive available departments from unfiltered data (for the dropdown)
  const availableDepts: string[] = (unfilteredData?.departments as string[]) || [];

  // Helper: compute org-wide average for a row (across all depts, excludes null + privacy-restricted)
  const orgAvg = (row: any): number | null => {
    const vals = (row.values as any[])
      .filter((v) => v.avg !== null && !v.privacyRestricted)
      .map((v) => v.avg as number);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  if (isLoading && !data) return <Spinner />;
  if (!data || !data.grid || data.grid.length === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {(data as any)?.message || 'Sin datos de competencias para este ciclo'}
        </p>
      </div>
    );
  }

  const { departments, grid, privacyThreshold } = data;

  // Sort rows: most-needs-improvement (lowest org avg) first when enabled
  const displayGrid = sortByAvg
    ? [...(grid as any[])].sort((a, b) => (orgAvg(a) ?? 999) - (orgAvg(b) ?? 999))
    : (grid as any[]);

  const hasPrivacyRows = (departments as string[]).some((d) =>
    (grid as any[]).some((r: any) => r.values.find((v: any) => v.department === d && v.privacyRestricted)),
  );

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            {'Mapa de Competencias por Departamento'}
          </h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {'Puntaje promedio por secci\u00f3n — filas: competencias, columnas: departamentos'}
          </p>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(16,185,129,0.25)', borderRadius: '2px', border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>{'Alto (\u226575%)'}</span>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(245,158,11,0.20)', borderRadius: '2px', border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>{'Medio'}</span>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(239,68,68,0.22)', borderRadius: '2px', border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{'Bajo (<55%)'}</span>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem', padding: '0.75rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            Departamento:
          </label>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            style={{ padding: '0.35rem 0.6rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
          >
            <option value="">Todos</option>
            {availableDepts.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sortByAvg}
            onChange={(e) => setSortByAvg(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Ordenar por menor puntaje
        </label>

        {(deptFilter || sortByAvg) && (
          <button
            className="btn-ghost"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', marginLeft: 'auto' }}
            onClick={() => { setDeptFilter(''); setSortByAvg(false); }}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Heatmap table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '600px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', minWidth: '160px' }}>
              {'Secci\u00f3n / Competencia'}
            </th>
            {(departments as string[]).map((dept) => (
              <th key={dept} style={{ padding: '0.5rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', textAlign: 'center', maxWidth: '110px' }} title={dept}>
                {dept.length > 14 ? dept.slice(0, 13) + '\u2026' : dept}
              </th>
            ))}
            {/* Org average column — only shown when no dept filter active */}
            {!deptFilter && (
              <th style={{ padding: '0.5rem 0.5rem', color: 'var(--accent)', fontWeight: 700, fontSize: '0.72rem', textAlign: 'center', borderLeft: '2px solid var(--border)', whiteSpace: 'nowrap' }}>
                Org Ø
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {displayGrid.map((row: any) => {
            const avg = orgAvg(row);
            return (
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
                      background: cell.privacyRestricted ? 'transparent' : heatColor(cell.avg, row.maxScale ?? 10),
                      fontWeight: cell.avg !== null ? 700 : 400,
                      color: cell.privacyRestricted ? 'var(--text-muted)' : cell.avg !== null ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '0.82rem',
                    }}
                    title={cell.privacyRestricted ? `Privacidad: se requieren al menos ${privacyThreshold} evaluados` : cell.avg !== null ? `${cell.count} respuestas · escala 1-${row.maxScale ?? 10}` : 'Sin datos'}
                  >
                    {cell.privacyRestricted ? '\uD83D\uDD12' : cell.avg !== null ? cell.avg.toFixed(1) : '\u2014'}
                  </td>
                ))}
                {/* Org average cell */}
                {!deptFilter && (
                  <td
                    style={{
                      padding: '0.55rem 0.5rem',
                      textAlign: 'center',
                      borderLeft: '2px solid var(--border)',
                      background: avg !== null ? heatColor(avg, row.maxScale ?? 10) : 'transparent',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      color: avg !== null ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                    title={avg !== null ? `Promedio organizacional: ${avg.toFixed(2)} / ${row.maxScale ?? 10}` : 'Sin datos suficientes'}
                  >
                    {avg !== null ? avg.toFixed(1) : '\u2014'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {hasPrivacyRows && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
          {'\uD83D\uDD12 Se ocultan departamentos con menos de '}{privacyThreshold}{' evaluados para proteger la privacidad'}
        </p>
      )}
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

      <div style={{ padding: '0.55rem 0.85rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem', fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>¿Cómo leer este gráfico?</strong>
        {' '}Las barras muestran cuántos colaboradores obtuvieron cada rango de puntaje.
        La línea amarilla es la curva normal teórica con la misma media y desviación.
        Si las barras siguen de cerca esa línea, la distribución es equilibrada.
      </div>

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

      {/* Análisis de resultados */}
      <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.85rem', color: 'var(--text-primary)' }}>
          Análisis de resultados
        </p>

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <span style={{ color: meanMsg.color, fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>
              {mean >= 6.0 ? '✅' : mean >= 4.5 ? '⚠️' : '🔴'}
            </span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <strong>Tendencia central:</strong> {meanMsg.text}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>{dispMsg.icon}</span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <strong>Dispersión:</strong> {dispMsg.text}
            </span>
          </div>

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


const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  minWidth: '250px',
};

export default function AnalyticsPage() {
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const { data: analytics, isLoading: loadingAnalytics } = useAnalytics(selectedCycleId);
  const [showGuide, setShowGuide] = useState(false);

  // Prefer closed cycles, sort them first
  const sortedCycles = cycles
    ? [...cycles].sort((a: any, b: any) => {
        if (a.status === 'closed' && b.status !== 'closed') return -1;
        if (a.status !== 'closed' && b.status === 'closed') return 1;
        return 0;
      })
    : [];

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.6rem 0.85rem',
        fontSize: '0.78rem',
      }}>
        <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color || 'var(--text-secondary)' }}>
            {entry.name || entry.dataKey}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Análisis del Ciclo</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Distribución estadística, mapa de competencias y rendimiento por equipo
        </p>
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button
          onClick={() => setShowGuide(!showGuide)}
          style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: 0 }}
        >
          {showGuide ? '▼ Ocultar guía' : '▶ ¿Qué muestra esta página?'}
        </button>

        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              Guía de uso: Análisis del Ciclo
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              Esta página presenta estadísticas organizacionales de los resultados de evaluación por ciclo.
              Selecciona un ciclo para ver las métricas. Los datos provienen de las evaluaciones completadas.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Gráficos disponibles</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li>
                  <strong>Distribución de Puntajes (Curva de Bell):</strong>{' '}
                  Histograma con curva normal superpuesta. Muestra si la distribución es equilibrada o si hay sesgo
                  (leniencia, dureza o baja diferenciación). Incluye análisis automático de tendencia central, dispersión y alertas de distribución.
                </li>
                <li>
                  <strong>Comparación por Departamento:</strong>{' '}
                  Puntaje promedio de cada departamento. Permite identificar áreas de la organización con mejor o menor desempeño.
                </li>
                <li>
                  <strong>Mapa de Competencias por Departamento:</strong>{' '}
                  Matriz departamento × sección de plantilla. Verde = alto, amarillo = medio, rojo = bajo.
                  Departamentos con menos de 5 evaluados se ocultan por privacidad.
                </li>
                <li>
                  <strong>Rendimiento por Equipo:</strong>{' '}
                  Ranking de encargados ordenado por puntaje promedio de sus colaboradores. Incluye tamaño del equipo.
                </li>
              </ul>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Conexión con otras funciones</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li><strong>Informes por Colaborador:</strong>{' Para análisis individual (por persona), ve a la sección Informes'}</li>
                <li><strong>Calibración:</strong>{' Si hubo calibración, los puntajes ajustados se reflejan aquí'}</li>
                <li><strong>Talento (Nine Box):</strong>{' Los puntajes de desempeño vistos aquí alimentan el eje de desempeño del Nine Box'}</li>
              </ul>
            </div>

            <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>Permisos:</strong>{' Solo Administradores y Encargados de Equipo pueden acceder a esta página. Los Colaboradores ven sus resultados individuales en "Mi Desempeño".'}
            </div>
          </div>
        )}
      </div>

      {/* Cycle selector */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        {loadingCycles ? (
          <Spinner />
        ) : !sortedCycles.length ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{'No hay ciclos disponibles'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Ciclo:
            </label>
            <select
              style={selectStyle}
              value={selectedCycleId || ''}
              onChange={(e) => setSelectedCycleId(e.target.value || null)}
            >
              <option value="">Selecciona un ciclo</option>
              {sortedCycles.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* No cycle selected */}
      {!selectedCycleId && !loadingCycles && sortedCycles.length > 0 && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {'Selecciona un ciclo para ver el an\u00e1lisis'}
          </p>
        </div>
      )}

      {/* Analytics content */}
      {selectedCycleId && (
        <>
          {loadingAnalytics ? (
            <Spinner />
          ) : !analytics ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{'Sin datos de an\u00e1lisis para este ciclo'}</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* 1. Bell Curve Distribution */}
              <BellCurveSection cycleId={selectedCycleId} />

              {/* 2. Department Comparison */}
              {analytics.departmentComparison && analytics.departmentComparison.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
                  <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    {'Comparaci\u00f3n por Departamento'}
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                    Puntaje promedio por departamento
                  </p>
                  <ResponsiveContainer width="100%" height={Math.max(200, analytics.departmentComparison.length * 45)}>
                    <BarChart
                      data={analytics.departmentComparison.map((d: any) => ({
                        department: d.department || 'Sin depto.',
                        avgScore: Number(d.avgScore) || 0,
                        count: d.count,
                      }))}
                      layout="vertical"
                      margin={{ top: 5, right: 20, bottom: 5, left: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 10]}
                        tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickLine={{ stroke: 'var(--border)' }}
                      />
                      <YAxis
                        type="category"
                        dataKey="department"
                        width={120}
                        tick={{ fill: 'var(--text-secondary)', fontSize: 12 }}
                        axisLine={{ stroke: 'var(--border)' }}
                        tickLine={{ stroke: 'var(--border)' }}
                      />
                      <Tooltip content={customTooltip} />
                      <Bar dataKey="avgScore" name="Puntaje Promedio" fill="var(--accent)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 3. Competency Heatmap (dept × section) */}
              <CompetencyHeatmapSection cycleId={selectedCycleId} />

              {/* 4. Team Benchmarks */}
              {analytics.teamBenchmarks && analytics.teamBenchmarks.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
                  <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                    {'Rendimiento por Equipo'}
                  </h2>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                    {'Rendimiento promedio por Encargado de Equipo, ordenado por puntaje'}
                  </p>
                  <div className="table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          {['Encargado de Equipo', 'Puntaje Promedio', 'Tama\u00f1o Equipo'].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: 'left',
                                padding: '0.6rem 0.75rem',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                color: 'var(--text-muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em',
                                borderBottom: '1px solid var(--border)',
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[...analytics.teamBenchmarks]
                          .sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore))
                          .map((tb: any, i: number) => {
                            const score = Number(tb.avgScore) || 0;
                            const scoreColor = score < 4 ? 'var(--danger)' : score < 7 ? 'var(--warning)' : 'var(--success)';
                            return (
                              <tr key={i}>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                                  {tb.managerName || tb.managerId}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 700, color: scoreColor, borderBottom: '1px solid var(--border)' }}>
                                  {score.toFixed(1)}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                                  {tb.teamSize}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
