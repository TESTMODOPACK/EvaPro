'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatRut } from '@/lib/rut';
import { formatCLP } from '@/lib/format';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const statusLabel: Record<string, string> = {
  active: 'Activa',
  trial: 'En trial',
  suspended: 'Suspendida',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};

const statusBadge: Record<string, string> = {
  active: 'badge-success',
  trial: 'badge-warning',
  suspended: 'badge-danger',
  cancelled: 'badge-danger',
  expired: 'badge-danger',
};

export default function MiSuscripcionPage() {
  const token = useAuthStore((s) => s.token);
  const [sub, setSub] = useState<any>(null);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.subscriptions.mySubscription(token).catch(() => null),
      api.users.list(token, 1, 1).then((r) => r.total || 0).catch(() => 0),
    ])
      .then(([s, count]) => { setSub(s); setUserCount(count as number); })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <Spinner />;

  const plan = sub?.plan;
  const maxEmp = plan?.maxEmployees || 0;
  const usagePct = maxEmp > 0 ? Math.round((userCount / maxEmp) * 100) : 0;
  const usageColor = usagePct > 90 ? 'var(--danger)' : usagePct > 70 ? 'var(--warning)' : 'var(--success)';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{'Mi Suscripci\u00f3n'}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {'Plan y l\u00edmites de tu organizaci\u00f3n'}
        </p>
      </div>

      {sub && plan ? (
        <>
          {/* Plan info card */}
          <div className="card animate-fade-up-delay-1" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.35rem' }}>Plan actual</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent)' }}>{plan.name}</div>
                {plan.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>{plan.description}</p>}
              </div>
              <span className={`badge ${statusBadge[sub.status] || 'badge-accent'}`} style={{ fontSize: '0.85rem', padding: '0.3rem 0.75rem' }}>
                {statusLabel[sub.status] || sub.status}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Inicio</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{sub.startDate ? new Date(sub.startDate).toLocaleDateString('es-ES') : '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Vencimiento</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{sub.endDate ? new Date(sub.endDate).toLocaleDateString('es-ES') : 'Sin vencimiento'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Precio mensual</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{plan.monthlyPrice ? formatCLP(plan.monthlyPrice) : 'Gratuito'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Max empleados</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{maxEmp}</div>
              </div>
            </div>
          </div>

          {/* Usage card */}
          <div className="card animate-fade-up-delay-2" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Uso de usuarios</h2>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {userCount} de {maxEmp} usuarios
              </span>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: usageColor }}>
                {usagePct}%
              </span>
            </div>
            <div style={{ height: '12px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(usagePct, 100)}%`,
                background: usageColor,
                borderRadius: '999px',
                transition: 'width 0.6s ease',
              }} />
            </div>
            {usagePct > 90 && (
              <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.75rem', fontWeight: 500 }}>
                {'Est\u00e1s cerca del l\u00edmite de usuarios de tu plan. Contacta al administrador para aumentar la capacidad.'}
              </p>
            )}
          </div>

          {/* Features card */}
          {plan.features && plan.features.length > 0 && (
            <div className="card animate-fade-up-delay-3" style={{ padding: '1.75rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>{'Caracter\u00edsticas incluidas'}</h2>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {plan.features.map((f: string, i: number) => (
                  <span key={i} className="badge badge-accent" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}>
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="card animate-fade-up-delay-1" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>!</div>
          <p style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.25rem', fontSize: '1.1rem' }}>Sin plan asignado</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            Contacte al administrador del sistema para asignar un plan a su organizacion.
          </p>
        </div>
      )}
    </div>
  );
}
