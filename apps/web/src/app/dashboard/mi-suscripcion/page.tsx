'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { formatRut } from '@/lib/rut';
import { formatCLP } from '@/lib/format';
import { subscriptionStatusLabel as statusLabel, subscriptionStatusBadge as statusBadge } from '@/lib/statusMaps';

const featureLabels: Record<string, string> = {
  EVAL_90_180: 'Evaluaciones 90\u00b0 / 180\u00b0',
  EVAL_270: 'Evaluaciones 270\u00b0',
  EVAL_360: 'Evaluaciones 360\u00b0',
  BASIC_REPORTS: 'Reportes b\u00e1sicos',
  ADVANCED_REPORTS: 'Reportes avanzados (Radar, Bell, Heatmap, Gap)',
  OKR: 'OKRs / Objetivos',
  FEEDBACK: 'Feedback continuo',
  CHECKINS: 'Check-ins 1:1',
  TEMPLATES_CUSTOM: 'Plantillas personalizadas',
  PDI: 'Planes de desarrollo (PDI)',
  NINE_BOX: 'Nine Box / Talent Assessment',
  CALIBRATION: 'Calibraci\u00f3n',
  AI_INSIGHTS: 'An\u00e1lisis con IA',
  PUBLIC_API: 'API p\u00fablica',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const billingPeriodLabel: Record<string, string> = {
  monthly: 'Mensual',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
};

const paymentStatusLabel: Record<string, string> = {
  paid: 'Pagado',
  pending: 'Pendiente',
  failed: 'Fallido',
  refunded: 'Reembolsado',
};

const paymentStatusBadge: Record<string, string> = {
  paid: 'badge-success',
  pending: 'badge-warning',
  failed: 'badge-danger',
  refunded: 'badge-accent',
};

export default function MiSuscripcionPage() {
  const token = useAuthStore((s) => s.token);
  const [sub, setSub] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.subscriptions.mySubscription(token).catch(() => null),
      api.users.list(token, 1, 1).then((r) => r.total || 0).catch(() => 0),
      api.subscriptions.myPayments(token).catch(() => []),
    ])
      .then(([s, count, pays]) => { setSub(s); setUserCount(count as number); setPayments(pays as any[]); })
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
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  {sub.nextBillingDate
                    ? new Date(sub.nextBillingDate).toLocaleDateString('es-CL')
                    : sub.endDate
                      ? new Date(sub.endDate).toLocaleDateString('es-CL')
                      : sub.autoRenew
                        ? 'Renovación automática'
                        : 'Sin vencimiento'}
                </div>
                {sub.nextBillingDate && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    Próximo cobro
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Precio mensual</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  {plan.monthlyPrice > 0
                    ? `${Number(plan.monthlyPrice).toFixed(1)} ${plan.currency || 'UF'}/mes`
                    : 'Gratuito'}
                </div>
                {plan.yearlyPrice > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    Anual: {Number(plan.yearlyPrice).toFixed(0)} {plan.currency || 'UF'}/a\u00f1o (2 meses gratis)
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Max empleados</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{maxEmp}</div>
              </div>
            </div>
          </div>

          {/* Expiration alert */}
          {(() => {
            const expiryDate = sub.nextBillingDate || sub.endDate;
            if (!expiryDate) return null;
            const daysLeft = Math.ceil((new Date(expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            if (daysLeft > 10) return null;
            const isUrgent = daysLeft <= 3;
            return (
              <div className="card" style={{
                padding: '1.25rem 1.5rem',
                marginBottom: '1.5rem',
                background: isUrgent ? 'var(--danger-bg, #fef2f2)' : 'var(--warning-bg, #fffbeb)',
                borderLeft: `4px solid ${isUrgent ? 'var(--danger)' : 'var(--warning)'}`,
              }}>
                <div style={{ fontWeight: 700, color: isUrgent ? 'var(--danger)' : 'var(--warning)', marginBottom: '0.25rem' }}>
                  {isUrgent ? `Tu suscripción vence en ${daysLeft} día${daysLeft > 1 ? 's' : ''}` : `Tu suscripción vence pronto (${daysLeft} días)`}
                </div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Fecha de vencimiento: {new Date(expiryDate).toLocaleDateString('es-CL')}. {isUrgent ? 'Renueva ahora para evitar la suspensión del servicio.' : 'Recuerda renovar a tiempo.'}
                </div>
              </div>
            );
          })()}

          {/* Billing info card */}
          <div className="card animate-fade-up-delay-2" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Estado de Pago</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Período de facturación</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{billingPeriodLabel[sub.billingPeriod] || sub.billingPeriod || 'Mensual'}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Último pago</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  {sub.lastPaymentDate ? new Date(sub.lastPaymentDate).toLocaleDateString('es-CL') : 'Sin pagos registrados'}
                </div>
                {sub.lastPaymentAmount > 0 && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Number(sub.lastPaymentAmount).toFixed(2)} {plan.currency || 'UF'}</div>
                )}
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Próximo vencimiento</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                  {sub.nextBillingDate ? new Date(sub.nextBillingDate).toLocaleDateString('es-CL') : sub.endDate ? new Date(sub.endDate).toLocaleDateString('es-CL') : '-'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Renovación automática</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{sub.autoRenew ? 'Activada' : 'Desactivada'}</div>
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
                Estas cerca del limite de usuarios de tu plan.
              </p>
            )}
          </div>

          {/* Payment history */}
          {payments.length > 0 && (
            <div className="card animate-fade-up-delay-3" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Historial de Pagos</h2>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Fecha</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Periodo</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Monto</th>
                      <th style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '2px solid var(--border)' }}>Estado</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Metodo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.slice(0, 12).map((p: any) => (
                      <tr key={p.id}>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                          {p.paidAt ? new Date(p.paidAt).toLocaleDateString('es-CL') : new Date(p.createdAt).toLocaleDateString('es-CL')}
                        </td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                          {new Date(p.periodStart).toLocaleDateString('es-CL')} - {new Date(p.periodEnd).toLocaleDateString('es-CL')}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                          {Number(p.amount).toFixed(2)} {p.currency}
                        </td>
                        <td style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>
                          <span className={`badge ${paymentStatusBadge[p.status] || 'badge-accent'}`} style={{ fontSize: '0.75rem' }}>
                            {paymentStatusLabel[p.status] || p.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                          {p.paymentMethod || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Features card */}
          {plan.features && plan.features.length > 0 && (
            <div className="card animate-fade-up-delay-3" style={{ padding: '1.75rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Caracteristicas incluidas</h2>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {plan.features.map((f: string, i: number) => (
                  <span key={i} className="badge badge-accent" style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem' }}>
                    {featureLabels[f] || f}
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
