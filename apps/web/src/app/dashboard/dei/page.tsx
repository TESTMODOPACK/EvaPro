'use client';

import { useState } from 'react';
import { useDemographics, useEquityAnalysis, useGapReport } from '@/hooks/useDei';
import { useCycles } from '@/hooks/useCycles';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6'];

function DistributionBar({ items }: { items: Array<{ group: string; count: number; percentage: number }> }) {
  if (!items || items.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos</span>;
  return (
    <div>
      <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', marginBottom: '0.25rem' }}>
        {items.map((item, i) => (
          <div key={item.group} title={`${item.group}: ${item.count} (${item.percentage}%)`}
            style={{ width: `${item.percentage}%`, background: COLORS[i % COLORS.length], minWidth: item.percentage > 0 ? 2 : 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem' }}>
        {items.map((item, i) => (
          <span key={item.group} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[i % COLORS.length], display: 'inline-block' }} />
            {item.group}: {item.count} ({item.percentage}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function AlertBadge({ severity }: { severity: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: '#fecaca', text: '#991b1b' },
    medium: { bg: '#fef3c7', text: '#92400e' },
  };
  const c = colors[severity] || colors.medium;
  return (
    <span style={{ background: c.bg, color: c.text, padding: '2px 8px', borderRadius: 12, fontSize: '0.7rem', fontWeight: 600 }}>
      {severity === 'high' ? 'ALTA' : 'MEDIA'}
    </span>
  );
}

function DataCompletenessBar({ data }: { data: Array<{ field: string; percentage: number }> }) {
  const labels: Record<string, string> = {
    gender: 'Genero', birthDate: 'Fecha nacimiento', nationality: 'Nacionalidad',
    seniorityLevel: 'Seniority', contractType: 'Tipo contrato', workLocation: 'Ubicacion',
  };
  return (
    <div className="card" style={{ padding: '1rem' }}>
      <h4 style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>Completitud de datos demograficos</h4>
      {(data || []).map((d) => (
        <div key={d.field} style={{ marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 2 }}>
            <span>{labels[d.field] || d.field}</span>
            <span style={{ color: d.percentage >= 80 ? '#10b981' : d.percentage >= 50 ? '#f59e0b' : '#ef4444', fontWeight: 600 }}>
              {d.percentage}%
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${d.percentage}%`, background: d.percentage >= 80 ? '#10b981' : d.percentage >= 50 ? '#f59e0b' : '#ef4444', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DeiPage() {
  const { data: demo, isLoading: loadingDemo } = useDemographics();
  const { data: cycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [dimension, setDimension] = useState('gender');
  const { data: equity } = useEquityAnalysis(selectedCycleId);
  const { data: gap } = useGapReport(selectedCycleId, dimension);

  return (
    <div style={{ maxWidth: '1000px' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Diversidad, Equidad e Inclusion (DEI)
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Metricas de composicion organizacional y analisis de equidad en evaluaciones.
      </p>

      {loadingDemo && <p style={{ color: 'var(--text-muted)' }}>Cargando datos...</p>}

      {demo && demo.total > 0 && (
        <>
          {/* Overview Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)' }}>{demo.total}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Colaboradores</div>
            </div>
            <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#8b5cf6' }}>{demo.gender?.length || 0}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Generos</div>
            </div>
            <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f59e0b' }}>{demo.nationality?.length || 0}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Nacionalidades</div>
            </div>
            <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>{demo.ageRanges?.length || 0}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Rangos etarios</div>
            </div>
          </div>

          {/* Demographic Distributions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="card" style={{ padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Distribucion por Genero</h4>
              <DistributionBar items={demo.gender} />
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Distribucion por Seniority</h4>
              <DistributionBar items={demo.seniority} />
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Distribucion por Rango Etario</h4>
              <DistributionBar items={demo.ageRanges} />
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Distribucion por Antigüedad</h4>
              <DistributionBar items={demo.tenureRanges} />
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Tipo de Contrato</h4>
              <DistributionBar items={demo.contractType} />
            </div>
            <div className="card" style={{ padding: '1rem' }}>
              <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Modalidad de Trabajo</h4>
              <DistributionBar items={demo.workLocation} />
            </div>
          </div>

          {/* Data Completeness */}
          <DataCompletenessBar data={demo.dataCompleteness} />

          {/* Equity Analysis Section */}
          <div style={{ marginTop: '2rem', borderTop: '2px solid var(--border)', paddingTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem' }}>Analisis de Equidad en Evaluaciones</h2>
            <select value={selectedCycleId || ''} onChange={(e) => setSelectedCycleId(e.target.value || null)}
              style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', marginBottom: '1rem', minWidth: '300px' }}>
              <option value="">Seleccionar ciclo de evaluacion...</option>
              {(Array.isArray(cycles) ? cycles : []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
              ))}
            </select>

            {equity && selectedCycleId && (
              <>
                {/* Alerts */}
                {equity.alerts?.length > 0 && (
                  <div className="card" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid #ef4444' }}>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', color: '#ef4444' }}>
                      Alertas de Sesgo ({equity.alertCount})
                    </h4>
                    {equity.alerts.map((alert: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', fontSize: '0.85rem' }}>
                        <AlertBadge severity={alert.severity} />
                        <span>{alert.message}</span>
                      </div>
                    ))}
                  </div>
                )}
                {equity.alerts?.length === 0 && (
                  <div className="card" style={{ padding: '1rem', marginBottom: '1rem', borderLeft: '4px solid #10b981' }}>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>Sin alertas de sesgo detectadas para este ciclo.</span>
                  </div>
                )}

                {/* Gap Report */}
                <div className="card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Brechas por Dimension</h4>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {[
                        { val: 'gender', label: 'Genero' }, { val: 'seniority', label: 'Seniority' },
                        { val: 'department', label: 'Departamento' }, { val: 'nationality', label: 'Nacionalidad' },
                      ].map((d) => (
                        <button key={d.val} onClick={() => setDimension(d.val)}
                          className={`btn ${dimension === d.val ? 'btn-primary' : ''}`}
                          style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {gap?.groups?.length > 0 ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)' }}>
                          <th style={{ padding: '0.5rem', textAlign: 'left' }}>Grupo</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Puntaje Prom.</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Min</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Max</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Personas</th>
                          <th style={{ padding: '0.5rem', textAlign: 'right' }}>Brecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gap.groups.map((g: any) => (
                          <tr key={g.group} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.5rem', fontWeight: 600 }}>{g.group}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>{g.avgScore}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>{g.minScore}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', color: 'var(--text-muted)' }}>{g.maxScore}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>{g.userCount}</td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600,
                              color: Math.abs(g.gapFromAvg) >= 1 ? '#ef4444' : Math.abs(g.gapFromAvg) >= 0.5 ? '#f59e0b' : '#10b981' }}>
                              {g.gapFromAvg > 0 ? '+' : ''}{g.gapFromAvg}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      Sin datos suficientes (minimo {gap?.privacyThreshold || 5} personas por grupo)
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {demo && demo.total === 0 && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>Sin usuarios activos. Agrega colaboradores para ver metricas DEI.</p>
        </div>
      )}
    </div>
  );
}
