'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const COLORS = ['#C9933A', '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const tenureLabels: Record<string, string> = {
  '<6m': 'Menos de 6 meses',
  '6-12m': '6 a 12 meses',
  '1-2a': '1 a 2 años',
  '2-5a': '2 a 5 años',
  '>5a': 'Más de 5 años',
};

function TurnoverPageContent() {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/reports/analytics/turnover`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [token]);

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/reports/analytics/turnover/export?format=${format}`,
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
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  // Analysis logic
  const hasDeactivations = data.totalDeactivations12m > 0;
  const rateLevel = data.turnoverRate > 20 ? 'critical' : data.turnoverRate > 15 ? 'high' : data.turnoverRate > 8 ? 'moderate' : 'healthy';
  const rateLabelMap = { critical: 'Crítica', high: 'Alta', moderate: 'Moderada', healthy: 'Saludable' };
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Análisis de Rotación</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Análisis de bajas en los últimos 12 meses</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-ghost"
            onClick={() => handleExport('xlsx')}
            disabled={!!exporting}
            style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
          >
            {exporting === 'xlsx' ? 'Exportando...' : 'Exportar Excel'}
          </button>
          <button
            className="btn-ghost"
            onClick={() => handleExport('csv')}
            disabled={!!exporting}
            style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}
          >
            {exporting === 'csv' ? 'Exportando...' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Activos</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{data.activeUsers}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Bajas (12m)</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--danger)' }}>{data.totalDeactivations12m}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Tasa Rotación</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: rateColorMap[rateLevel] }}>{data.turnoverRate}%</div>
          <div style={{ fontSize: '0.72rem', color: rateColorMap[rateLevel], fontWeight: 600, marginTop: '0.15rem' }}>{rateLabelMap[rateLevel]}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Inactivos Total</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-muted)' }}>{data.inactiveUsers}</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Monthly trend - always show */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Bajas por Mes</h2>
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
              Sin bajas registradas en los últimos 12 meses
            </p>
          )}
        </div>

        {/* By tenure - always show */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Antigüedad al Salir</h2>
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
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Bajas por Departamento</h2>
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
                    <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Departamento</th>
                    <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Bajas</th>
                    <th style={{ textAlign: 'center', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>% del Total</th>
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
        <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>Análisis del Resultado</h2>
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
              <strong style={{ fontSize: '0.85rem' }}>Recomendaciones:</strong>
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
