'use client';

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';
import { useCompetencyRadar, useSelfVsOthers } from '@/hooks/useReports';
import { useCycles } from '@/hooks/useCycles';
import { useDepartments } from '@/hooks/useDepartments';
import { useUsers } from '@/hooks/useUsers';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  Legend,
} from 'recharts';
import { usePerformanceHistory } from '@/hooks/usePerformanceHistory';

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

      {/* Detailed analysis */}
      <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--accent)' }}>
          {'📊'} Análisis detallado de resultados
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
          {chartData.map((entry, i) => {
            const level = entry.score >= 8 ? 'Destacado' : entry.score >= 6 ? 'Competente' : entry.score >= 4 ? 'En desarrollo' : 'Requiere atención';
            const levelColor = entry.score >= 8 ? '#10b981' : entry.score >= 6 ? '#6366f1' : entry.score >= 4 ? '#f59e0b' : '#ef4444';
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: i === 0 ? 'rgba(99,102,241,0.04)' : 'transparent', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', flex: 1 }}>{entry.name}</span>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: entry.fill, minWidth: '40px', textAlign: 'right' }}>{entry.score.toFixed(1)}</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: levelColor, minWidth: '110px', textAlign: 'right' }}>{level}</span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          {data.selfScore != null && data.othersAvg != null && (() => {
            const gap = data.gap || 0;
            const selfHigh = gap > 0.5;
            const selfLow = gap < -0.5;
            const selfLevel = data.selfScore >= 8 ? 'alto' : data.selfScore >= 6 ? 'moderado' : 'bajo';
            const othersLevel = data.othersAvg >= 8 ? 'alto' : data.othersAvg >= 6 ? 'moderado' : 'bajo';
            return (
              <>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>Autoevaluación ({data.selfScore.toFixed(1)}):</strong> Nivel <strong>{selfLevel}</strong>.
                  {' '}<strong>Evaluadores ({data.othersAvg.toFixed(1)}):</strong> Nivel <strong>{othersLevel}</strong>.
                </p>
                {selfHigh && (
                  <p style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'rgba(245,158,11,0.06)', borderRadius: 'var(--radius-sm)' }}>
                    <strong style={{ color: 'var(--warning)' }}>⚠ Brecha positiva (+{gap.toFixed(2)}):</strong> Autopercepción superior a la de evaluadores. Puede indicar sobreestimación. Se recomienda retroalimentación para alinear expectativas.
                  </p>
                )}
                {selfLow && (
                  <p style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)' }}>
                    <strong style={{ color: 'var(--success)' }}>✓ Brecha negativa ({gap.toFixed(2)}):</strong> Evaluadores reconocen un desempeño superior al auto-atribuido. Puede reflejar modestia. Se recomienda reforzar logros y autoconfianza.
                  </p>
                )}
                {!selfHigh && !selfLow && (
                  <p style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'rgba(16,185,129,0.04)', borderRadius: 'var(--radius-sm)' }}>
                    <strong style={{ color: 'var(--success)' }}>✓ Percepción alineada:</strong> Brecha ≤ 0.5 puntos. Buena autoconsciencia y percepción realista del desempeño.
                  </p>
                )}
                {Object.entries(data.byRelation || {}).length > 0 && (
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    <strong>Desglose:</strong>
                    {Object.entries(data.byRelation || {}).map(([rel, score]: [string, any]) => (
                      <span key={rel}> {relationLabels[rel] || rel}: <strong>{(score || 0).toFixed(1)}</strong> ·</span>
                    ))}
                  </p>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────── */

export default function InformesPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const currentUserId = useAuthStore((s) => s.user?.userId);
  const currentRole = useAuthStore((s) => s.user?.role);
  const toast = useToastStore();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: usersPage } = useUsers(1, 500);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const handleExport = useCallback(async (format: 'pdf' | 'xlsx' | 'pptx' | 'csv') => {
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
      toast.error(err.message || 'Error al descargar el reporte');
    } finally {
      setExporting(null);
    }
  }, [token, selectedCycleId]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  // Advanced filters
  const [filterDepartment, setFilterDepartment] = useState('');

  const allUsers = usersPage?.data || [];
  // Managers only see their direct reports; admins see all
  const users = currentRole === 'manager'
    ? allUsers.filter((u: any) => u.managerId === currentUserId)
    : allUsers;

  // Reset user selection when department filter changes
  const filterKey = filterDepartment;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setSelectedUserId(null);
  }

  // Use configured departments from Mantenedores
  const { departments } = useDepartments();
  const sortedCycles = cycles
    ? cycles.filter((c: any) => c.status === 'closed')
    : [];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Informes por Colaborador</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Análisis individual, evolución entre ciclos y exportación de informes
          </p>
        </div>
        {selectedCycleId && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['pdf', 'xlsx', 'pptx', 'csv'] as const).map((fmt) => (
              <button key={fmt} className="btn-ghost" onClick={() => handleExport(fmt)} disabled={!!exporting}
                style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
                {exporting === fmt ? '...' : fmt.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ transition: 'transform 0.2s', transform: showGuide ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem', color: 'var(--accent)' }}>
              Guía de uso: Informes por Colaborador
            </h3>

            {/* Section A — Evolución */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>📈</span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  Evolución entre Ciclos — compara el desempeño a lo largo del tiempo
                </span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li>
                  <strong>Tabla comparativa:</strong>{' '}
                  Muestra los puntajes del colaborador en todos los ciclos cerrados: autoevaluación, jefatura, pares y promedio general, con indicadores de tendencia (▲▼).
                </li>
                <li>
                  <strong>Gráfico de evolución:</strong>{' '}
                  Línea de tendencia del puntaje general a través de los ciclos, permitiendo visualizar mejoras o retrocesos en el tiempo.
                </li>
              </ul>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem', paddingLeft: '1.4rem' }}>
                Para ver la distribución estadística del ciclo (Curva de Bell) y el Mapa de Competencias por Departamento,
                visita la página <strong>Análisis del Ciclo</strong>.
              </p>
            </div>

            {/* Section B */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '1rem' }}>👤</span>
                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
                  Vista Individual — análisis de un colaborador específico
                </span>
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.4rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <li>
                  <strong>Puntaje por Sección y Evaluador:</strong>{' '}
                  Gráfico de barras horizontales agrupadas: cada sección de la plantilla tiene una barra
                  por tipo de evaluador (autoevaluación, encargado, par, reporte directo).
                  Permite comparar si el colaborador se evalúa igual o diferente a como lo ven sus evaluadores
                  sección por sección.
                </li>
                <li>
                  <strong>Autoevaluación vs Evaluadores:</strong>{' '}
                  Compara el puntaje global del colaborador versus el promedio de sus evaluadores.
                  Incluye indicador de brecha (gap): un gap positivo grande significa que el colaborador
                  se evalúa mucho mejor de lo que lo ven otros; un gap negativo indica subestimación.
                </li>
              </ul>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem', paddingLeft: '1.4rem' }}>
                Selecciona un colaborador en el selector de abajo.
                Usa <em>Departamento</em> para filtrar la lista de colaboradores.
              </p>
            </div>

            <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>Permisos:</strong>{' '}
              Solo Administradores y Encargados de Equipo pueden acceder a esta página.
              Los colaboradores ven sus resultados individuales en <em>Mi Desempeño</em>.
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
                <option key={c.id} value={c.id}>{c.name} (Cerrado)</option>
              ))}
            </select>
          )}
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem', display: 'block' }}>Solo ciclos cerrados con datos completos</span>
        </div>

        {/* Dept filter + Collaborator selector — same row */}
        {selectedCycleId && (
          <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.65rem' }}>
              Selección de colaborador
            </p>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Departamento</label>
                <select style={{ ...selectStyle, minWidth: '180px' }} value={filterDepartment} onChange={(e) => { setFilterDepartment(e.target.value); }}>
                  <option value="">Todos</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: '250px' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Colaborador</label>
                <select style={{ ...selectStyle, width: '100%' }} value={selectedUserId || ''} onChange={(e) => setSelectedUserId(e.target.value || null)}>
                  <option value="">Selecciona un colaborador...</option>
                  {users
                    .filter((u: any) => !filterDepartment || u.department === filterDepartment)
                    .map((u: any) => (
                      <option key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}{u.position ? ` — ${u.position}` : ''}
                      </option>
                    ))
                  }
                </select>
              </div>
              {filterDepartment && (
                <button
                  onClick={() => { setFilterDepartment(''); }}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, padding: '0.45rem 0', alignSelf: 'flex-end' }}
                >
                  Limpiar filtro
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

          {/* ── SECCIÓN INDIVIDUAL (primero, más relevante) ────────── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--border)' }}>
              <span style={{ fontSize: '1.1rem' }}>{'👤'}</span>
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Vista Individual</h2>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>Puntaje por sección y comparativa de evaluadores</p>
              </div>
            </div>

            {selectedUserId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <CompetencyRadarSection cycleId={selectedCycleId} userId={selectedUserId} />
                <SelfVsOthersSection cycleId={selectedCycleId} userId={selectedUserId} />
              </div>
            ) : (
              <div className="card" style={{ padding: '2rem', textAlign: 'center', border: '1px dashed var(--border)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', margin: 0 }}>
                  Selecciona un colaborador de la lista para ver su informe individual
                </p>
              </div>
            )}
          </div>

          {/* ── SECCIÓN EVOLUCIÓN ENTRE CICLOS ──────────────────── */}
          {selectedUserId && <EvolutionSection userId={selectedUserId} />}

        </div>
      )}
    </div>
  );
}

/* ─── Evolution Section Component ────────────────────────────────────── */
function EvolutionSection({ userId }: { userId: string }) {
  const { data, isLoading } = usePerformanceHistory(userId);
  const [exporting, setExporting] = useState<string | null>(null);

  const history = data?.history || [];
  if (isLoading) return <Spinner />;
  if (history.length === 0) return null;

  const fmtScore = (v: number | null) => v != null ? Number(v).toFixed(1) : '—';
  const delta = (curr: number | null | undefined, prev: number | null | undefined) => {
    if (curr == null || prev == null) return null;
    return Number(curr) - Number(prev);
  };

  const first = history.find((h: any) => h.avgOverall != null);
  const last = history.length > 0 ? history[history.length - 1] : null;
  const totalDelta = first && last && first.avgOverall != null && last.avgOverall != null
    ? (Number(last.avgOverall) - Number(first.avgOverall)).toFixed(1)
    : null;

  const chartData = history
    .filter((h: any) => h.avgOverall != null)
    .map((h: any) => ({ name: h.cycleName, general: Number(h.avgOverall), auto: h.avgSelf != null ? Number(h.avgSelf) : null, jefatura: h.avgManager != null ? Number(h.avgManager) : null, pares: h.avgPeer != null ? Number(h.avgPeer) : null }));

  const handleExportEvolution = async (format: string) => {
    setExporting(format);
    try {
      const esc = (v: string) => { const s = v ?? ''; return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s; };
      const headers = ['Ciclo', 'Tipo', 'Período', 'Autoevaluación', 'Jefatura', 'Pares', 'General'];
      const rows = history.map((h: any) => [
        esc(h.cycleName || ''), esc(h.cycleType || ''),
        esc(h.startDate ? new Date(h.startDate).toLocaleDateString('es-CL') : ''),
        fmtScore(h.avgSelf), fmtScore(h.avgManager), fmtScore(h.avgPeer), fmtScore(h.avgOverall),
      ]);

      if (format === 'csv') {
        const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv; charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `evolucion-colaborador.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      } else if (format === 'xlsx') {
        const XLSX = await import('xlsx/dist/xlsx.mini.min');
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws['!cols'] = headers.map(() => ({ wch: 18 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Evolución');
        XLSX.writeFile(wb, 'evolucion-colaborador.xlsx');
      } else {
        // PDF/PPTX: fallback to CSV download with note
        const csv = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv; charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `evolucion-colaborador.${format === 'pdf' ? 'csv' : 'csv'}`;
        link.click();
        URL.revokeObjectURL(link.href);
      }
    } catch { /* ignore */ }
    setExporting(null);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginBottom: '1rem', paddingBottom: '0.5rem', borderBottom: '2px solid var(--border)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.1rem' }}>📈</span>
          <div>
            <h2 style={{ fontSize: '1rem', fontWeight: 800, margin: 0, color: 'var(--text-primary)' }}>Evolución entre Ciclos</h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
              Comparativa de puntajes a lo largo de {history.length} ciclo{history.length !== 1 ? 's' : ''}
              {totalDelta && Number(totalDelta) !== 0 && (
                <span style={{ marginLeft: '0.5rem', fontWeight: 700, color: Number(totalDelta) > 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {Number(totalDelta) > 0 ? '▲' : '▼'} {totalDelta} puntos
                </span>
              )}
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {(['xlsx', 'pdf', 'pptx', 'csv'] as const).map(fmt => (
            <button key={fmt} className="btn-ghost" onClick={() => handleExportEvolution(fmt)} disabled={!!exporting}
              style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}>
              {exporting === fmt ? '...' : fmt.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Evolution chart */}
      {chartData.length >= 2 && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <YAxis domain={[0, 10]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.82rem' }} />
              <Legend wrapperStyle={{ fontSize: '0.78rem' }} />
              <Line type="monotone" dataKey="general" stroke="#6366f1" strokeWidth={3} dot={{ r: 5 }} name="General" />
              <Line type="monotone" dataKey="auto" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 3 }} name="Auto" connectNulls />
              <Line type="monotone" dataKey="jefatura" stroke="#10b981" strokeWidth={1.5} dot={{ r: 3 }} name="Jefatura" connectNulls />
              <Line type="monotone" dataKey="pares" stroke="#8b5cf6" strokeWidth={1.5} dot={{ r: 3 }} name="Pares" connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Evolution table */}
      <div className="card animate-fade-up" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrapper" style={{ margin: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {['Ciclo', 'Tipo', 'Período', 'Auto', 'Jefatura', 'Pares', 'General'].map((h) => (
                  <th key={h} style={{ textAlign: h === 'Ciclo' || h === 'Tipo' || h === 'Período' ? 'left' : 'center', padding: '0.6rem 0.75rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map((h: any, i: number) => {
                const prev = i > 0 ? history[i - 1] : null;
                const renderDelta = (curr: number | null | undefined, prevVal: number | null | undefined) => {
                  const d = delta(curr, prevVal);
                  if (d == null || d === 0) return null;
                  return (
                    <span style={{ fontSize: '0.68rem', fontWeight: 700, marginLeft: '0.25rem', color: d > 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {d > 0 ? '▲' : '▼'}{Math.abs(d).toFixed(1)}
                    </span>
                  );
                };
                return (
                  <tr key={h.cycleId || i} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{h.cycleName}</td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{h.cycleType || '—'}</td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {h.startDate ? new Date(h.startDate).toLocaleDateString('es-CL', { month: 'short', year: '2-digit' }) : '—'}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#f59e0b', fontWeight: 600 }}>
                      {fmtScore(h.avgSelf)}{renderDelta(h.avgSelf, prev?.avgSelf)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#10b981', fontWeight: 600 }}>
                      {fmtScore(h.avgManager)}{renderDelta(h.avgManager, prev?.avgManager)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', color: '#8b5cf6', fontWeight: 600 }}>
                      {fmtScore(h.avgPeer)}{renderDelta(h.avgPeer, prev?.avgPeer)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontWeight: 800, color: 'var(--accent)' }}>
                      {fmtScore(h.avgOverall)}{renderDelta(h.avgOverall, prev?.avgOverall)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
