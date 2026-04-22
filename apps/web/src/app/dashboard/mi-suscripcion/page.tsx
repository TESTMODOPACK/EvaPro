'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { subscriptionStatusLabel as statusLabel, subscriptionStatusBadge as statusBadge } from '@/lib/statusMaps';
import { FEATURE_LABELS } from '@/lib/feature-routes';
import PendingInvoicesCard from '@/components/PendingInvoicesCard';

const featureLabels = FEATURE_LABELS;

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

const requestTypeLabel: Record<string, string> = {
  plan_change: 'Cambio de plan',
  cancel: 'Cancelación',
};

const requestStatusLabel: Record<string, string> = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
};

const requestStatusBadge: Record<string, string> = {
  pending: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
};

export default function MiSuscripcionPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [sub, setSub] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [userCount, setUserCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Auto-renew
  const [autoRenewLoading, setAutoRenewLoading] = useState(false);
  const [autoRenewToast, setAutoRenewToast] = useState('');

  // Proration
  const [proration, setProration] = useState<{ credit: number; daysRemaining: number; totalDays: number } | null>(null);

  // AI Addon
  const [aiPacks, setAiPacks] = useState<any[]>([]);
  const [aiAddon, setAiAddon] = useState<{ calls: number; price: number; packId: string | null }>({ calls: 0, price: 0, packId: null });
  const [aiAddonSaving, setAiAddonSaving] = useState(false);

  // Plans list
  const [plans, setPlans] = useState<any[]>([]);

  // Request form
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [reqType, setReqType] = useState<'plan_change' | 'cancel'>('plan_change');
  const [reqTargetPlan, setReqTargetPlan] = useState('');
  const [reqBillingPeriod, setReqBillingPeriod] = useState('monthly');
  const [reqNotes, setReqNotes] = useState('');
  const [reqLoading, setReqLoading] = useState(false);
  const [reqError, setReqError] = useState('');

  // Past requests
  const [myRequests, setMyRequests] = useState<any[]>([]);

  // AI usage
  const [aiUsage, setAiUsage] = useState<any>(null);
  const [showGuide, setShowGuide] = useState(false);

  function showToast(msg: string) {
    setAutoRenewToast(msg);
    setTimeout(() => setAutoRenewToast(''), 3000);
  }

  function loadAll() {
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.subscriptions.mySubscription(token).catch(() => null),
      api.users.list(token, 1, 1).then((r) => r.total || 0).catch(() => 0),
      api.subscriptions.myPayments(token).catch(() => []),
      api.subscriptions.getProration(token).catch(() => null),
      api.subscriptions.plans.list(token).catch(() => []),
      api.subscriptions.myRequests(token).catch(() => []),
      api.ai.getTenantUsage(token).catch(() => null),
      api.subscriptions.getAiPacks(token).catch(() => []),
      api.subscriptions.getAiAddon(token).catch(() => ({ calls: 0, price: 0, packId: null })),
    ])
      .then(([s, count, pays, prot, plns, reqs, aiUse, packs, addon]) => {
        setSub(s);
        setUserCount(count as number);
        setPayments(pays as any[]);
        setProration(prot as any);
        setPlans((plns as any[]).filter((p: any) => p.isActive));
        setMyRequests(reqs as any[]);
        setAiUsage(aiUse);
        setAiPacks(packs as any[]);
        setAiAddon(addon as any);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadAll(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleAutoRenew() {
    if (!token || !sub) return;
    setAutoRenewLoading(true);
    try {
      await api.subscriptions.toggleAutoRenew(token, { autoRenew: !sub.autoRenew });
      setSub((prev: any) => ({ ...prev, autoRenew: !prev.autoRenew }));
      showToast(`Renovación automática ${!sub.autoRenew ? 'activada' : 'desactivada'}`);
    } catch {
      showToast('Error al actualizar. Intenta de nuevo.');
    } finally {
      setAutoRenewLoading(false);
    }
  }

  async function handleSubmitRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setReqLoading(true);
    setReqError('');
    try {
      const [targetCode, targetPeriod] = (reqTargetPlan || '').split('|');
      await api.subscriptions.createRequest(token, {
        type: reqType,
        targetPlan: reqType === 'plan_change' ? targetCode : undefined,
        targetBillingPeriod: reqType === 'plan_change' ? (targetPeriod || 'monthly') : undefined,
        notes: reqNotes || undefined,
      });
      setShowRequestForm(false);
      setReqNotes('');
      showToast('Solicitud enviada. El equipo de Eva360 la procesará pronto.');
      loadAll();
    } catch (err: any) {
      setReqError(err.message || 'Error al enviar la solicitud');
    } finally {
      setReqLoading(false);
    }
  }

  if (loading) return <Spinner />;

  const plan = sub?.plan;
  const maxEmp = plan?.maxEmployees || 0;
  const usagePct = maxEmp > 0 ? Math.round((userCount / maxEmp) * 100) : 0;
  const usageColor = usagePct > 90 ? 'var(--danger)' : usagePct > 70 ? 'var(--warning)' : 'var(--success)';
  const hasPendingRequest = myRequests.some((r) => r.status === 'pending');

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      {autoRenewToast && (
        <div style={{
          position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 9999,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '0.75rem 1.25rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)', fontSize: '0.9rem', fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          {autoRenewToast}
        </div>
      )}

      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Mi Suscripción</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Plan y límites de tu organización
        </p>
      </div>

      {/* Outstanding invoices — tenant_admin only, auto-hidden when none. */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <PendingInvoicesCard />
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Mi Suscripción</h3>
          <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7, paddingLeft: '1.2rem', margin: '0 0 1rem' }}>
            <li><strong>¿Qué muestra?</strong> El estado de la suscripción de su organización — plan actual, uso, pagos y opciones de cambio.</li>
            <li><strong>Plan actual:</strong> Muestra el plan contratado, sus funcionalidades incluidas, límite de usuarios y precio.</li>
            <li><strong>Uso de IA:</strong> Muestra la cuota mensual de análisis con inteligencia artificial — cuántos informes se han generado y cuántos quedan. Puede ampliar la cuota comprando paquetes adicionales sin cambiar de plan.</li>
            <li><strong>Paquetes de IA:</strong> Créditos adicionales (desde +50 hasta +500 análisis/mes) que se suman a la cuota base del plan. El costo se agrega a la facturación mensual.</li>
            <li><strong>Solicitar cambio de plan:</strong> Si necesita más funcionalidades o usuarios, puede solicitar un cambio de plan. La solicitud es revisada y aprobada por el equipo de soporte.</li>
            <li><strong>Historial de pagos:</strong> Registro de todos los pagos realizados con fechas y montos.</li>
          </ul>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Solo administradores de la organización pueden ver y gestionar la suscripción.
          </div>
        </div>
      )}

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

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1.25rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: '0.25rem' }}>Inicio</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{sub.startDate ? new Date(sub.startDate).toLocaleDateString('es-CL') : '-'}</div>
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
                    Anual: {Number(plan.yearlyPrice).toFixed(0)} {plan.currency || 'UF'}/año (2 meses gratis)
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

          {/* Billing + Auto-renew card */}
          <div className="card animate-fade-up-delay-2" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Estado de Pago</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
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
            </div>

            {/* Auto-renew toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '1rem 1.25rem',
              background: 'var(--bg-surface)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.15rem' }}>Renovación automática</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {sub.autoRenew
                    ? 'Tu suscripción se renovará automáticamente al vencimiento'
                    : 'Tu suscripción NO se renovará al vencimiento — quedará suspendida'}
                </div>
              </div>
              <button
                onClick={handleToggleAutoRenew}
                disabled={autoRenewLoading}
                style={{
                  position: 'relative', width: '48px', height: '26px',
                  borderRadius: '999px', border: 'none', cursor: autoRenewLoading ? 'wait' : 'pointer',
                  background: sub.autoRenew ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'background 0.2s',
                  flexShrink: 0,
                }}
                aria-label="Toggle renovación automática"
              >
                <span style={{
                  position: 'absolute',
                  top: '3px',
                  left: sub.autoRenew ? '25px' : '3px',
                  width: '20px', height: '20px',
                  background: '#fff', borderRadius: '50%',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
              </button>
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
                Estás cerca del límite de usuarios de tu plan.
              </p>
            )}
          </div>

          {/* AI Usage card */}
          <div className="card animate-fade-up-delay-2" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Uso de Inteligencia Artificial</h2>
            {!aiUsage || !aiUsage.hasAiAccess ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{ fontSize: '1.5rem' }}>&#128274;</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>No incluido en su plan</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Los informes de IA están disponibles en planes superiores.</div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {aiUsage.monthlyUsed} de {aiUsage.monthlyLimit} informes IA este mes
                  </span>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: aiUsage.monthlyRemaining <= 0 ? 'var(--danger)' : aiUsage.monthlyRemaining <= Math.ceil(aiUsage.monthlyLimit * 0.1) ? 'var(--warning)' : 'var(--success)' }}>
                    {aiUsage.monthlyLimit > 0 ? Math.round((aiUsage.monthlyUsed / aiUsage.monthlyLimit) * 100) : 0}%
                  </span>
                </div>
                {aiUsage.monthlyUsed > 0 && (
                  <div style={{ height: '8px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.max(Math.min(aiUsage.monthlyLimit > 0 ? (aiUsage.monthlyUsed / aiUsage.monthlyLimit) * 100 : 0, 100), 2)}%`,
                      background: aiUsage.monthlyRemaining <= 0 ? 'var(--danger)' : aiUsage.monthlyRemaining <= Math.ceil(aiUsage.monthlyLimit * 0.1) ? 'var(--warning)' : 'var(--success)',
                      borderRadius: '999px',
                      transition: 'width 0.6s ease',
                    }} />
                  </div>
                )}
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  {aiUsage.monthlyRemaining} informes restantes. Período: {aiUsage.periodStart ? new Date(aiUsage.periodStart).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '--'} al {aiUsage.periodEnd ? new Date(aiUsage.periodEnd).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' }) : '--'}.
                </div>
                {/* Plan + Addon breakdown */}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <span>Plan: {aiUsage.planUsed ?? 0}/{aiUsage.planLimit ?? 0}</span>
                  {(aiUsage.addonRemaining > 0 || aiUsage.addonCalls > 0) && (
                    <span>Adicionales: {aiUsage.addonRemaining ?? 0} restantes de {aiUsage.addonCalls ?? 0}</span>
                  )}
                </div>
                {aiUsage.lastGenerations?.length > 0 && (
                  <div style={{ marginTop: '1rem' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Últimas generaciones
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                      {aiUsage.lastGenerations.slice(0, 5).map((g: any) => (
                        <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{g.type}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                            {new Date(g.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* AI Add-on Pack selector */}
            {aiPacks.length > 0 && aiUsage?.hasAiAccess && (
              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                  Ampliar cuota de análisis IA
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Compre créditos adicionales de IA sin cambiar su plan. Se suman a la cuota base de su plan actual.
                  {aiAddon.calls > 0 && (
                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                      {' '}Actualmente tiene +{aiAddon.calls} créditos adicionales ({aiAddon.price} UF/mes).
                    </span>
                  )}
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {/* Option to remove addon */}
                  <button
                    onClick={async () => {
                      if (!token) return;
                      const usedCredits = Math.max(0, aiUsage ? (aiAddon.calls - (aiUsage.addonRemaining ?? aiAddon.calls)) : 0);
                      const hasUsed = usedCredits > 0;
                      if (hasUsed) {
                        const ok = confirm(
                          `Ha utilizado ${usedCredits} de ${aiAddon.calls} créditos del add-on en este período.\n\nAl cancelar, se cobrará la cuota completa del período actual (${aiAddon.price} UF) porque ya se consumieron créditos.\n\n¿Desea continuar?`
                        );
                        if (!ok) return;
                      }
                      setAiAddonSaving(true);
                      try {
                        await api.subscriptions.setAiAddon(token, 'none');
                        setAiAddon({ calls: 0, price: 0, packId: null });
                        showToast(hasUsed ? `Add-on cancelado. Se cobrará ${aiAddon.price} UF por ${usedCredits} créditos utilizados.` : 'Add-on de IA eliminado sin cargos.');
                        loadAll();
                      } catch (e: any) { showToast(e?.message || 'Error al cancelar add-on'); }
                      setAiAddonSaving(false);
                    }}
                    disabled={aiAddonSaving || !aiAddon.packId}
                    style={{
                      padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm, 6px)',
                      border: !aiAddon.packId ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: !aiAddon.packId ? 'rgba(201,147,58,0.08)' : 'var(--bg-surface)',
                      cursor: aiAddonSaving || !aiAddon.packId ? 'default' : 'pointer',
                      fontSize: '0.82rem', fontWeight: !aiAddon.packId ? 700 : 400,
                      color: !aiAddon.packId ? 'var(--accent)' : 'var(--text-primary)',
                      opacity: aiAddonSaving ? 0.5 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>Sin add-on</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Solo cuota del plan</div>
                  </button>
                  {aiPacks.map((pack: any) => {
                    const isSelected = aiAddon.packId === pack.id;
                    return (
                      <button
                        key={pack.id}
                        onClick={async () => {
                          if (!token || isSelected) return;
                          setAiAddonSaving(true);
                          try {
                            await api.subscriptions.setAiAddon(token, pack.id);
                            setAiAddon({ calls: pack.calls, price: pack.monthlyPrice, packId: pack.id });
                            showToast(`Add-on "${pack.name}" activado`);
                            loadAll();
                          } catch (e: any) { showToast(e?.message || 'Error al cambiar add-on'); }
                          setAiAddonSaving(false);
                        }}
                        disabled={aiAddonSaving || isSelected}
                        style={{
                          padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-sm, 6px)',
                          border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: isSelected ? 'rgba(201,147,58,0.08)' : 'var(--bg-surface)',
                          cursor: aiAddonSaving || isSelected ? 'default' : 'pointer',
                          fontSize: '0.82rem', fontWeight: isSelected ? 700 : 400,
                          color: isSelected ? 'var(--accent)' : 'var(--text-primary)',
                          opacity: aiAddonSaving ? 0.5 : 1,
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{pack.name}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {pack.monthlyPrice} {pack.currency}/mes
                        </div>
                      </button>
                    );
                  })}
                </div>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  El costo del add-on se agrega a la facturación mensual de su suscripción. Puede cambiar o cancelar en cualquier momento.
                </p>
              </div>
            )}
          </div>

          {/* Request plan change card */}
          <div className="card animate-fade-up-delay-3" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.15rem' }}>Solicitud de cambio de plan</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  El equipo de Eva360 procesará tu solicitud
                </p>
              </div>
              {hasPendingRequest ? (
                <span className="badge badge-warning" style={{ fontSize: '0.8rem' }}>Solicitud en proceso</span>
              ) : (
                <button
                  onClick={() => { setShowRequestForm(!showRequestForm); setReqError(''); }}
                  className="btn-secondary"
                  style={{ fontSize: '0.85rem' }}
                >
                  {showRequestForm ? 'Cancelar' : 'Solicitar cambio'}
                </button>
              )}
            </div>

            {hasPendingRequest && (
              <div style={{
                padding: '0.75rem 1rem', background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.25)', borderRadius: 'var(--radius-sm)',
                fontSize: '0.85rem', color: 'var(--text-secondary)',
              }}>
                Ya tienes una solicitud pendiente. Recibirás una notificación cuando sea procesada.
              </div>
            )}

            {showRequestForm && !hasPendingRequest && (
              <form onSubmit={handleSubmitRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Proration info */}
                {proration && proration.credit > 0 && (
                  <div style={{
                    padding: '0.85rem 1rem', background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.25)', borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                  }}>
                    <span style={{ fontWeight: 600, color: 'var(--accent)' }}>Crédito estimado por días restantes:</span>{' '}
                    <span style={{ fontWeight: 700 }}>
                      {plan.currency || 'UF'} {proration.credit.toFixed(2)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      ({proration.daysRemaining} días restantes de {proration.totalDays} del período)
                    </span>
                    <div style={{ color: 'var(--text-muted)', marginTop: '0.25rem', fontSize: '0.78rem' }}>
                      El crédito es informativo. Eva360 lo considerará al aprobar el cambio.
                    </div>
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                      Tipo de solicitud
                    </label>
                    <select
                      value={reqType}
                      onChange={(e) => setReqType(e.target.value as 'plan_change' | 'cancel')}
                      className="input"
                      style={{ width: '100%' }}
                    >
                      <option value="plan_change">Cambio de plan</option>
                      <option value="cancel">Cancelación</option>
                    </select>
                  </div>

                  {reqType === 'plan_change' && (
                    <>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                          Plan deseado (incluye período de facturación)
                        </label>
                        <select
                          value={reqTargetPlan}
                          onChange={(e) => {
                            setReqTargetPlan(e.target.value);
                            // Extract billing period from the selected value
                            const [, period] = (e.target.value || '').split('|');
                            if (period) setReqBillingPeriod(period);
                          }}
                          className="input"
                          style={{ width: '100%' }}
                          required
                        >
                          <option value="">Seleccionar plan y período...</option>
                          {plans
                            .filter((p: any) => p.isActive)
                            .flatMap((p: any) => {
                              const cur = p.currency || 'UF';
                              const options: { value: string; label: string }[] = [];
                              if (p.monthlyPrice > 0) options.push({ value: `${p.code}|monthly`, label: `${p.name} — Mensual (${Number(p.monthlyPrice).toFixed(1)} ${cur}/mes)` });
                              if (p.quarterlyPrice > 0) options.push({ value: `${p.code}|quarterly`, label: `${p.name} — Trimestral (${Number(p.quarterlyPrice).toFixed(1)} ${cur}/trim)` });
                              if (p.semiannualPrice > 0) options.push({ value: `${p.code}|semiannual`, label: `${p.name} — Semestral (${Number(p.semiannualPrice).toFixed(1)} ${cur}/sem)` });
                              if (p.yearlyPrice > 0) options.push({ value: `${p.code}|annual`, label: `${p.name} — Anual (${Number(p.yearlyPrice).toFixed(1)} ${cur}/año)` });
                              if (options.length === 0) options.push({ value: `${p.code}|monthly`, label: `${p.name} — Consultar precio` });
                              return options;
                            })
                            .map((opt) => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))
                          }
                        </select>
                      </div>

                      {/* Comparison: selected plan vs current plan */}
                      {reqTargetPlan && (() => {
                        const [targetCode] = reqTargetPlan.split('|');
                        const targetPlan = plans.find((p: any) => p.code === targetCode);
                        if (!targetPlan) return null;
                        const currentFeatures = new Set(plan.features || []);
                        const targetFeatures = targetPlan.features || [];
                        const newFeatures = targetFeatures.filter((f: string) => !currentFeatures.has(f));
                        const removedFeatures = (plan.features || []).filter((f: string) => !targetFeatures.includes(f));
                        const isUpgrade = targetFeatures.length > (plan.features || []).length;
                        return (
                          <div style={{ padding: '1rem', background: isUpgrade ? 'rgba(16,185,129,0.06)' : 'rgba(245,158,11,0.06)', border: `1px solid ${isUpgrade ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 'var(--radius-sm, 6px)' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem', color: isUpgrade ? 'var(--success)' : 'var(--warning)' }}>
                              {isUpgrade ? '▲ Upgrade' : '▼ Downgrade'}: {plan.name} → {targetPlan.name}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.78rem' }}>
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Max empleados</div>
                                <div>{plan.maxEmployees} → <strong>{targetPlan.maxEmployees}</strong></div>
                              </div>
                              <div>
                                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Informes IA/mes</div>
                                <div>{plan.maxAiCallsPerMonth ?? 0} → <strong>{targetPlan.maxAiCallsPerMonth ?? 0}</strong></div>
                              </div>
                            </div>
                            {newFeatures.length > 0 && (
                              <div style={{ marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.2rem' }}>Funcionalidades que ganas:</div>
                                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                  {newFeatures.map((f: string) => (
                                    <span key={f} style={{ padding: '0.15rem 0.5rem', background: 'rgba(16,185,129,0.1)', borderRadius: '999px', fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600 }}>
                                      + {featureLabels[f] || f}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {removedFeatures.length > 0 && (
                              <div style={{ marginTop: '0.5rem' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '0.2rem' }}>Funcionalidades que pierdes:</div>
                                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                                  {removedFeatures.map((f: string) => (
                                    <span key={f} style={{ padding: '0.15rem 0.5rem', background: 'rgba(239,68,68,0.1)', borderRadius: '999px', fontSize: '0.7rem', color: 'var(--danger)', fontWeight: 600 }}>
                                      - {featureLabels[f] || f}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-secondary)' }}>
                    Notas (opcional)
                  </label>
                  <textarea
                    value={reqNotes}
                    onChange={(e) => setReqNotes(e.target.value)}
                    placeholder="Indica el motivo o cualquier detalle relevante..."
                    className="input"
                    rows={2}
                    style={{ resize: 'vertical', width: '100%' }}
                  />
                </div>

                {reqError && (
                  <div style={{ padding: '0.6rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--danger)' }}>
                    {reqError}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setShowRequestForm(false)}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={reqLoading}>
                    {reqLoading ? 'Enviando...' : 'Enviar solicitud'}
                  </button>
                </div>
              </form>
            )}

            {/* Request history */}
            {myRequests.length > 0 && (
              <div style={{ marginTop: showRequestForm ? '1.5rem' : '0' }}>
                {(showRequestForm || myRequests.length > 0) && <div style={{ height: '1px', background: 'var(--border)', margin: showRequestForm ? '1rem 0' : '0 0 1rem' }} />}
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                  Historial de solicitudes
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {myRequests.slice(0, 5).map((r: any) => (
                    <div key={r.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0.6rem 0.85rem',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.85rem',
                    }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{requestTypeLabel[r.type] || r.type}</span>
                        {r.targetPlan && <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>→ {r.targetPlan}</span>}
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.75rem' }}>
                          {new Date(r.createdAt).toLocaleDateString('es-CL')}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {r.status === 'rejected' && r.rejectionReason && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title={r.rejectionReason}>
                            Motivo: {r.rejectionReason.substring(0, 30)}...
                          </span>
                        )}
                        <span className={`badge ${requestStatusBadge[r.status] || 'badge-ghost'}`} style={{ fontSize: '0.75rem' }}>
                          {requestStatusLabel[r.status] || r.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Período</th>
                      <th style={{ padding: '0.5rem', textAlign: 'right', borderBottom: '2px solid var(--border)' }}>Monto</th>
                      <th style={{ padding: '0.5rem', textAlign: 'center', borderBottom: '2px solid var(--border)' }}>Estado</th>
                      <th style={{ padding: '0.5rem', textAlign: 'left', borderBottom: '2px solid var(--border)' }}>Método</th>
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
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Características incluidas</h2>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {[...plan.features].sort((a: string, b: string) => (featureLabels[a] || a).localeCompare(featureLabels[b] || b, 'es')).map((f: string, i: number) => (
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
            Contacte al administrador del sistema para asignar un plan a su organización.
          </p>
        </div>
      )}
    </div>
  );
}
