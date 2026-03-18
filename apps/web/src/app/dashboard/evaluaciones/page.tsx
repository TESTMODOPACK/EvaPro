'use client';

const evaluaciones = [
  { id: 1, nombre: 'Evaluación Semestral Q1 2026', ciclo: 'Q1 2026', tipo: 'Periódica', progreso: 67, total: 24, completadas: 16, estado: 'activa' },
  { id: 2, nombre: 'Evaluación 360° Liderazgo',    ciclo: 'Q1 2026', tipo: '360°',     progreso: 40, total: 10, completadas: 4,  estado: 'activa' },
  { id: 3, nombre: 'Evaluación Fin de Año 2025',   ciclo: 'Q4 2025', tipo: 'Periódica', progreso: 100, total: 30, completadas: 30, estado: 'cerrada' },
  { id: 4, nombre: 'OKRs Tech Team Q2 2026',       ciclo: 'Q2 2026', tipo: 'OKR',      progreso: 0,   total: 12, completadas: 0,  estado: 'planificada' },
];

const statusColor: Record<string, string> = {
  activa:       'badge-success',
  cerrada:      'badge-info',
  planificada:  'badge-accent',
};
const tipoColor: Record<string, string> = {
  Periódica: 'badge-accent',
  '360°':    'badge-info',
  OKR:       'badge-warning',
};

export default function EvaluacionesPage() {
  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Evaluaciones</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestiona los ciclos de evaluación de desempeño
          </p>
        </div>
        <button className="btn-primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nueva evaluación
        </button>
      </div>

      {/* Cards grid */}
      <div
        className="animate-fade-up-delay-1"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
      >
        {evaluaciones.map((ev) => (
          <div
            key={ev.id}
            className="card"
            style={{ padding: '1.4rem', cursor: 'pointer', transition: 'var(--transition)' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
              <span className={`badge ${tipoColor[ev.tipo]}`}>{ev.tipo}</span>
              <span className={`badge ${statusColor[ev.estado]}`}>{ev.estado}</span>
            </div>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', lineHeight: 1.4 }}>
              {ev.nombre}
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Ciclo: {ev.ciclo}
            </p>

            {/* Progress */}
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  Progreso — {ev.completadas}/{ev.total} completadas
                </span>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: ev.progreso === 100 ? 'var(--success)' : 'var(--accent-hover)' }}>
                  {ev.progreso}%
                </span>
              </div>
              <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                <div style={{
                  width: `${ev.progreso}%`, height: '100%', borderRadius: '999px',
                  background: ev.progreso === 100 ? 'var(--success)' : 'var(--accent)',
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
