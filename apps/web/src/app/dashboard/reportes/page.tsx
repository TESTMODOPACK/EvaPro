'use client';

const metricas = [
  { label: 'Promedio global', value: '7.8 / 10', icon: '⭐', color: '#f59e0b' },
  { label: 'Evaluados este Q',  value: '187',        icon: '👥', color: '#6366f1' },
  { label: 'Tasa de completado', value: '94%',       icon: '✅', color: '#10b981' },
  { label: 'Tiempo promedio',  value: '18 min',      icon: '⏱',  color: '#38bdf8' },
];

const byDept = [
  { dept: 'Tecnología',  avg: 8.4, n: 42, color: '#6366f1' },
  { dept: 'Ventas',      avg: 7.9, n: 38, color: '#10b981' },
  { dept: 'Producto',    avg: 8.1, n: 25, color: '#f59e0b' },
  { dept: 'Diseño',      avg: 8.7, n: 18, color: '#38bdf8' },
  { dept: 'RRHH',        avg: 7.6, n: 14, color: '#a78bfa' },
  { dept: 'DevOps',      avg: 8.2, n: 12, color: '#fb7185' },
];

export default function ReportesPage() {
  const max = Math.max(...byDept.map(d => d.avg));

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Reportes</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Análisis de desempeño · Ciclo Q1 2026
        </p>
      </div>

      {/* KPI row */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {metricas.map((m, i) => (
          <div key={i} className="card" style={{ padding: '1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '1.75rem' }}>{m.icon}</span>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{m.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: m.color, letterSpacing: '-0.02em' }}>{m.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* By department bar chart */}
      <div className="card animate-fade-up-delay-2" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 700, fontSize: '0.975rem', marginBottom: '0.25rem' }}>Promedio por departamento</h2>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Puntuación media de evaluaciones completadas</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {byDept.sort((a, b) => b.avg - a.avg).map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ minWidth: '100px', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'right', fontWeight: 500 }}>
                {d.dept}
              </div>
              <div style={{ flex: 1, height: '10px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${(d.avg / max) * 100}%`,
                    background: d.color,
                    borderRadius: '999px',
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>
              <div style={{ minWidth: '80px', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontWeight: 800, color: d.color, fontSize: '0.9rem' }}>{d.avg}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>({d.n})</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export actions */}
      <div className="animate-fade-up-delay-3" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button className="btn-ghost">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exportar PDF
        </button>
        <button className="btn-ghost">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Exportar Excel
        </button>
      </div>
    </div>
  );
}
