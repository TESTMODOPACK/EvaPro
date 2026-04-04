'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter, Cell, ZAxis } from 'recharts';

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

const QUADRANT_CONFIG: Record<string, { label: string; color: string; icon: string; action: string }> = {
  star: { label: 'Estrella', color: '#10b981', icon: '★', action: 'Mantener y replicar buenas prácticas en otras áreas' },
  burnout_risk: { label: 'Riesgo de Burnout', color: '#f59e0b', icon: '⚠', action: 'Intervenir clima urgente — alto riesgo de rotación pese a buen desempeño' },
  opportunity: { label: 'Oportunidad', color: '#6366f1', icon: '↗', action: 'Invertir en capacitación técnica y gestión — el equipo está motivado' },
  critical: { label: 'Crítico', color: '#ef4444', icon: '✕', action: 'Plan de acción integral urgente — bajo desempeño y bajo compromiso' },
  no_data: { label: 'Sin datos', color: '#94a3b8', icon: '?', action: 'No hay datos suficientes para clasificar' },
};

function AnalisisIntegradoContent() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!token) return;
    setError(null);
    fetch(`${API}/reports/cross-analysis`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => { if (!r.ok) throw new Error('Error al cargar'); return r.json(); })
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const handleExport = async (format: 'pdf' | 'xlsx' | 'csv') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(`${API}/reports/cross-analysis/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `analisis-integrado.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* ignore */ }
    setExporting(null);
  };

  if (loading) return <PageSkeleton cards={4} tableRows={6} />;
  if (error) return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--danger)' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600 }}>Error al cargar el análisis</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );
  if (data?.error) return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '1rem' }}>Análisis Integrado Clima–Desempeño</h1>
      <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>{data.error}</div>
    </div>
  );
  if (!data) return null;

  const { summary, departments, quadrants, categoryCorrelation, insights } = data;

  // Scatter data for quadrant chart
  const scatterData = (departments || []).filter((d: any) => d.performance != null && d.engagement != null)
    .map((d: any) => ({ x: d.performance, y: d.engagement, name: d.department, quadrant: d.quadrant }));

  const corrLabel = summary?.correlation >= 0.5 ? 'Fuerte positiva' : summary?.correlation >= 0.2 ? 'Moderada positiva' : summary?.correlation >= -0.2 ? 'Débil / nula' : 'Negativa';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Análisis Integrado Clima–Desempeño</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Cruce entre evaluaciones de desempeño y encuestas de clima laboral
              {data.cycleName && <> · Ciclo: <strong>{data.cycleName}</strong></>}
              {data.surveyTitle && <> · Encuesta: <strong>{data.surveyTitle}</strong></>}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['pdf', 'xlsx', 'csv'] as const).map(fmt => (
              <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} disabled={!!exporting}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
                {exporting === fmt ? '...' : fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? 'Ocultar guía' : 'Cómo funciona'}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Análisis Integrado Clima–Desempeño</h3>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Qué es este análisis?</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              Es un cruce estadístico entre los resultados de evaluación de desempeño y las encuestas de clima laboral. Permite identificar patrones que no se ven al analizar cada sistema por separado.
            </p>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Por qué es relevante?</p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li>Organizaciones con mejor clima tienen hasta 21% más productividad (Gallup, 2023)</li>
              <li>Permite intervenciones preventivas en vez de reactivas</li>
              <li>Identifica departamentos donde alto desempeño coexiste con bajo bienestar (riesgo de rotación)</li>
              <li>Alinea planes de desarrollo organizacional con datos reales de clima y desempeño</li>
            </ul>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Los 4 Cuadrantes</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {Object.entries(QUADRANT_CONFIG).filter(([k]) => k !== 'no_data').map(([key, q]) => (
                <div key={key} style={{ padding: '0.5rem 0.75rem', background: `${q.color}10`, borderLeft: `3px solid ${q.color}`, borderRadius: '0 6px 6px 0', fontSize: '0.8rem' }}>
                  <strong style={{ color: q.color }}>{q.icon} {q.label}:</strong>{' '}
                  <span style={{ color: 'var(--text-secondary)' }}>{q.action}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Qué es la correlación?</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              Un coeficiente que mide la relación lineal entre clima y desempeño a nivel departamental: 1.0 = relación perfecta positiva, 0 = sin relación, -1.0 = relación inversa. Valores sobre 0.5 indican que mejorar el clima tiene alto impacto en desempeño.
            </p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Administradores ven toda la organización. Encargados de equipo ven solo los datos de su equipo directo. Los datos de clima son anónimos — no se identifica quién respondió qué.
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>Desempeño Promedio</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: summary?.avgPerformance >= 7 ? '#10b981' : summary?.avgPerformance >= 5 ? '#f59e0b' : '#ef4444' }}>{summary?.avgPerformance ?? '–'}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>escala 0-10</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>Clima Promedio</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: summary?.avgEngagement >= 3.5 ? '#10b981' : summary?.avgEngagement >= 2.5 ? '#f59e0b' : '#ef4444' }}>{summary?.avgEngagement ?? '–'}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>escala 1-5</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>eNPS</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: (summary?.eNPS ?? 0) >= 30 ? '#10b981' : (summary?.eNPS ?? 0) >= 0 ? '#f59e0b' : '#ef4444' }}>{summary?.eNPS ?? '–'}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>promotores - detractores</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.3rem' }}>Correlación</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)' }}>{summary?.correlation ?? '–'}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{corrLabel}</div>
        </div>
      </div>

      {/* Quadrant Chart */}
      {scatterData.length >= 2 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Mapa de Cuadrantes por Departamento</h2>
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 30, bottom: 30, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" dataKey="x" name="Desempeño" domain={[0, 10]} tick={{ fontSize: 10 }}
                label={{ value: 'Desempeño (0-10)', position: 'bottom', fontSize: 10, fill: '#94a3b8' }} />
              <YAxis type="number" dataKey="y" name="Clima" domain={[1, 5]} tick={{ fontSize: 10 }}
                label={{ value: 'Clima (1-5)', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }} />
              <ZAxis range={[80, 80]} />
              <Tooltip content={({ payload }: any) => {
                if (!payload?.[0]) return null;
                const d = payload[0].payload;
                const q = QUADRANT_CONFIG[d.quadrant];
                return (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}>
                    <strong>{d.name}</strong><br/>
                    Desempeño: {d.x} | Clima: {d.y}<br/>
                    <span style={{ color: q?.color }}>{q?.icon} {q?.label}</span>
                  </div>
                );
              }} />
              {/* Reference lines for quadrants */}
              <Scatter data={scatterData} name="Departamentos">
                {scatterData.map((d: any, i: number) => (
                  <Cell key={i} fill={QUADRANT_CONFIG[d.quadrant]?.color || '#94a3b8'} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
          {/* Threshold lines info */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1.5rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>Umbral desempeño: ≥ 7.0</span>
            <span>Umbral clima: ≥ 3.5</span>
          </div>
        </div>
      )}

      {/* Quadrant Legend (always visible) */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.75rem' }}>Clasificación de Cuadrantes</h3>
        <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          {Object.entries(QUADRANT_CONFIG).filter(([k]) => k !== 'no_data').map(([key, q]) => {
            const count = (quadrants?.[key] || []).length;
            return (
              <div key={key} style={{ padding: '0.65rem 0.85rem', background: `${q.color}08`, borderLeft: `4px solid ${q.color}`, borderRadius: '0 8px 8px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '1rem' }}>{q.icon}</span>
                  <strong style={{ color: q.color, fontSize: '0.88rem' }}>{q.label}</strong>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{count} depto.</span>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>{q.action}</p>
                {count > 0 && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    {(quadrants?.[key] || []).map((d: any) => d.department).join(', ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Department Table */}
      {departments?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Detalle por Departamento</h2>
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Departamento</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Desempeño</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Clima</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Cuadrante</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Eval.</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Resp.</th>
                </tr>
              </thead>
              <tbody>
                {departments.map((d: any) => {
                  const q = QUADRANT_CONFIG[d.quadrant];
                  return (
                    <tr key={d.department} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{d.department}</td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 700, color: d.performance >= 7 ? '#10b981' : d.performance >= 5 ? '#f59e0b' : '#ef4444' }}>{d.performance ?? '–'}</td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 700, color: d.engagement >= 3.5 ? '#10b981' : d.engagement >= 2.5 ? '#f59e0b' : '#ef4444' }}>{d.engagement ?? '–'}</td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                        <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, background: `${q?.color}15`, color: q?.color }}>{q?.icon} {q?.label}</span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)' }}>{d.performanceCount}</td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: 'var(--text-muted)' }}>{d.engagementCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Climate Category Breakdown */}
      {categoryCorrelation?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Dimensiones de Clima Laboral</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {categoryCorrelation.map((c: any) => {
              const pct = ((c.avgScore - 1) / 4) * 100; // 1-5 → 0-100%
              const color = c.avgScore >= 4 ? '#10b981' : c.avgScore >= 3 ? '#f59e0b' : '#ef4444';
              return (
                <div key={c.category} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.82rem' }}>
                  <span style={{ minWidth: '120px', fontWeight: 500 }}>{c.category}</span>
                  <div style={{ flex: 1, height: '8px', borderRadius: '999px', background: 'var(--border)' }}>
                    <div style={{ height: '100%', width: `${pct}%`, borderRadius: '999px', background: color, transition: 'width 0.5s' }} />
                  </div>
                  <span style={{ fontWeight: 700, color, minWidth: '35px', textAlign: 'right' }}>{c.avgScore}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', minWidth: '80px' }}>{c.interpretation}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Insights */}
      {insights?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Análisis e Insights</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {insights.map((ins: string, i: number) => (
              <p key={i} style={{ margin: 0, paddingLeft: '1rem', borderLeft: '2px solid var(--border)' }}>{ins}</p>
            ))}
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Este análisis se genera automáticamente cruzando los datos más recientes de evaluaciones de desempeño y encuestas de clima. Los resultados deben ser validados por el equipo de RRHH antes de tomar decisiones.
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalisisIntegradoPage() {
  return (
    <PlanGate feature="ADVANCED_REPORTS">
      <AnalisisIntegradoContent />
    </PlanGate>
  );
}
