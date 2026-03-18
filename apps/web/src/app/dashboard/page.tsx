'use client';

import { useAuthStore } from '@/store/auth.store';

interface KpiCard {
  label: string;
  value: string;
  delta: string;
  deltaUp: boolean;
  icon: React.ReactNode;
  color: string;
}

const kpis: KpiCard[] = [
  {
    label: 'Evaluaciones activas',
    value: '24',
    delta: '+3 este mes',
    deltaUp: true,
    color: '#6366f1',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    label: 'Empleados evaluados',
    value: '187',
    delta: '+12 nuevos',
    deltaUp: true,
    color: '#10b981',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    label: 'Puntuación promedio',
    value: '7.8',
    delta: '+0.4 vs anterior',
    deltaUp: true,
    color: '#f59e0b',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
  },
  {
    label: 'Pendientes de completar',
    value: '8',
    delta: '-5 esta semana',
    deltaUp: false,
    color: '#ef4444',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
];

const recentActivity = [
  { name: 'María García',     role: 'Desarrolladora Sr.',  score: 9.1, status: 'completada',  date: 'Hoy' },
  { name: 'Carlos López',     role: 'Product Manager',     score: 8.3, status: 'completada',  date: 'Ayer' },
  { name: 'Ana Martínez',     role: 'Diseñadora UX',       score: 7.6, status: 'completada',  date: '15 mar' },
  { name: 'Luis Rodríguez',   role: 'DevOps Engineer',     score: null, status: 'pendiente',  date: '–' },
  { name: 'Sandra Torres',    role: 'QA Especialista',     score: 8.9, status: 'completada',  date: '12 mar' },
];

function ScoreBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 8.5 ? '#10b981' : score >= 7 ? '#6366f1' : '#f59e0b';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <div style={{
        flex: 1, height: '6px', borderRadius: '999px',
        background: 'var(--bg-surface)',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: '999px',
          background: color, transition: 'width 0.5s ease',
        }} />
      </div>
      <span style={{ fontSize: '0.8rem', fontWeight: 700, color, minWidth: '2rem', textAlign: 'right' }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

export default function DashboardPage() {
  const user = useAuthStore((s) => s.user);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', marginBottom: '0.25rem' }}>
          Bienvenido de vuelta 👋
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          {user?.email} · {new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* KPI Cards */}
      <div
        className="animate-fade-up-delay-1"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        {kpis.map((kpi, i) => (
          <div
            key={i}
            className="card"
            style={{ padding: '1.4rem', position: 'relative', overflow: 'hidden' }}
          >
            <div style={{
              position: 'absolute', top: '-20px', right: '-20px',
              width: '80px', height: '80px', borderRadius: '50%',
              background: `${kpi.color}18`,
            }} />
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: '42px', height: '42px', borderRadius: '0.625rem',
              background: `${kpi.color}20`, color: kpi.color, marginBottom: '1rem',
            }}>
              {kpi.icon}
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: '0.3rem' }}>
              {kpi.value}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              {kpi.label}
            </div>
            <div style={{
              fontSize: '0.75rem', fontWeight: 600,
              color: kpi.deltaUp ? 'var(--success)' : 'var(--danger)',
              display: 'flex', alignItems: 'center', gap: '0.25rem',
            }}>
              <span>{kpi.deltaUp ? '↑' : '↓'}</span>
              {kpi.delta}
            </div>
          </div>
        ))}
      </div>

      {/* Lower grid */}
      <div
        className="animate-fade-up-delay-2"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: '1.25rem',
        }}
      >
        {/* Recent evaluations table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ fontWeight: 700, fontSize: '0.975rem' }}>Evaluaciones recientes</h2>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>Últimas 5 evaluaciones del ciclo actual</p>
            </div>
            <a href="/dashboard/evaluaciones" style={{ fontSize: '0.78rem', color: 'var(--accent-hover)', textDecoration: 'none', fontWeight: 600 }}>
              Ver todas →
            </a>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Cargo</th>
                  <th>Puntuación</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((row, i) => (
                  <tr key={i}>
                    <td>{row.name}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{row.role}</td>
                    <td style={{ minWidth: '130px' }}>
                      {row.score !== null
                        ? <ScoreBar score={row.score} />
                        : <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Pendiente</span>
                      }
                    </td>
                    <td>
                      <span className={`badge ${row.status === 'completada' ? 'badge-success' : 'badge-warning'}`}>
                        {row.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{row.date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column: Progress + Quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Cycle progress */}
          <div className="card" style={{ padding: '1.4rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>Ciclo Q1 2026</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Terminado el 31 de marzo
            </p>
            {[
              { label: 'Completadas', value: 16, total: 24, color: 'var(--success)' },
              { label: 'En progreso', value: 5, total: 24, color: 'var(--accent-hover)' },
              { label: 'Sin iniciar', value: 3, total: 24, color: 'var(--warning)' },
            ].map((item, i) => (
              <div key={i} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{item.label}</span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: item.color }}>
                    {item.value}/{item.total}
                  </span>
                </div>
                <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                  <div style={{
                    width: `${(item.value / item.total) * 100}%`,
                    height: '100%', borderRadius: '999px',
                    background: item.color, transition: 'width 0.6s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="card" style={{ padding: '1.4rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem' }}>Acciones rápidas</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {[
                { label: 'Nueva evaluación', icon: '＋', href: '/dashboard/evaluaciones' },
                { label: 'Agregar usuario', icon: '👤', href: '/dashboard/usuarios' },
                { label: 'Ver reporte Q1', icon: '📊', href: '/dashboard/reportes' },
              ].map((action, i) => (
                <a
                  key={i}
                  href={action.href}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.65rem 0.875rem',
                    background: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                    textDecoration: 'none',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    transition: 'var(--transition)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  <span style={{ fontSize: '1rem' }}>{action.icon}</span>
                  {action.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
