'use client';
import { PlanGate } from '@/components/PlanGate';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Borrador', badge: 'badge-ghost' },
  active: { label: 'Activo', badge: 'badge-success' },
  completed: { label: 'Completado', badge: 'badge-accent' },
  closed: { label: 'Cerrado', badge: 'badge-warning' },
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  external: { label: 'Externo', color: 'var(--accent)' },
  internal: { label: 'Interno', color: '#6366f1' },
};

function PostulantesPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const toast = useToastStore((s) => s.toast);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';

  const [processes, setProcesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showGuide, setShowGuide] = useState(false);

  const loadProcesses = () => {
    if (!token) return;
    setLoading(true);
    api.recruitment.processes.list(token, statusFilter || undefined)
      .then((data) => setProcesses(data || []))
      .catch((e) => toast(e.message || 'Error al cargar procesos', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadProcesses(); }, [token, statusFilter]);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('postulantes.list.title')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('postulantes.list.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? t('common.hideGuide') : t('common.showGuide')}
          </button>
          {isAdmin && (
            <Link href="/dashboard/postulantes/nuevo" style={{ textDecoration: 'none' }}>
              <button className="btn-primary">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('postulantes.list.newProcess')}
              </button>
            </Link>
          )}
        </div>
      </div>

      {/* Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            Guía de Selección de Personal
          </h3>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Tipos de proceso</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Contratación Externa:</strong> Candidatos fuera de la organización. Incluye registro de datos, carga de CV, análisis con IA, entrevistas con evaluadores y tarjeta de puntuación.
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                <strong>Promoción Interna:</strong> Colaboradores de la organización. Se vinculan al empleado existente con historial de evaluaciones, talento y objetivos. Incluye cuadro comparativo con recomendación de IA.
              </div>
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>Flujo del proceso</div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>Crear proceso selecciónando tipo (externo/interno), cargo, requisitos y evaluadores</li>
              <li>Agregar candidatos al proceso</li>
              <li>Cargar CV y generar análisis con IA (consume límite mensual del plan)</li>
              <li>Evaluadores registran entrevistas con cumplimiento de requisitos</li>
              <li>Revisar tarjeta de puntuación consolidada</li>
              <li>Para internos: usar cuadro comparativo con recomendación de IA</li>
            </ol>
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        {[
          { key: '', label: t('postulantes.list.filterAll') },
          { key: 'draft', label: t('postulantes.status.draft') },
          { key: 'active', label: t('postulantes.status.active') },
          { key: 'completed', label: t('postulantes.status.completed') },
          { key: 'closed', label: t('postulantes.status.closed') },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: statusFilter === tab.key ? 700 : 500,
              color: statusFilter === tab.key ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: statusFilter === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Process list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><span className="spinner" /></div>
      ) : processes.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>{t('postulantes.list.noProcesses')}</p>
          {isAdmin && <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>{t('postulantes.list.createFirst')}</p>}
        </div>
      ) : (
        <div className="animate-fade-up-delay-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
          {processes.map((p: any) => {
            const typeInfo = TYPE_LABELS[p.processType] || TYPE_LABELS.external;
            const statusInfo = STATUS_MAP[p.status] || STATUS_MAP.draft;
            return (
              <Link key={p.id} href={`/dashboard/postulantes/${p.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="card" style={{ padding: '1.25rem', cursor: 'pointer', transition: 'box-shadow 0.15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', flex: 1 }}>{p.title}</span>
                    <span className={`badge ${statusInfo.badge}`} style={{ fontSize: '0.65rem' }}>{t(`postulantes.status.${p.status}`)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, color: typeInfo.color }}>{t(`postulantes.type.${p.processType}`)}</span>
                    <span>{p.position}</span>
                    {p.department && <span>{p.department}</span>}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    {p.candidateCount || 0} {t('postulantes.list.candidates')}
                    {p.startDate && ` | Inicio: ${new Date(p.startDate).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}`}
                    {p.endDate && ` | Cierre: ${new Date(p.endDate).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}`}
                  </div>
                  {/* Candidate list */}
                  {p.candidates?.length > 0 && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {p.candidates.slice(0, 5).map((c: any) => {
                        const name = `${c.firstName} ${c.lastName}`.trim();
                        const isInternal = c.candidateType === 'internal';
                        const stageColors: Record<string, string> = {
                          registered: 'var(--text-muted)', cv_review: '#6366f1', interviewing: 'var(--accent)',
                          scored: '#8b5cf6', approved: 'var(--success)', rejected: 'var(--danger)', hired: 'var(--success)',
                        };
                        return (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                              <span style={{ fontWeight: 500 }}>{name || 'Sin nombre'}</span>
                              {isInternal && c.position && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                                  ({c.position}{c.department ? ` - ${c.department}` : ''})
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              {c.finalScore != null && (
                                <span style={{ fontWeight: 700, fontSize: '0.7rem', color: Number(c.finalScore) >= 7 ? 'var(--success)' : Number(c.finalScore) >= 4 ? 'var(--accent)' : 'var(--danger)' }}>
                                  {Number(c.finalScore).toFixed(1)}
                                </span>
                              )}
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: stageColors[c.stage] || 'var(--text-muted)' }} />
                            </div>
                          </div>
                        );
                      })}
                      {p.candidates.length > 5 && (
                        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>+{p.candidates.length - 5} {t('postulantes.list.more')}</span>
                      )}
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

export default function PostulantesPage() {
  return (
    <PlanGate feature="POSTULANTS">
      <PostulantesPageContent />
    </PlanGate>
  );
}
