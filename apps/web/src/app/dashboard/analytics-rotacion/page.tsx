'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { useFlightRisk, useRetentionRecommendations } from '@/hooks/useAiInsights';
import { useDepartments } from '@/hooks/useDepartments';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#C9933A', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6', '#fb7185'];

const tenureLabels: Record<string, string> = {
  '<6m': 'Menos de 6 meses',
  '6-12m': '6 a 12 meses',
  '1-2a': '1 a 2 años',
  '2-5a': '2 a 5 años',
  '>5a': 'Más de 5 años',
};

const departureTypeLabels: Record<string, string> = {
  resignation: 'Renuncia voluntaria',
  termination: 'Despido',
  retirement: 'Jubilación',
  contract_end: 'Fin de contrato',
  abandonment: 'Abandono',
  mutual_agreement: 'Mutuo acuerdo',
};

const reasonCategoryLabels: Record<string, string> = {
  better_offer: 'Mejor oferta laboral',
  work_climate: 'Clima laboral',
  performance: 'Desempeño',
  restructuring: 'Reestructuración',
  personal: 'Motivos personales',
  relocation: 'Reubicación',
  career_growth: 'Crecimiento profesional',
  compensation: 'Compensación/beneficios',
  health: 'Salud',
  other: 'Otro',
};

const movementTypeLabels: Record<string, string> = {
  department_change: 'Cambio de departamento',
  position_change: 'Cambio de cargo',
  promotion: 'Promoción',
  demotion: 'Democión',
  lateral_transfer: 'Transferencia lateral',
};

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

function TurnoverPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [movData, setMovData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [activeSection, setActiveSection] = useState<'departures' | 'movements' | 'flight-risk' | 'retention'>('departures');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setError(null);
    Promise.all([
      fetch(`${API}/reports/analytics/turnover`, { headers: { Authorization: `Bearer ${token}` } }).then(r => { if (!r.ok) throw new Error('Error al cargar rotación'); return r.json(); }),
      fetch(`${API}/reports/analytics/movements`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.ok ? r.json() : null),
    ]).then(([turnover, movements]) => {
      setData(turnover);
      setMovData(movements);
    }).catch((e) => setError(e.message || 'Error al cargar los datos')).finally(() => setLoading(false));
  }, [token]);

  const handleExport = async (format: 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(
        `${API}/reports/analytics/turnover/export?format=${format}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analisis-rotacion.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
    setExporting(null);
  };

  if (loading) return <PageSkeleton cards={4} tableRows={5} />;
  if (error) return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--danger)' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.5rem' }}>Error al cargar</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  // Analysis logic
  const hasDeactivations = data.totalDeactivations12m > 0;
  const rateLevel = data.turnoverRate > 20 ? 'critical' : data.turnoverRate > 15 ? 'high' : data.turnoverRate > 8 ? 'moderate' : 'healthy';
  const rateLabelMap = { critical: t('analyticsRotacion.critical'), high: t('analyticsRotacion.high'), moderate: t('analyticsRotacion.moderate'), healthy: t('analyticsRotacion.healthy') };
  const rateColorMap = { critical: 'var(--danger)', high: '#ef4444', moderate: '#f59e0b', healthy: 'var(--success)' };

  // Find highest-turnover department
  const topDept = data.byDepartment?.[0];
  // Find most common tenure group
  const topTenure = data.byTenure?.reduce((max: any, t: any) => t.count > (max?.count || 0) ? t : max, null);
  // Find month with highest departures
  const peakMonth = data.byMonth?.reduce((max: any, m: any) => m.count > (max?.count || 0) ? m : max, null);

  // Prepare chart data with translated labels
  const tenureData = (data.byTenure || []).map((t: any) => ({
    ...t,
    label: tenureLabels[t.range] || t.range,
  }));

  // Fill missing months for last 12 months
  const allMonths: { month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const existing = (data.byMonth || []).find((m: any) => m.month === key);
    allMonths.push({ month: key, count: existing?.count || 0 });
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('analyticsRotacion.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('analyticsRotacion.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-ghost"
            onClick={() => handleExport('xlsx')}
            disabled={!!exporting}
            style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
          >
            {exporting === 'xlsx' ? t('common.exporting') : t('common.exportExcel')}
          </button>
        </div>
      </div>

      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('analyticsRotacion.guide.title')}</h3>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p><strong>¿Qué muestra?</strong> Dashboard integral de dotación: salidas de la empresa, movimientos internos, análisis de riesgo de fuga y recomendaciones de retención.</p>
            <p><strong>Salidas:</strong> Bajas en los últimos 12 meses con tipo (renuncia, despido, jubilación, etc.), motivo, voluntaria/involuntaria, tasa de rotación, y distribución por departamento y antigüedad.</p>
            <p><strong>Movimientos Internos:</strong> Cambios de departamento, cargo, promociones y transferencias. Flujo entre departamentos y movimientos recientes.</p>
            <p><strong>Riesgo de Fuga:</strong> Puntaje algorítmico (0-100) por colaborador basado en 5 factores: evaluación (30%), objetivos (25%), feedback (20%), objetivos en riesgo (15%), Nine Box (10%). Datos de todos los ciclos en tiempo real.</p>
            <p><strong>Retención:</strong> Recomendaciones de acciones de retención para colaboradores en riesgo alto y medio: planes de desarrollo, coaching, engagement, revisión de compensación y conversaciones de retención.</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Solo administradores.
          </div>
        </div>
      )}

      {/* Section tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        {[
          { key: 'departures' as const, label: `Salidas (${data.totalDeactivations12m || 0})` },
          { key: 'movements' as const, label: `Movimientos (${movData?.totalMovements || 0})` },
          { key: 'flight-risk' as const, label: 'Riesgo de Fuga' },
          { key: 'retention' as const, label: 'Retención' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveSection(tab.key)}
            style={{
              padding: '0.6rem 1.25rem', fontSize: '0.85rem', fontWeight: activeSection === tab.key ? 700 : 500,
              color: activeSection === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: activeSection === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'none', border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════ DEPARTURES SECTION ═══════════ */}
      {activeSection === 'departures' && <>

      {/* KPIs */}
      <div className="animate-fade-up-delay-1 mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsRotacion.active')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{data.activeUsers}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsRotacion.departures12m')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{data.totalDeactivations12m}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsRotacion.turnoverRate')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: rateColorMap[rateLevel] }}>{data.turnoverRate}%</div>
          <div style={{ fontSize: '0.72rem', color: rateColorMap[rateLevel], fontWeight: 600, marginTop: '0.15rem' }}>{rateLabelMap[rateLevel]}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Voluntaria</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f59e0b' }}>{data.voluntary || 0}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Involuntaria</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{data.involuntary || 0}</div>
        </div>
      </div>

      {/* By Type + By Reason */}
      {hasDeactivations && data.byType?.length > 0 && (
        <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
          <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Por Tipo de Salida</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {data.byType.map((t: any) => {
                const pct = data.totalDeactivations12m > 0 ? Math.round((t.count / data.totalDeactivations12m) * 100) : 0;
                return (
                  <div key={t.type} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ minWidth: '140px', fontSize: '0.82rem', fontWeight: 500 }}>{departureTypeLabels[t.type] || t.type}</div>
                    <div style={{ flex: 1, height: '8px', background: 'var(--border)', borderRadius: '999px' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: '#ef4444', borderRadius: '999px', minWidth: pct > 0 ? '4px' : 0 }} />
                    </div>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, minWidth: '45px', textAlign: 'right' }}>{t.count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
          {data.byReason?.length > 0 && (
            <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
              <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Por Categoría de Motivo</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {data.byReason.map((r: any) => {
                  const pct = data.totalDeactivations12m > 0 ? Math.round((r.count / data.totalDeactivations12m) * 100) : 0;
                  return (
                    <div key={r.reason} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <div style={{ minWidth: '140px', fontSize: '0.82rem', fontWeight: 500 }}>{reasonCategoryLabels[r.reason] || r.reason}</div>
                      <div style={{ flex: 1, height: '8px', background: 'var(--border)', borderRadius: '999px' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: '#6366f1', borderRadius: '999px', minWidth: pct > 0 ? '4px' : 0 }} />
                      </div>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, minWidth: '45px', textAlign: 'right' }}>{r.count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Would Rehire indicator */}
      {hasDeactivations && data.wouldRehire && (data.wouldRehire.yes > 0 || data.wouldRehire.no > 0) && (
        <div className="card animate-fade-up" style={{ padding: '1rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '2rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>¿Recontratarías?</h3>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            <span style={{ fontSize: '0.85rem' }}><strong style={{ color: 'var(--success)' }}>{data.wouldRehire.yes}</strong> Sí</span>
            <span style={{ fontSize: '0.85rem' }}><strong style={{ color: 'var(--danger)' }}>{data.wouldRehire.no}</strong> No</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{data.wouldRehire.noAnswer} Sin respuesta</span>
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Monthly trend - always show */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsRotacion.byMonth')}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={allMonths}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(m: string) => {
                const [y, mo] = m.split('-');
                const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
                return `${names[Number(mo) - 1]} ${y.slice(2)}`;
              }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip labelFormatter={(m) => {
                const [y, mo] = String(m).split('-');
                const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
                return `${names[Number(mo) - 1]} ${y}`;
              }} />
              <Bar dataKey="count" fill="#ef4444" name="Bajas" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          {!hasDeactivations && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: '0.5rem' }}>
              {t('analyticsRotacion.noDeactivations')}
            </p>
          )}
        </div>

        {/* By tenure - always show */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsRotacion.byTenure')}</h2>
          {hasDeactivations ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={tenureData.filter((t: any) => t.count > 0)}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  label={({ label, count }: any) => `${label}: ${count}`}
                  labelLine={{ strokeWidth: 1 }}
                >
                  {tenureData.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value: any, name: any) => [value, name]} />
                <Legend formatter={(value: any) => <span style={{ fontSize: '0.78rem' }}>{value}</span>} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '220px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Sin datos de antigüedad disponibles
            </div>
          )}
        </div>
      </div>

      {/* By Department */}
      {data.byDepartment?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsRotacion.byDepartment')}</h2>
          <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div>
              <ResponsiveContainer width="100%" height={Math.max(180, data.byDepartment.length * 35)}>
                <BarChart data={data.byDepartment} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="department" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" name="Bajas" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('common.department')}</th>
                    <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analyticsRotacion.departures')}</th>
                    <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analyticsRotacion.pctTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byDepartment.map((d: any) => (
                    <tr key={d.department} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{d.department}</td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, color: 'var(--danger)', textAlign: 'center' }}>{d.count}</td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                        {data.totalDeactivations12m > 0 ? Math.round((d.count / data.totalDeactivations12m) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Section */}
      <div className="card animate-fade-up" style={{ padding: '1.5rem', borderLeft: `4px solid ${rateColorMap[rateLevel]}` }}>
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsRotacion.analysis')}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.88rem', lineHeight: 1.6 }}>
          {/* Rate interpretation */}
          <div>
            <strong>Tasa de rotación: {data.turnoverRate}% — {rateLabelMap[rateLevel]}</strong>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.84rem' }}>
              {rateLevel === 'healthy' && 'La tasa de rotación se encuentra dentro de rangos saludables (< 8%). Esto indica buena retención de talento y estabilidad organizacional.'}
              {rateLevel === 'moderate' && 'La tasa de rotación es moderada (8-15%). Se recomienda monitorear las causas de salida y fortalecer las estrategias de retención en los departamentos más afectados.'}
              {rateLevel === 'high' && 'La tasa de rotación es alta (15-20%). Es necesario investigar las causas principales, revisar clima laboral, compensaciones y oportunidades de desarrollo para reducir la fuga de talento.'}
              {rateLevel === 'critical' && 'La tasa de rotación es crítica (> 20%). Se requiere acción inmediata: análisis de salidas, encuestas de clima, revisión de compensaciones y planes de retención urgentes.'}
            </p>
          </div>

          {/* Department insight */}
          {topDept && topDept.count > 0 && (
            <div>
              <strong>Departamento con más bajas: {topDept.department} ({topDept.count} bajas)</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.84rem' }}>
                Representa el {data.totalDeactivations12m > 0 ? Math.round((topDept.count / data.totalDeactivations12m) * 100) : 0}% del total de bajas.
                {topDept.count >= 3 && ' Se recomienda una revisión específica de las condiciones laborales en esta área.'}
              </p>
            </div>
          )}

          {/* Tenure insight */}
          {topTenure && topTenure.count > 0 && (
            <div>
              <strong>Antigüedad predominante al salir: {tenureLabels[topTenure.range] || topTenure.range}</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.84rem' }}>
                {topTenure.range === '<6m' && 'La mayoría de las bajas ocurren antes de los 6 meses. Esto sugiere problemas en el proceso de onboarding, expectativas no alineadas o mala experiencia inicial.'}
                {topTenure.range === '6-12m' && 'Las salidas se concentran entre 6 y 12 meses. Puede indicar falta de crecimiento profesional o desilusión después del periodo inicial.'}
                {topTenure.range === '1-2a' && 'Las bajas se concentran entre 1 y 2 años. Típicamente asociado a falta de promoción, desarrollo profesional limitado o mejores ofertas externas.'}
                {topTenure.range === '2-5a' && 'Las salidas ocurren entre 2 y 5 años. Puede indicar estancamiento en la carrera o necesidad de nuevos desafíos.'}
                {topTenure.range === '>5a' && 'Las bajas afectan a colaboradores con más de 5 años. Esto implica pérdida de talento senior y conocimiento institucional importante.'}
              </p>
            </div>
          )}

          {/* Peak month insight */}
          {peakMonth && peakMonth.count > 1 && (
            <div>
              <strong>Mes con más bajas: {(() => {
                const [y, mo] = peakMonth.month.split('-');
                const names = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
                return `${names[Number(mo) - 1]} ${y}`;
              })()} ({peakMonth.count} bajas)</strong>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.84rem' }}>
                Se recomienda analizar si hubo factores específicos durante este período (reestructuraciones, cambios en políticas, evaluaciones de desempeño).
              </p>
            </div>
          )}

          {/* No data case */}
          {!hasDeactivations && (
            <div>
              <p style={{ color: 'var(--success)', fontWeight: 500 }}>
                No se han registrado bajas en los últimos 12 meses. Esto indica una excelente retención del equipo.
              </p>
            </div>
          )}

          {/* Recommendations */}
          {hasDeactivations && (
            <div style={{ marginTop: '0.5rem', padding: '0.85rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
              <strong style={{ fontSize: '0.85rem' }}>{t('analyticsRotacion.recommendations')}:</strong>
              <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {rateLevel !== 'healthy' && <li>Realizar entrevistas de salida para identificar causas recurrentes</li>}
                {topDept && topDept.count >= 2 && <li>Investigar condiciones específicas del departamento {topDept.department}</li>}
                {topTenure?.range === '<6m' && <li>Revisar y mejorar el proceso de onboarding</li>}
                {topTenure?.range === '6-12m' && <li>Implementar planes de desarrollo desde los primeros 6 meses</li>}
                {data.turnoverRate > 10 && <li>Considerar encuestas de clima laboral para detectar insatisfacción temprana</li>}
                {data.turnoverRate > 15 && <li>Revisar política de compensaciones y beneficios frente al mercado</li>}
                <li>Cruzar con los resultados de evaluaciones de desempeño y riesgo de fuga (Informes IA)</li>
              </ul>
            </div>
          )}
        </div>
      </div>

      </>}

      {/* ═══════════ MOVEMENTS SECTION ═══════════ */}
      {activeSection === 'movements' && (
        <div>
          {!movData ? (
            <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No se pudieron cargar los datos de movimientos internos.</p>
            </div>
          ) : (
            <>
              {/* Movement KPIs */}
              <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Total Movimientos</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{movData.totalMovements}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Promociones</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{movData.promotions}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Transferencias</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{movData.lateralTransfers}</div>
                </div>
                <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Cambios de Cargo</div>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: '#f59e0b' }}>{movData.positionChanges}</div>
                </div>
              </div>

              {/* By Type distribution */}
              {movData.byType?.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Distribución por Tipo de Movimiento</h2>
                  <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
                    {movData.byType.map((t: any) => {
                      const colorMap: Record<string, string> = {
                        promotion: 'var(--success)', demotion: 'var(--danger)',
                        department_change: '#6366f1', position_change: '#f59e0b', lateral_transfer: '#14b8a6',
                      };
                      return (
                        <div key={t.type} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: colorMap[t.type] || 'var(--accent)' }}>{t.count}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: '0.2rem' }}>
                            {movementTypeLabels[t.type] || t.type}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Department Flows */}
              {movData.departmentFlows?.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Flujo entre Departamentos</h2>
                  <div className="table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Flujo</th>
                          <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Cantidad</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movData.departmentFlows.map((f: any) => (
                          <tr key={f.flow} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{f.flow}</td>
                            <td style={{ padding: '0.6rem 0.75rem', fontWeight: 700, textAlign: 'center', color: 'var(--accent)' }}>{f.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent Movements */}
              {movData.recent?.length > 0 && (
                <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
                  <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Movimientos Recientes</h2>
                  <div className="table-wrapper">
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Colaborador</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tipo</th>
                          <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>De → A</th>
                          <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fecha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movData.recent.map((m: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.6rem 0.75rem', fontWeight: 500 }}>{m.userName}</td>
                            <td style={{ padding: '0.6rem 0.75rem' }}>
                              <span className="badge badge-ghost" style={{ fontSize: '0.72rem' }}>{movementTypeLabels[m.movementType] || m.movementType}</span>
                            </td>
                            <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.8rem' }}>
                              {m.fromDepartment || m.fromPosition || '—'} → {m.toDepartment || m.toPosition || '—'}
                            </td>
                            <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              {m.effectiveDate ? new Date(m.effectiveDate).toLocaleDateString('es-CL') : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {movData.totalMovements === 0 && (
                <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    No se han registrado movimientos internos en los últimos 12 meses. Los movimientos se registran automáticamente al cambiar departamento o cargo de un colaborador.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {/* ═══════════ FLIGHT RISK SECTION ═══════════ */}
      {activeSection === 'flight-risk' && <FlightRiskTab />}

      {/* ═══════════ RETENTION SECTION ═══════════ */}
      {activeSection === 'retention' && <RetentionTab />}
    </div>
  );
}

/* ─── Flight Risk Tab ────────────────────────────────────────────────── */
function FlightRiskTab() {
  const { data, isLoading, error } = useFlightRisk();
  const { departments } = useDepartments();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [riskFilter, setRiskFilter] = useState('');

  if (isLoading) return <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>;
  if (error) return <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--danger)' }}>Error al cargar datos de riesgo de fuga</div>;
  if (!data || !data.scores) return <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin datos disponibles. Se requieren evaluaciones completadas, objetivos y feedback para calcular el riesgo.</div>;

  const filtered = data.scores.filter((s: any) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.department || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (deptFilter && s.department !== deptFilter) return false;
    if (riskFilter && s.riskLevel !== riskFilter) return false;
    return true;
  });

  const riskColor = (level: string) => level === 'high' ? 'var(--danger)' : level === 'medium' ? 'var(--warning)' : 'var(--success)';
  const riskLabel = (level: string) => level === 'high' ? 'Alto' : level === 'medium' ? 'Medio' : 'Bajo';

  return (
    <div>
      {/* KPIs */}
      <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{data.summary?.high || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Riesgo Alto</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--warning)' }}>{data.summary?.medium || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Riesgo Medio</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{data.summary?.low || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Riesgo Bajo</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.totalEmployees || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Total Evaluados</div>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="input" placeholder="Buscar por nombre o departamento..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: '200px', fontSize: '0.85rem' }} />
        <select className="input" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} style={{ minWidth: '150px', fontSize: '0.82rem' }}>
          <option value="">Todos los deptos.</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} style={{ minWidth: '120px', fontSize: '0.82rem' }}>
          <option value="">Todo riesgo</option>
          <option value="high">Alto</option>
          <option value="medium">Medio</option>
          <option value="low">Bajo</option>
        </select>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{filtered.length} de {data.scores.length}</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}>
        <div className="table-wrapper" style={{ margin: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr>
                {['Colaborador', 'Departamento', 'Riesgo', 'Puntaje', 'Factores'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 30).map((s: any) => (
                <tr key={s.userId} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{s.name}<br /><span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{s.position || ''}</span></td>
                  <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>{s.department || '—'}</td>
                  <td style={{ padding: '0.6rem 0.75rem' }}><span style={{ fontWeight: 700, color: riskColor(s.riskLevel) }}>{riskLabel(s.riskLevel)}</span></td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ width: '60px', height: '6px', background: 'var(--border)', borderRadius: '999px' }}>
                        <div style={{ height: '100%', width: `${s.riskScore}%`, background: riskColor(s.riskLevel), borderRadius: '999px' }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: '0.78rem' }}>{s.riskScore}</span>
                    </div>
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {(s.factors || []).filter((f: any) => f.impact === 'negative').map((f: any) => f.label).join(', ') || 'Sin factores negativos'}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin resultados</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analysis */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', borderLeft: `4px solid ${(data.summary?.high || 0) > 3 ? 'var(--danger)' : (data.summary?.high || 0) > 0 ? 'var(--warning)' : 'var(--success)'}` }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Análisis de Riesgo de Fuga</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p><strong>Nivel general:</strong> {data.summary?.high || 0} colaboradores en riesgo alto, {data.summary?.medium || 0} en medio y {data.summary?.low || 0} en bajo de un total de {data.totalEmployees || 0}.</p>
          {(data.summary?.high || 0) > 0 && <p><strong>Acción urgente:</strong> Los colaboradores en riesgo alto requieren atención inmediata — conversaciones de retención, revisión de condiciones laborales y planes de acción personalizados.</p>}
          {(data.summary?.high || 0) === 0 && <p style={{ color: 'var(--success)' }}><strong>Sin riesgo alto:</strong> Ningún colaborador se encuentra en riesgo alto de fuga. Mantener las buenas prácticas de retención.</p>}
          <p><strong>Factores evaluados:</strong> Puntaje de evaluación (30%), cumplimiento de objetivos (25%), feedback recibido en 90 días (20%), objetivos en riesgo (15%), posición Nine Box (10%). Datos calculados en tiempo real de todos los ciclos.</p>
        </div>
      </div>
    </div>
  );
}

/* ─── Retention Tab ──────────────────────────────────────────────────── */
function RetentionTab() {
  const { data, isLoading } = useRetentionRecommendations();
  const [search, setSearch] = useState('');

  if (isLoading) return <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>;
  if (!data || !data.recommendations) return <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin datos de retención. Se requiere primero el análisis de riesgo de fuga.</div>;

  const filtered = data.recommendations.filter((r: any) =>
    !search || r.name?.toLowerCase().includes(search.toLowerCase()) || (r.department || '').toLowerCase().includes(search.toLowerCase())
  );

  const actionTypeLabels: Record<string, string> = { pdi: 'Plan de Desarrollo', coaching: 'Coaching', engagement: 'Engagement', retention: 'Retención', conversation: 'Conversación' };
  const priorityColor: Record<string, string> = { alta: 'var(--danger)', media: 'var(--warning)', baja: 'var(--text-muted)' };

  return (
    <div>
      {/* KPIs */}
      <div className="animate-fade-up mobile-single-col" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{data.totalHighRisk || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Riesgo Alto</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--warning)' }}>{data.totalMediumRisk || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Riesgo Medio</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.recommendations?.length || 0}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Acciones Recomendadas</div>
        </div>
      </div>

      {/* Search */}
      <input className="input" placeholder="Buscar por nombre o departamento..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: '1rem', fontSize: '0.85rem' }} />

      {/* Recommendations */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {filtered.map((r: any, i: number) => (
          <div key={i} className="card" style={{ padding: '1rem', borderLeft: `3px solid ${r.riskLevel === 'high' ? 'var(--danger)' : 'var(--warning)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{r.name}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{r.department || ''}</span>
              </div>
              <span style={{ fontWeight: 700, color: r.riskLevel === 'high' ? 'var(--danger)' : 'var(--warning)', fontSize: '0.78rem' }}>
                Riesgo: {r.riskScore}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {(r.actions || []).map((a: any, j: number) => (
                <div key={j} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                  <span className="badge badge-ghost" style={{ fontSize: '0.68rem' }}>{actionTypeLabels[a.type] || a.type}</span>
                  <span style={{ color: 'var(--text-secondary)', flex: 1 }}>{a.description}</span>
                  <span style={{ fontSize: '0.68rem', fontWeight: 700, color: priorityColor[a.priority] || 'var(--text-muted)' }}>{a.priority}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin recomendaciones de retención activas</div>}
      </div>

      {/* Analysis */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>Análisis de Retención</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p><strong>Cobertura:</strong> Se generan recomendaciones para todos los colaboradores en riesgo alto y los 5 principales en riesgo medio.</p>
          <p><strong>Tipos de acción:</strong> Plan de Desarrollo (mejorar competencias), Coaching (acompañamiento directo), Engagement (aumentar conexión), Retención (compensación/beneficios), Conversación (diálogo directo con jefatura).</p>
          {(data.totalHighRisk || 0) > 0 && <p><strong>Prioridad:</strong> Los {data.totalHighRisk} colaboradores en riesgo alto deben ser atendidos con urgencia. Las acciones marcadas como "alta" prioridad requieren ejecución inmediata.</p>}
          {(data.totalHighRisk || 0) === 0 && <p style={{ color: 'var(--success)' }}><strong>Sin urgencias:</strong> No hay colaboradores en riesgo alto. Enfocarse en acciones preventivas para los de riesgo medio.</p>}
        </div>
      </div>
    </div>
  );
}

export default function TurnoverPage() {
  return (
    <PlanGate feature="ANALYTICS_REPORTS">
      <TurnoverPageContent />
    </PlanGate>
  );
}
