'use client';

import { useState } from 'react';
import { useCompetencyRadar, useSelfVsOthers, useHeatmap, useBellCurve } from '@/hooks/useReports';
import { useCycles } from '@/hooks/useCycles';
import { useUsers } from '@/hooks/useUsers';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
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

/* ─── Radar Chart Section ──────────────────────────────────────────── */

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
        {'Radar de Competencias'}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        {'Puntaje promedio por secci\u00f3n de la plantilla, desglosado por tipo de evaluador'}
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
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos suficientes para la curva de distribucion</p>
      </div>
    );
  }

  if (data.privacyRestricted) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600 }}>
          {data.message || `Se requieren al menos 5 evaluaciones para mostrar la distribuci\u00f3n (actualmente: ${data.count})`}
        </p>
      </div>
    );
  }

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        Distribucion de Puntajes (Curva de Bell)
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Histograma de puntajes con curva normal superpuesta
      </p>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.8rem' }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Promedio: </span>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{data.mean}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Desv. Est.: </span>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{data.stddev}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>Total: </span>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{data.count} evaluaciones</span>
        </div>
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
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────── */

export default function InformesPage() {
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: usersPage } = useUsers();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
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
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{'Informes Avanzados'}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {'Radar de competencias, comparativa autoevaluaci\u00f3n vs evaluadores y mapa de calor'}
        </p>
      </div>

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button onClick={() => setShowGuide(!showGuide)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: 0 }}>
          {showGuide ? '\u25BC Ocultar gu\u00eda' : '\u25B6 \u00bfQu\u00e9 muestra esta p\u00e1gina?'}
        </button>
        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              {'Gu\u00eda de uso: Informes Avanzados'}
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{'Radar de Competencias:'}</strong>{' Gr\u00e1fico tipo radar que muestra el puntaje promedio por cada secci\u00f3n de la plantilla de evaluaci\u00f3n, desglosado por tipo de evaluador (autoevaluaci\u00f3n, encargado, par, reporte directo).'}</li>
              <li><strong>{'Autoevaluaci\u00f3n vs Evaluadores:'}</strong>{' Compara el puntaje que el colaborador se asign\u00f3 versus lo que sus evaluadores le dieron. Incluye indicador de brecha (gap) y su interpretaci\u00f3n.'}</li>
              <li><strong>{'Mapa de Calor:'}</strong>{' Vista de todos los departamentos con barra de distribuci\u00f3n (rojo/amarillo/verde) mostrando cu\u00e1ntos colaboradores est\u00e1n en nivel bajo, medio o alto. Se expande para ver detalle.'}</li>
            </ul>
            <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>{'Permisos:'}</strong>{' Solo Administradores y Encargados de Equipo pueden acceder.'}
            </div>
          </div>
        )}
      </div>

      {/* Selectors */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
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
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{'Colaborador (para Radar y Self vs Others)'}</label>
          <select style={selectStyle} value={selectedUserId || ''} onChange={(e) => setSelectedUserId(e.target.value || null)}>
            <option value="">{'Seleccionar colaborador...'}</option>
            {users
              .filter((u: any) => (!filterDepartment || u.department === filterDepartment) && (!filterPosition || u.position === filterPosition))
              .map((u: any) => (
                <option key={u.id} value={u.id}>{u.firstName} {u.lastName}{u.position ? ` - ${u.position}` : ''}</option>
              ))
            }
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Departamento</label>
          <select style={selectStyle} value={filterDepartment} onChange={(e) => setFilterDepartment(e.target.value)}>
            <option value="">Todos</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Cargo</label>
          <select style={selectStyle} value={filterPosition} onChange={(e) => setFilterPosition(e.target.value)}>
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

      {/* No selections */}
      {!selectedCycleId && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{'Selecciona un ciclo para ver los informes'}</p>
        </div>
      )}

      {/* Content */}
      {selectedCycleId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Per-user views */}
          {selectedUserId && (
            <>
              <CompetencyRadarSection cycleId={selectedCycleId} userId={selectedUserId} />
              <SelfVsOthersSection cycleId={selectedCycleId} userId={selectedUserId} />
            </>
          )}

          {!selectedUserId && (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {'Selecciona un colaborador para ver el Radar de Competencias y la comparativa Self vs Others'}
              </p>
            </div>
          )}

          {/* Bell Curve */}
          <BellCurveSection cycleId={selectedCycleId} />

          {/* Heatmap always visible with cycle */}
          <HeatmapSection cycleId={selectedCycleId} />
        </div>
      )}
    </div>
  );
}
