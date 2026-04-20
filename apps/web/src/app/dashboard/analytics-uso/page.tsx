'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
// P8-C: import dinámico de Recharts.
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from '@/components/DynamicCharts';

const moduleLabels: Record<string, string> = {
  // Entity types used in audit log
  User: 'Usuarios',
  user: 'Usuarios',
  cycle: 'Ciclos de Evaluación',
  cycle_stage: 'Etapas de Ciclo',
  evaluation: 'Evaluaciones',
  assignment: 'Asignaciones',
  objective: 'Objetivos',
  feedback: 'Feedback',
  checkin: 'Check-ins 1:1',
  development_plan: 'Planes de Desarrollo (PDI)',
  competency: 'Competencias',
  recognition: 'Reconocimientos',
  engagement_survey: 'Encuestas de Clima',
  survey: 'Encuestas de Clima',
  talent_assessment: 'Evaluación de Talento',
  calibration_entry: 'Calibración',
  recruitment_process: 'Procesos de Selección',
  candidate: 'Postulantes',
  signature: 'Firmas Digitales',
  bulk_import: 'Importación Masiva',
  subscription: 'Suscripciones',
  tenant: 'Organización',
  plan: 'Planes',
  contract: 'Contratos',
  report: 'Reportes',
  ai_insight: 'Informes IA',
  notification: 'Notificaciones',
};

const actionLabels: Record<string, string> = {
  // Auth
  login: 'Inicio de sesión',
  'login.failed': 'Intento de acceso fallido',
  'password.changed_first_login': 'Cambio de contraseña (primer ingreso)',
  'password.reset': 'Restablecimiento de contraseña',
  '2fa.enabled': 'Activación de 2FA',
  '2fa.disabled': 'Desactivación de 2FA',
  // Users
  'user.created': 'Creación de usuario',
  'user.updated': 'Actualización de usuario',
  'user.deactivated': 'Desactivación de usuario',
  'user.invited': 'Invitación de usuario',
  'user.invite_resent': 'Reenvío de invitación',
  'user.role_changed': 'Cambio de rol',
  'users.bulk_imported': 'Importación masiva de usuarios',
  // Cycles
  'cycle.created': 'Creación de ciclo',
  'cycle.launched': 'Lanzamiento de ciclo',
  'cycle.closed': 'Cierre de ciclo',
  'cycle.paused': 'Pausa de ciclo',
  'cycle.resumed': 'Reanudación de ciclo',
  'cycle.stage_advanced': 'Avance de etapa',
  // Evaluations
  'evaluation.submitted': 'Evaluación completada',
  'evaluation.response_saved': 'Respuesta de evaluación guardada',
  'evaluation.saved_draft': 'Evaluación guardada (borrador)',
  // Objectives
  'objective.created': 'Creación de objetivo',
  'objective.submitted_for_approval': 'Objetivo enviado a aprobación',
  'objective.approved': 'Objetivo aprobado',
  'objective.rejected': 'Objetivo rechazado',
  'objective.cancelled': 'Objetivo cancelado',
  'objective.progress_updated': 'Actualización de avance',
  // Feedback & Check-ins
  'feedback.sent': 'Feedback enviado',
  'checkin.created': 'Check-in creado',
  'checkin.completed': 'Check-in completado',
  'checkin.rejected': 'Check-in rechazado',
  // Development
  'competency.created': 'Competencia creada',
  'competency.approved': 'Competencia aprobada',
  'competency.rejected': 'Competencia rechazada',
  'pdi.created': 'PDI creado',
  'pdi.status_changed': 'Cambio de estado de PDI',
  // Talent & Calibration
  'talent.assessed': 'Evaluación de talento',
  'calibration.entry_adjusted': 'Ajuste de calibración',
  // Recruitment
  'recruitment.process_created': 'Proceso de selección creado',
  'candidate.hired': 'Postulante contratado',
  'candidate.rejected': 'Postulante rechazado',
  // Signatures
  'document.signed': 'Documento firmado',
  // Surveys
  survey_created: 'Encuesta creada',
  'survey.launched': 'Encuesta lanzada',
  'survey.closed': 'Encuesta cerrada',
  // Subscriptions
  'subscription.created': 'Suscripción creada',
  'subscription.renewed': 'Suscripción renovada',
  'subscription.cancelled': 'Suscripción cancelada',
  'subscription.plan_changed': 'Cambio de plan',
  'subscription.status_changed': 'Cambio de estado de suscripción',
  'plan_change.requested': 'Solicitud de cambio de plan',
  'plan_change.approved': 'Cambio de plan aprobado',
  'plan_change.rejected': 'Cambio de plan rechazado',
  'subscription_request.approved': 'Solicitud de suscripción aprobada',
  'subscription_request.rejected': 'Solicitud de suscripción rechazada',
  'subscription.ai_addon_purchased': 'Add-on IA contratado',
  'subscription.ai_addon_removed': 'Add-on IA removido',
  // Contracts
  'contracts.bulk_created': 'Contratos creados automáticamente',
  'contract.created': 'Contrato creado',
  'contract.updated': 'Contrato actualizado',
  'contract.sent_for_signature': 'Contrato enviado a firma',
  'contract.signed': 'Contrato firmado',
  'contract.deleted': 'Contrato eliminado',
  // AI
  'ai.summary_generated': 'Resumen IA generado',
  'ai.bias_analyzed': 'Análisis de sesgos generado',
  'ai.suggestions_generated': 'Sugerencias IA generadas',
  // Check-in requests
  'checkin.requested': 'Solicitud de reunión',
  'checkin.deleted': 'Check-in eliminado',
  // Tenant
  'tenant.bulk_onboarded': 'Organización creada por plantilla',
  'tenant.settings_updated': 'Configuración actualizada',
  // Other
  'payment.registered': 'Pago registrado',
  'report.viewed': 'Reporte consultado',
  'candidate.stage_changed': 'Etapa de postulante cambiada',
};

const API = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

function SystemUsagePageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!token) return;
    setError(null);
    fetch(`${API}/reports/analytics/system-usage`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => {
      if (!r.ok) throw new Error('Error al cargar los datos');
      return r.json();
    }).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [token]);

  const handleExport = async (format: 'pdf' | 'xlsx') => {
    if (!token) return;
    setExporting(format);
    try {
      const res = await fetch(`${API}/reports/analytics/system-usage/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error al exportar');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `adopcion-uso.${format}`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch { /* ignore */ }
    setExporting(null);
  };

  if (loading) return <PageSkeleton cards={4} tableRows={6} />;
  if (error) return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--danger)' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: '0.5rem' }}>{t('common.errorLoading')}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );
  if (!data) return <div style={{ padding: '2rem 2.5rem' }}><p style={{ color: 'var(--text-muted)' }}>No se pudo cargar el reporte.</p></div>;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('analyticsUso.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('analyticsUso.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => handleExport('pdf')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
            {exporting === 'pdf' ? t('common.exporting') : t('common.exportPdf')}
          </button>
          <button className="btn-ghost" onClick={() => handleExport('xlsx')} disabled={!!exporting} style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }}>
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
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('analyticsUso.guide.title')}</h3>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p><strong>¿Qué muestra?</strong> Métricas de actividad de los últimos 30 días — quién está usando el sistema y con qué frecuencia.</p>
            <p><strong>Indicadores:</strong> MAU (usuarios activos en el mes), WAU (activos en la semana), tasa de adopción (MAU/Total × 100).</p>
            <p><strong>Uso por módulo:</strong> Qué áreas del sistema se usan más (evaluaciones, feedback, objetivos, etc.) con nombres traducidos al español.</p>
            <p><strong>Acciones frecuentes:</strong> Las acciones más realizadas (inicio de sesión, creación de objetivos, feedback enviado, etc.) traducidas a nombres legibles.</p>
            <p><strong>Actividad diaria:</strong> Gráfico con tendencia de acciones y usuarios únicos por día.</p>
            <p><strong>Análisis:</strong> Interpretación automática del nivel de adopción con recomendaciones para mejorar el uso.</p>
            <p><strong>Exportación:</strong> Excel y CSV.</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Solo administradores del sistema.
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsUso.totalUsers')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--text-primary)' }}>{data.totalUsers}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsUso.mau')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{data.mau}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsUso.wau')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{data.wau}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('analyticsUso.adoptionRate')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: data.adoptionRate >= 70 ? 'var(--success)' : data.adoptionRate >= 40 ? 'var(--warning)' : 'var(--danger)' }}>{data.adoptionRate}%</div>
        </div>
      </div>

      {/* Daily activity chart */}
      {data.dailyActivity?.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsUso.dailyActivity')}</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data.dailyActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="actions" stroke="#C9933A" strokeWidth={2} name="Acciones" />
              <Line type="monotone" dataKey="users" stroke="#6366f1" strokeWidth={2} name="Usuarios" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
        {/* Module usage */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsUso.moduleUsage')}</h2>
          {data.moduleUsage?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {data.moduleUsage.slice(0, 10).map((m: any) => (
                <div key={m.module} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.82rem' }}>
                  <span style={{ minWidth: '180px', fontWeight: 500 }}>{moduleLabels[m.module] || m.module}</span>
                  <div style={{ flex: 1, height: '8px', borderRadius: '999px', background: 'var(--border)' }}>
                    <div style={{ height: '100%', width: `${Math.min((m.count / (data.moduleUsage[0]?.count || 1)) * 100, 100)}%`, borderRadius: '999px', background: 'var(--accent)' }} />
                  </div>
                  <span style={{ fontWeight: 600, minWidth: '40px', textAlign: 'right', color: 'var(--text-muted)' }}>{m.count}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos</p>}
        </div>

        {/* Top actions */}
        <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('analyticsUso.topActions')}</h2>
          {data.topActions?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {data.topActions.map((a: any, i: number) => (
                <div key={a.action} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', minWidth: '18px' }}>{i + 1}.</span>
                    <span>{actionLabels[a.action] || a.action}</span>
                  </span>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)' }}>{a.count}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos</p>}
        </div>
      </div>

      {/* Analysis Section */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', marginTop: '1.5rem', borderLeft: `4px solid ${data.adoptionRate >= 70 ? 'var(--success)' : data.adoptionRate >= 40 ? 'var(--warning)' : 'var(--danger)'}` }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: '0.75rem' }}>{t('analyticsUso.analysis')}</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <p>
            <strong>Adopción:</strong> {data.adoptionRate}% de los usuarios iniciaron sesión en los últimos 30 días ({data.mau} de {data.totalUsers}).
            {data.adoptionRate >= 70 ? ' Excelente nivel de adopción del sistema.' :
             data.adoptionRate >= 40 ? ' Nivel moderado. Se recomienda incentivar el uso mediante comunicaciones y capacitaciones.' :
             ' Nivel bajo. Es necesario investigar las barreras de adopción y reforzar la capacitación.'}
          </p>
          <p>
            <strong>Actividad semanal:</strong> {data.wau} usuarios activos esta semana (WAU).
            {data.totalUsers > 0 && ` Esto representa el ${Math.round((data.wau / data.totalUsers) * 100)}% del total.`}
          </p>
          {data.moduleUsage?.[0] && (
            <p>
              <strong>Módulo más usado:</strong> {moduleLabels[data.moduleUsage[0].module] || data.moduleUsage[0].module} con {data.moduleUsage[0].count} acciones.
              {data.moduleUsage.length > 1 && ` Seguido por ${moduleLabels[data.moduleUsage[1].module] || data.moduleUsage[1].module} (${data.moduleUsage[1].count}).`}
            </p>
          )}
          {data.topActions?.[0] && (
            <p>
              <strong>Acción más frecuente:</strong> {actionLabels[data.topActions[0].action] || data.topActions[0].action} ({data.topActions[0].count} veces).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SystemUsagePage() {
  return (
    <PlanGate feature="ANALYTICS_REPORTS">
      <SystemUsagePageContent />
    </PlanGate>
  );
}
