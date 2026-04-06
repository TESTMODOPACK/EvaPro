'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
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
  const [activeSection, setActiveSection] = useState<'departures' | 'movements'>('departures');
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

  const handleExport = async (format: 'csv' | 'xlsx') => {
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
          <button
            className="btn-ghost"
            onClick={() => handleExport('csv')}
            disabled={!!exporting}
            style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
          >
            {exporting === 'csv' ? t('common.exporting') : t('common.exportCsv')}
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
            <p><strong>¿Qué muestra?</strong> Análisis de salidas de la empresa y movimientos internos en los últimos 12 meses — tipo de salida, motivo, voluntaria/involuntaria, y movimientos de personal entre áreas.</p>
            <p><strong>Indicadores:</strong> Usuarios activos, bajas en 12 meses, tasa de rotación (bajas/total al inicio del período × 100), inactivos totales.</p>
            <p><strong>Rangos de rotación:</strong> Saludable (&lt;8%), Moderada (8-15%), Alta (15-20%), Crítica (&gt;20%).</p>
            <p><strong>Bajas por mes:</strong> Gráfico de barras mostrando los últimos 12 meses (incluye meses sin bajas con valor 0).</p>
            <p><strong>Antigüedad al salir:</strong> Distribución de cuánto tiempo llevaban los colaboradores que se fueron (&lt;6m, 6-12m, 1-2a, 2-5a, &gt;5a).</p>
            <p><strong>Bajas por departamento:</strong> Tabla con gráfico horizontal identificando áreas más afectadas.</p>
            <p><strong>Análisis:</strong> Interpretación detallada con recomendaciones específicas según los datos (entrevistas de salida, revisión de onboarding, etc.).</p>
            <p><strong>Exportación:</strong> Excel (multi-hoja) y CSV.</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Solo administradores.
          </div>
        </div>
      )}

      {/* Section tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        {[
          { key: 'departures' as const, label: `Salidas de la Empresa (${data.totalDeactivations12m || 0})` },
          { key: 'movements' as const, label: `Movimientos Internos (${movData?.totalMovements || 0})` },
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
