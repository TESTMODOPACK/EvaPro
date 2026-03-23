'use client';

import { useCycles } from '@/hooks/useCycles';
import { useAuthStore } from '@/store/auth.store';
import Link from 'next/link';

const typeLabels: Record<string, string> = {
  '90': '90°',
  '180': '180°',
  '270': '270°',
  '360': '360°',
};

const statusLabels: Record<string, string> = {
  draft: 'borrador',
  active: 'activo',
  closed: 'cerrado',
};

const statusBadge: Record<string, string> = {
  draft: 'badge-accent',
  active: 'badge-success',
  closed: 'badge-warning',
};

const typeBadge: Record<string, string> = {
  '90': 'badge-accent',
  '180': 'badge-accent',
  '270': 'badge-warning',
  '360': 'badge-danger',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

export default function EvaluacionesPage() {
  const { data: cycles, isLoading } = useCycles();
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'tenant_admin';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Evaluaciones</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {isAdmin ? 'Gestiona los ciclos de evaluacion de desempeno' : 'Tus ciclos de evaluacion'}
          </p>
        </div>
        {isAdmin && (
          <Link href="/dashboard/evaluaciones/nuevo" style={{ textDecoration: 'none' }}>
            <button className="btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Nuevo ciclo
            </button>
          </Link>
        )}
      </div>

      {/* Loading */}
      {isLoading ? (
        <Spinner />
      ) : !cycles || cycles.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            No hay ciclos de evaluacion
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Crea tu primer ciclo para comenzar
          </p>
        </div>
      ) : (
        /* Cards grid */
        <div
          className="animate-fade-up-delay-1"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
        >
          {cycles.map((cycle: any) => {
            const startDate = cycle.startDate
              ? new Date(cycle.startDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '–';
            const endDate = cycle.endDate
              ? new Date(cycle.endDate).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
              : '–';
            const totalEval = cycle.totalEvaluated || 0;

            return (
              <Link
                key={cycle.id}
                href={`/dashboard/evaluaciones/${cycle.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div
                  className="card"
                  style={{ padding: '1.4rem', cursor: 'pointer', transition: 'var(--transition)', height: '100%' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.875rem' }}>
                    <span className={`badge ${typeBadge[cycle.type] || 'badge-accent'}`}>
                      {typeLabels[cycle.type] || cycle.type}
                    </span>
                    <span className={`badge ${statusBadge[cycle.status] || 'badge-accent'}`}>
                      {statusLabels[cycle.status] || cycle.status}
                    </span>
                  </div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', lineHeight: 1.4 }}>
                    {cycle.name}
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    {startDate} — {endDate}
                  </p>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
                    {totalEval} evaluado{totalEval !== 1 ? 's' : ''}
                  </p>

                  {/* Progress for active cycles */}
                  {cycle.status === 'active' && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Progreso
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-hover)' }}>
                          {totalEval > 0 ? 'En curso' : 'Sin asignaciones'}
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{
                          width: totalEval > 0 ? '50%' : '0%',
                          height: '100%', borderRadius: '999px',
                          background: 'var(--accent)',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  )}

                  {cycle.status === 'closed' && (
                    <div style={{ marginBottom: '0.5rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Completado
                        </span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--success)' }}>
                          100%
                        </span>
                      </div>
                      <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{
                          width: '100%', height: '100%', borderRadius: '999px',
                          background: 'var(--success)',
                          transition: 'width 0.5s ease',
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
