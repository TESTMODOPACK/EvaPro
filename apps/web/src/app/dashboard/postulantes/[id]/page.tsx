'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import Link from 'next/link';
import { useDepartments } from '@/hooks/useDepartments';
import { AiQuotaBar, useAiQuota } from '@/components/AiQuotaBar';
import { useTranslation } from 'react-i18next';
import { HireCandidateModal } from './HireCandidateModal';

// ─── Internal Candidate Profile (shows Eva360 data) ─────────────────

function InternalCandidateProfile({ userId, user }: { userId: string; user: any }) {
  const token = useAuthStore((s) => s.token);
  const [data, setData] = useState<any>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!token || !userId || !expanded) return;
    if (data) return; // Already loaded
    api.reports.performanceHistory(token, userId).then(setData).catch(() => {});
  }, [token, userId, expanded, data]);

  const history = data?.history || [];
  const latest = history.length > 0 ? history[history.length - 1] : null;
  const position = user?.position || '';
  const department = user?.department || '';
  const hireDate = user?.hireDate;

  return (
    <div style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600, padding: '0.2rem 0', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.15s', display: 'inline-block', fontSize: '0.65rem' }}>▶</span>
        Perfil Eva360
      </button>
      {expanded && (
        <div style={{ marginTop: '0.4rem', padding: '0.65rem 0.85rem', background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
            {position && <span><strong>Cargo:</strong> {position}</span>}
            {department && <span><strong>Departamento:</strong> {department}</span>}
            {hireDate && <span><strong>Ingreso:</strong> {new Date(hireDate).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' })}</span>}
          </div>
          {history.length > 0 ? (
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '0.3rem' }}>Historial de evaluaciones</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                {history.slice(-5).map((h: any, i: number) => {
                  const score = Number(h.avgOverall || 0);
                  const color = score >= 8.5 ? '#10b981' : score >= 7 ? '#6366f1' : score >= 5 ? '#f59e0b' : '#ef4444';
                  return (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.2rem 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{h.cycleName || h.name}</span>
                      <span style={{ fontWeight: 700, color, fontSize: '0.82rem' }}>{score.toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
              {latest && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Último puntaje: <strong style={{ color: Number(latest.avgOverall) >= 7 ? '#10b981' : '#f59e0b' }}>{Number(latest.avgOverall || 0).toFixed(1)}/10</strong>
                </div>
              )}
            </div>
          ) : data ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>Sin evaluaciones previas en el sistema</p>
          ) : (
            <span className="spinner" style={{ width: 16, height: 16 }} />
          )}
        </div>
      )}
    </div>
  );
}

// ─── ProcessStatusPanel — v3.1 máquina de estados + fechas ──────────────
/**
 * Reglas (deben coincidir con backend recruitment.service.ts@assertValidTransition):
 *  - DRAFT → ACTIVE: exige startDate + endDate definidos y endDate >= hoy.
 *  - ACTIVE → COMPLETED / CLOSED: libre.
 *  - ACTIVE → DRAFT: bloqueado.
 *  - COMPLETED / CLOSED → ACTIVE: permitido (reabrir). Si endDate < hoy,
 *    el admin debe extenderla en el mismo popover antes de reabrir.
 *  - COMPLETED ↔ CLOSED: bloqueado (reabrir primero).
 */
function ProcessStatusPanel({
  process,
  candidates,
  token,
  processId,
  onSaved,
}: {
  process: any;
  candidates: any[];
  token: string | null;
  processId: string;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.toast);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [newEndDate, setNewEndDate] = useState<string>('');
  const [saving, setSaving] = useState(false);
  // S1.3 — modal de hire reemplaza el cambio directo de status a completed.
  // Antes "Completar (contratado)" hacia PATCH directo sin capturar quien
  // gano ni datos del hire. Ahora abre modal que ejecuta el endpoint
  // POST /recruitment/processes/:id/hire/:candidateId con cascade real.
  const [hireModalOpen, setHireModalOpen] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const status = process.status as 'draft' | 'active' | 'completed' | 'closed';
  const startDateYmd = process.startDate ? String(process.startDate).slice(0, 10) : null;
  const endDateYmd = process.endDate ? String(process.endDate).slice(0, 10) : null;

  const missingDates = !startDateYmd || !endDateYmd;
  const endVencida = !!(endDateYmd && endDateYmd < today);
  const coherentes = !!(startDateYmd && endDateYmd) && startDateYmd <= endDateYmd;

  // Estado no iniciado aún: ACTIVE pero startDate en el futuro.
  const notYetStarted = status === 'active' && startDateYmd && startDateYmd > today;

  const callUpdate = async (body: Record<string, unknown>, successMsg: string) => {
    if (!token) return;
    setSaving(true);
    try {
      await api.recruitment.processes.update(token, processId, body);
      toast(successMsg, 'success');
      onSaved();
    } catch (e: any) {
      toast(e?.message || 'Error al actualizar el proceso', 'error');
    } finally {
      setSaving(false);
    }
  };

  const activate = () => {
    if (missingDates) {
      toast('Define fecha de inicio y fecha de término antes de activar.', 'error');
      return;
    }
    if (!coherentes) {
      toast('La fecha de inicio no puede ser posterior a la fecha de término.', 'error');
      return;
    }
    if (endVencida) {
      toast('No se puede activar un proceso con la fecha de término vencida.', 'error');
      return;
    }
    callUpdate({ status: 'active' }, 'Proceso activado');
  };

  // S1.3 — `complete` ahora abre modal en lugar de PATCH directo. El modal
  // se encarga de capturar candidato ganador + hire data + invocar el
  // endpoint dedicado que ejecuta la cascada (proceso → COMPLETED, candidato
  // → HIRED, user update/create + user_movement). Mantenemos `close` para
  // cerrar SIN contratar (ningun candidato ganador).
  const openHireModal = () => setHireModalOpen(true);
  const close = () => callUpdate({ status: 'closed' }, 'Proceso cerrado');

  const reopen = () => {
    // Si la fecha actual está vencida o ausente, pedir una nueva.
    if (!endDateYmd || endDateYmd < today) {
      setNewEndDate(today);
      setReopenOpen(true);
      return;
    }
    callUpdate({ status: 'active' }, 'Proceso reabierto');
  };

  const confirmReopen = () => {
    if (!newEndDate || newEndDate < today) {
      toast('La nueva fecha de término debe ser hoy o después.', 'error');
      return;
    }
    callUpdate(
      { status: 'active', endDate: newEndDate },
      'Proceso reabierto',
    ).then(() => setReopenOpen(false));
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.3rem' }}>
        {t('postulantes.detail.config.processStatus')}
      </h3>

      {/* Hints contextuales */}
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.85rem', lineHeight: 1.5 }}>
        <div>
          Estado actual:{' '}
          <strong style={{ color: 'var(--text-primary)' }}>
            {t(`postulantes.status.${status}`)}
          </strong>
          {process.autoClosed && status === 'closed' && (
            <span
              style={{
                marginLeft: '0.5rem',
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.1rem 0.45rem',
                borderRadius: '999px',
                background: 'rgba(245,158,11,0.12)',
                color: '#d97706',
              }}
              title="Se cerró automáticamente porque la fecha de término venció."
            >
              cerrado automáticamente
            </span>
          )}
          {notYetStarted && (
            <span
              style={{
                marginLeft: '0.5rem',
                fontSize: '0.68rem',
                fontWeight: 700,
                padding: '0.1rem 0.45rem',
                borderRadius: '999px',
                background: 'rgba(59,130,246,0.12)',
                color: '#2563eb',
              }}
            >
              inicia el {new Date(startDateYmd!).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}
            </span>
          )}
        </div>
        {status === 'draft' && missingDates && (
          <div style={{ marginTop: '0.3rem', color: '#d97706' }}>
            ⚠ Falta definir fecha de inicio y/o término para poder activar.
          </div>
        )}
        {status === 'draft' && endVencida && (
          <div style={{ marginTop: '0.3rem', color: 'var(--danger)' }}>
            ⚠ La fecha de término ya venció. Actualízala antes de activar.
          </div>
        )}
        {status === 'draft' && startDateYmd && endDateYmd && !coherentes && (
          <div style={{ marginTop: '0.3rem', color: 'var(--danger)' }}>
            ⚠ La fecha de inicio es posterior a la de término. Revísalas.
          </div>
        )}
      </div>

      {/* Acciones según estado */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {status === 'draft' && (
          <button
            className="btn-primary"
            onClick={activate}
            disabled={saving || missingDates || endVencida || !coherentes}
            title={
              missingDates
                ? 'Define fecha de inicio y término'
                : endVencida
                  ? 'La fecha de término ya venció'
                  : !coherentes
                    ? 'La fecha de inicio debe ser anterior o igual a la de término'
                    : 'Activar el proceso'
            }
            style={{ fontSize: '0.85rem' }}
          >
            {saving ? 'Guardando…' : '▶ Activar proceso'}
          </button>
        )}

        {status === 'active' && (
          <>
            <button
              className="btn-primary"
              onClick={openHireModal}
              disabled={saving}
              title="Generar contratación: ejecuta cascada al registro del empleado y cierra el proceso"
              style={{ fontSize: '0.85rem' }}
            >
              ✓ Generar contratación
            </button>
            <button
              className="btn-ghost"
              onClick={close}
              disabled={saving}
              title="Cerrar sin contratación"
              style={{ fontSize: '0.85rem' }}
            >
              ✕ Cerrar sin contratar
            </button>
          </>
        )}

        {(status === 'completed' || status === 'closed') && (
          <button
            className="btn-ghost"
            onClick={reopen}
            disabled={saving}
            title="Reabrir el proceso"
            style={{ fontSize: '0.85rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            ↺ Reabrir proceso
          </button>
        )}
      </div>

      {/* Popover para extender endDate al reabrir */}
      {reopenOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && !saving && setReopenOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem',
          }}
        >
          <div
            className="card animate-fade-up"
            onClick={(e) => e.stopPropagation()}
            style={{ padding: '1.5rem', maxWidth: '420px', width: '100%' }}
          >
            <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, marginBottom: '0.3rem' }}>
              Reabrir proceso
            </h4>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.5 }}>
              La fecha de término del proceso {endDateYmd ? `era el ${new Date(endDateYmd).toLocaleDateString('es-CL')} y ` : ''}
              está vencida. Define una nueva fecha de término para volver a activarlo.
            </p>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Nueva fecha de término
            </label>
            <input
              className="input"
              type="date"
              value={newEndDate}
              min={today}
              onChange={(e) => setNewEndDate(e.target.value)}
              style={{ width: '100%', marginBottom: '1rem' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button
                className="btn-ghost"
                onClick={() => setReopenOpen(false)}
                disabled={saving}
                style={{ fontSize: '0.82rem' }}
              >
                Cancelar
              </button>
              <button
                className="btn-primary"
                onClick={confirmReopen}
                disabled={saving || !newEndDate || newEndDate < today}
                style={{ fontSize: '0.82rem' }}
              >
                {saving ? 'Guardando…' : 'Reabrir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* S1.3 — Modal de hire (cierre real del flow). Solo se renderiza
          cuando el admin lo abre desde "Marcar como contratado…". El modal
          self-cierra y dispara onSaved() para refrescar el proceso a status
          completed con winningCandidateId + hireData persistidos. */}
      {token && (
        <HireCandidateModal
          open={hireModalOpen}
          process={process}
          candidates={candidates}
          token={token}
          onClose={() => setHireModalOpen(false)}
          onSuccess={() => { onSaved(); }}
        />
      )}
    </div>
  );
}

// ─── Scoring Weights Editor (stateful component) ─────────────────────
function ScoringWeightsEditor({ process, isInternal, token, processId, onSaved, readOnly = false }: {
  process: any; isInternal: boolean; token: string | null; processId: string; onSaved: () => void;
  /**
   * S3.x — true cuando el proceso esta completed/closed. Los inputs y el
   * boton "Guardar pesos y recalcular" se deshabilitan. Al reabrir el
   * proceso (volver a ACTIVE), readOnly pasa a false y se re-activa.
   */
  readOnly?: boolean;
}) {
  const toast = useToastStore((s) => s.toast);
  const defaultW = isInternal
    ? { interview: 40, history: 30, requirements: 20, cvMatch: 10 }
    : { interview: 50, requirements: 30, cvMatch: 20 };
  const [weights, setWeights] = useState<Record<string, number>>(
    process.scoringWeights || defaultW,
  );
  const [saving, setSaving] = useState(false);

  const fields = isInternal
    ? [
        { key: 'interview', label: 'Entrevistas', desc: 'Promedio de evaluaciones de entrevista' },
        { key: 'history', label: 'Historial Eval.', desc: 'Puntaje promedio de evaluaciones pasadas' },
        { key: 'requirements', label: 'Requisitos', desc: '% de cumplimiento de requisitos del cargo' },
        { key: 'cvMatch', label: 'Match CV (IA)', desc: '% de ajuste del CV analizado por IA' },
      ]
    : [
        { key: 'interview', label: 'Entrevistas', desc: 'Promedio de evaluaciones de entrevista' },
        { key: 'requirements', label: 'Requisitos', desc: '% de cumplimiento de requisitos del cargo' },
        { key: 'cvMatch', label: 'Match CV (IA)', desc: '% de ajuste del CV analizado por IA' },
      ];

  const total = fields.reduce((s, f) => s + (weights[f.key] || 0), 0);

  const handleSave = async () => {
    if (!token || total !== 100) return;
    setSaving(true);
    try {
      await api.recruitment.processes.update(token, processId, { scoringWeights: weights });
      await api.recruitment.processes.recalculateScores(token);
      onSaved();
      toast('Pesos actualizados y puntajes recalculados', 'success');
    } catch (e: any) {
      toast(e.message || 'Error al guardar pesos', 'error');
    }
    setSaving(false);
  };

  return (
    <div className="card" style={{ padding: '1.5rem' }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Ponderación del Puntaje Final
        {readOnly && (
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginLeft: '0.5rem', padding: '0.15rem 0.5rem', background: 'var(--bg-surface)', borderRadius: '999px' }}>
            Solo lectura
          </span>
        )}
      </h3>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
        {readOnly
          ? 'El proceso está finalizado. Los pesos quedan congelados como referencia histórica de cómo se calcularon los puntajes finales. Si necesita modificarlos, reabra el proceso desde el panel "Estado del Proceso" arriba.'
          : 'Define qué porcentaje aporta cada componente al puntaje final. La suma debe ser 100%. Al guardar, se recalculan automáticamente los puntajes de todos los candidatos.'}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {fields.map((f) => (
          <div key={f.key} style={{ padding: '0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', opacity: readOnly ? 0.7 : 1 }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem' }}>{f.label}</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={weights[f.key] || 0}
                onChange={(e) => setWeights((prev) => ({ ...prev, [f.key]: Number(e.target.value) || 0 }))}
                disabled={readOnly}
                style={{ width: '70px', fontSize: '0.85rem', textAlign: 'center', cursor: readOnly ? 'not-allowed' : undefined }}
              />
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>%</span>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{f.desc}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: total === 100 ? 'var(--success)' : 'var(--danger)' }}>
          Total: {total}% {total !== 100 ? '(debe ser 100%)' : '✓'}
        </span>
        {!readOnly && (
          <button
            className="btn-primary"
            disabled={total !== 100 || saving}
            onClick={handleSave}
            style={{ fontSize: '0.82rem', padding: '0.4rem 1rem', opacity: total !== 100 ? 0.5 : 1 }}
          >
            {saving ? 'Guardando...' : 'Guardar pesos y recalcular'}
          </button>
        )}
      </div>
    </div>
  );
}

const STAGES = [
  // Process statuses
  { key: 'draft', badge: 'badge-ghost' },
  { key: 'active', badge: 'badge-accent' },
  { key: 'closed', badge: 'badge-warning' },
  { key: 'cancelled', badge: 'badge-danger' },
  // Candidate statuses
  { key: 'registered', badge: 'badge-ghost' },
  { key: 'cv_review', badge: 'badge-accent' },
  { key: 'interviewing', badge: 'badge-warning' },
  { key: 'scored', badge: 'badge-info' },
  { key: 'approved', badge: 'badge-success' },
  { key: 'rejected', badge: 'badge-danger' },
  { key: 'hired', badge: 'badge-success' },
  // S3.x — not_hired: candidato que no fue elegido cuando otro gano el
  // proceso. Distinto de rejected (rechazo activo).
  { key: 'not_hired', badge: 'badge-ghost' },
];

function getCategoryLabel(key: string, t: (k: string) => string): string {
  const cleaned = key.replace(/^\[|\]$/g, '').trim();
  const translated = t(`postulantes.reqCategories.${cleaned.toLowerCase()}`);
  return translated !== `postulantes.reqCategories.${cleaned.toLowerCase()}` ? translated : cleaned.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── S5.2 — Banner de CV archivado (compliance Chile 24m) ──────────
   Mostrado solo a tenant_admin cuando el candidato tiene CV archivado
   (proceso cerrado, cv_url null pero cv_archived_at != null). Permite
   solicitar acceso justificando con un texto >=20 chars que se persiste
   en audit_logs. El CV se renderiza inline en iframe sandboxed. */
function ArchivedCvBanner({ candidate, token }: { candidate: any; token: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cvUrl, setCvUrl] = useState<string | null>(null);

  const archivedAt = candidate.cvArchivedAt
    ? new Date(candidate.cvArchivedAt).toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  const handleAccess = async () => {
    if (!token) return;
    if (reason.trim().length < 20) {
      setError('La razon debe tener al menos 20 caracteres.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await api.recruitment.getArchivedCv(token, candidate.id, reason.trim());
      setCvUrl(r.cvUrl);
    } catch (e: any) {
      setError(e?.message || 'No se pudo cargar el CV archivado.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      padding: '1rem',
      background: 'rgba(99,102,241,0.04)',
      border: '1px solid rgba(99,102,241,0.2)',
      borderRadius: 'var(--radius-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1rem' }}>🗄️</span>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>CV archivado</span>
        <span style={{ fontSize: '0.7rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '0.1rem 0.4rem', borderRadius: 8 }}>
          Compliance 24m
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem', lineHeight: 1.5 }}>
        Archivado el {archivedAt}. Por compliance (Ley 19.628 Chile) el CV se conserva 24 meses
        post-cierre del proceso y luego se purga automaticamente. Solo admin puede acceder, justificando
        la razon de acceso (queda registrada en audit log).
      </p>
      {!open && !cvUrl && (
        <button
          className="btn-ghost"
          onClick={() => setOpen(true)}
          style={{ fontSize: '0.78rem' }}
        >
          Ver CV archivado
        </button>
      )}
      {open && !cvUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Razon de acceso (min 20 caracteres) *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: requerimiento legal del candidato segun ley 19.628 art. 12..."
            rows={3}
            className="input"
            style={{ resize: 'vertical', fontSize: '0.82rem' }}
          />
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {reason.trim().length} / 20 caracteres minimos
          </div>
          {error && (
            <div style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button className="btn-ghost" onClick={() => { setOpen(false); setReason(''); setError(null); }} style={{ fontSize: '0.78rem' }}>
              Cancelar
            </button>
            <button
              className="btn-primary"
              onClick={handleAccess}
              disabled={loading || reason.trim().length < 20}
              style={{ fontSize: '0.78rem' }}
            >
              {loading ? 'Cargando…' : 'Solicitar acceso'}
            </button>
          </div>
        </div>
      )}
      {cvUrl && (
        <div style={{ marginTop: '0.5rem' }}>
          <iframe
            src={cvUrl}
            sandbox=""
            style={{ width: '100%', height: 600, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
            title="CV archivado"
          />
          <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Este acceso quedo registrado en audit_logs (recruitment.archived_cv_accessed).
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Admin read-only evaluation view ──────────────────────────────── */
function AdminEvaluationView({ candidate, token, onViewScorecard, t }: { candidate: any; token: string | null; onViewScorecard: () => void; t: (key: string, opts?: any) => string }) {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !candidate?.id) return;
    setLoading(true);
    api.recruitment.candidates.getInterviews(token, candidate.id)
      .then((data: any) => setInterviews(Array.isArray(data) ? data : []))
      .catch(() => setInterviews([]))
      .finally(() => setLoading(false));
  }, [token, candidate?.id]);

  const candidateName = candidate.firstName || candidate.user?.firstName || '';
  const candidateLastName = candidate.lastName || candidate.user?.lastName || '';

  return (
    <div>
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
        {t('postulantes.detail.adminEval.evalsTitle')}: {candidateName} {candidateLastName}
      </h2>

      {loading ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{t('postulantes.detail.adminEval.loading')}</div>
      ) : interviews.length === 0 ? (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          {t('postulantes.detail.adminEval.noEvals')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {interviews.map((iv: any) => {
            const checks = iv.requirementChecks || [];
            const answered = checks.filter((c: any) => c.status !== 'pendiente');
            const cumple = checks.filter((c: any) => c.status === 'cumple').length;
            const parcial = checks.filter((c: any) => c.status === 'parcial').length;
            const noCumple = checks.filter((c: any) => c.status === 'no_cumple').length;
            return (
              <div key={iv.id} className="card" style={{ padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <div>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                      {iv.evaluator?.firstName} {iv.evaluator?.lastName}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      {iv.evaluator?.position || ''}
                    </span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.3rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                    <span style={{ fontWeight: 800, fontSize: '1.2rem', color: Number(iv.globalScore) >= 7 ? 'var(--success)' : Number(iv.globalScore) >= 4 ? 'var(--accent)' : 'var(--danger)' }}>
                      {iv.globalScore != null ? Number(iv.globalScore).toFixed(1) : '--'}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>/10</span>
                  </div>
                </div>

                {/* Requirement summary */}
                {answered.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.5rem', fontSize: '0.78rem' }}>
                    {cumple > 0 && <span style={{ color: 'var(--success)', fontWeight: 600 }}>{t('postulantes.detail.adminEval.meets')}: {cumple}</span>}
                    {parcial > 0 && <span style={{ color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>{t('postulantes.detail.adminEval.partial')}: {parcial}</span>}
                    {noCumple > 0 && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('postulantes.detail.adminEval.notMeet')}: {noCumple}</span>}
                    <span style={{ color: 'var(--text-muted)' }}>({answered.length}/{checks.length} {t('postulantes.detail.adminEval.evaluated')})</span>
                  </div>
                )}

                {/* Requirement details */}
                {checks.length > 0 && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          <th style={{ textAlign: 'left', padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('postulantes.detail.eval.requirement')}</th>
                          <th style={{ width: 110, padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('postulantes.detail.eval.state')}</th>
                          <th style={{ padding: '0.3rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('postulantes.detail.eval.comment')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {checks.map((rc: any, i: number) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '0.35rem 0.5rem' }}>
                              <span style={{ fontSize: '0.68rem', color: 'var(--accent)', fontWeight: 600 }}>{getCategoryLabel(rc.category, t)}</span>
                              <br />{rc.text}
                            </td>
                            <td style={{
                              padding: '0.35rem 0.5rem', fontWeight: 600, fontSize: '0.78rem',
                              color: rc.status === 'cumple' ? 'var(--success)' : rc.status === 'no_cumple' ? 'var(--danger)' : rc.status === 'parcial' ? 'var(--warning, #f59e0b)' : 'var(--text-muted)',
                            }}>
                              {rc.status === 'cumple' ? t('postulantes.detail.eval.meets') : rc.status === 'parcial' ? t('postulantes.detail.adminEval.partial') : rc.status === 'no_cumple' ? t('postulantes.detail.eval.notMeet') : t('postulantes.detail.eval.pending')}
                            </td>
                            <td style={{ padding: '0.35rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>{rc.comment || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {iv.comments && (
                  <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('postulantes.detail.adminEval.comments')}</strong> {iv.comments}
                  </div>
                )}

                {iv.createdAt && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                    {t('postulantes.detail.adminEval.evaluatedOn')} {new Date(iv.createdAt).toLocaleDateString('es-CL')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={onViewScorecard}>
          {t('postulantes.detail.adminEval.viewFullScorecard')}
        </button>
      </div>
    </div>
  );
}

export default function ProcesoDetailPage({ params }: { params: { id: string } }) {
  const token = useAuthStore((s) => s.token);
  const userId = useAuthStore((s) => s.user?.userId);
  const role = useAuthStore((s) => s.user?.role);
  const toast = useToastStore((s) => s.toast);
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const { isBlocked: aiBlocked } = useAiQuota();
  const { t } = useTranslation();

  const stageLabel = (key: string) => t(`postulantes.stages.${key}`) || key;
  const categoryLabel = (key: string) => getCategoryLabel(key, t);

  const [process, setProcess] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('candidatos');

  // Candidate forms
  const [showAddForm, setShowAddForm] = useState(false);
  const [addingCandidate, setAddingCandidate] = useState(false);
  const [extForm, setExtForm] = useState({ firstName: '', lastName: '', email: '', phone: '', linkedIn: '', availability: '', salaryExpectation: '' });
  const [extErrors, setExtErrors] = useState<Record<string, string>>({});
  const [internalSearch, setInternalSearch] = useState('');
  const [internalUsers, setInternalUsers] = useState<any[]>([]);
  const [internalDeptFilter, setInternalDeptFilter] = useState('');
  const [internalPosFilter, setInternalPosFilter] = useState('');
  const { departments } = useDepartments();

  // Interview
  const [selectedCandidate, setSelectedCandidate] = useState<any>(null);
  const [interviewForm, setInterviewForm] = useState<{ reqChecks: any[]; comments: string; globalScore: string; manualScore: string }>({ reqChecks: [], comments: '', globalScore: '', manualScore: '' });
  const [savingInterview, setSavingInterview] = useState(false);

  // Scorecard
  const [scorecard, setScorecard] = useState<any>(null);

  // Comparative
  const [comparative, setComparative] = useState<any>(null);

  // CV
  const [uploadingCv, setUploadingCv] = useState(false);
  const [analyzingCvId, setAnalyzingCvId] = useState<string | null>(null);
  const [expandedCvPanel, setExpandedCvPanel] = useState<string | null>(null);

  // Track which candidates the current evaluator has already evaluated
  const [evaluatedCandidateIds, setEvaluatedCandidateIds] = useState<Set<string>>(new Set());

  // Edit candidate
  const [editingCandidate, setEditingCandidate] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ email: '', phone: '', linkedIn: '', availability: '', salaryExpectation: '', recruiterNotes: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchProcess = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await api.recruitment.processes.get(token, params.id);
      setProcess(data);
    } catch (e) {
      setProcess(null);
    }
    setLoading(false);
  };

  useEffect(() => { fetchProcess(); }, [token, params.id]);

  // Load which candidates the current evaluator has already evaluated
  useEffect(() => {
    if (!token || !process?.candidates?.length || !userId) return;
    const evs = process.evaluators || [];
    if (!evs.some((ev: any) => ev.evaluatorId === userId)) return;
    const load = async () => {
      const ids = new Set<string>();
      for (const c of process.candidates) {
        try {
          const ivs = await api.recruitment.candidates.getInterviews(token, c.id);
          if ((ivs || []).some((i: any) => i.evaluatorId === userId)) ids.add(c.id);
        } catch { /* ignore */ }
      }
      setEvaluatedCandidateIds(ids);
    };
    load();
  }, [token, process?.id, userId]); // eslint-disable-line

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}><span className="spinner" /></div>;
  if (!process) return <div style={{ padding: '2rem 2.5rem', color: 'var(--text-muted)' }}>{t('postulantes.detail.notFound') || 'Proceso no encontrado'}</div>;

  const candidates = process.candidates || [];
  const evaluators = process.evaluators || [];
  const requirements = process.requirements || [];
  const isInternal = process.processType === 'internal';
  const isEvaluatorOfProcess = evaluators.some((ev: any) => ev.evaluatorId === userId);
  const canManageCv = isAdmin || isEvaluatorOfProcess;

  // ─── Validation helpers ─────────────────────────────────────────────
  const validateExtForm = () => {
    const errors: Record<string, string> = {};
    if (!extForm.firstName.trim() || extForm.firstName.trim().length < 2) errors.firstName = t('postulantes.detail.validation.firstNameReq');
    if (extForm.firstName.trim() && !/^[a-zA-ZaeiouAEIOUnoN\s]+$/.test(extForm.firstName.trim())) errors.firstName = t('postulantes.detail.validation.firstNameAlpha');
    if (!extForm.lastName.trim() || extForm.lastName.trim().length < 2) errors.lastName = t('postulantes.detail.validation.lastNameReq');
    if (!extForm.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(extForm.email)) errors.email = t('postulantes.detail.validation.emailReq');
    if (!extForm.phone.trim()) errors.phone = t('postulantes.detail.validation.phoneReq');
    else if (!/^\+?[\d\s()-]{7,20}$/.test(extForm.phone.trim())) errors.phone = t('postulantes.detail.validation.phoneInvalid');
    setExtErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ─── Add external candidate ─────────────────────────────────────────
  const handleAddExternal = async () => {
    if (!token || !validateExtForm()) return;
    setAddingCandidate(true);
    try {
      await api.recruitment.candidates.add(token, params.id, extForm);
      setExtForm({ firstName: '', lastName: '', email: '', phone: '', linkedIn: '', availability: '', salaryExpectation: '' });
      setShowAddForm(false);
      toast(t('postulantes.detail.candidateAdded'), 'success');
      fetchProcess();
    } catch (e: any) {
      toast(e.message || t('postulantes.detail.candidateAddError'), 'error');
    }
    setAddingCandidate(false);
  };

  // ─── Add internal candidate ─────────────────────────────────────────
  const handleSearchInternal = async () => {
    if (!token) return;
    if (!internalSearch.trim() && !internalDeptFilter && !internalPosFilter) return;
    try {
      const filters: any = {};
      if (internalSearch.trim()) filters.search = internalSearch;
      if (internalDeptFilter) filters.department = internalDeptFilter;
      if (internalPosFilter) filters.position = internalPosFilter;
      const res = await api.users.list(token, 1, 50, filters);
      setInternalUsers((res as any).data || res || []);
    } catch (e) {
      setInternalUsers([]);
    }
  };

  const handleAddInternal = async (uId: string) => {
    if (!token) return;
    setAddingCandidate(true);
    try {
      await api.recruitment.candidates.add(token, params.id, { userId: uId });
      toast(t('postulantes.detail.collabAdded'), 'success');
      setShowAddForm(false);
      fetchProcess();
    } catch (e: any) {
      toast(e.message || t('postulantes.detail.collabAddError'), 'error');
    }
    setAddingCandidate(false);
  };

  // ─── CV Upload (base64 directo a BD, sin Cloudinary) ─────────────────
  const handleCvUpload = async (candidateId: string, e: any) => {
    const file = e.target.files?.[0];
    if (!file || !token) return;

    if (file.type !== 'application/pdf') {
      toast(t('postulantes.detail.cv.pdfOnly'), 'error');
      e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast(t('postulantes.detail.cv.maxSize'), 'error');
      e.target.value = '';
      return;
    }

    setUploadingCv(true);
    try {
      // Convert to base64 data URL
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Error al leer el archivo'));
        reader.readAsDataURL(file);
      });

      // Save base64 directly as cvUrl
      await api.recruitment.candidates.uploadCv(token, candidateId, base64);
      toast(t('postulantes.detail.cv.uploadSuccess'), 'success');
      fetchProcess();
    } catch (err: any) {
      toast(err.message || t('postulantes.detail.cv.uploadError'), 'error');
    } finally {
      e.target.value = '';
      setUploadingCv(false);
    }
  };

  // ─── AI CV Analysis ─────────────────────────────────────────────────
  const handleAnalyzeCv = async (candidateId: string) => {
    if (!token || analyzingCvId) return;
    setAnalyzingCvId(candidateId);
    try {
      await api.recruitment.candidates.analyzeCv(token, candidateId);
      toast(t('postulantes.detail.cv.analysisComplete'), 'success');
      fetchProcess();
    } catch (err: any) {
      toast(err.message || t('postulantes.detail.cv.analysisError'), 'error');
    }
    setAnalyzingCvId(null);
  };

  // ─── Interview ──────────────────────────────────────────────────────
  const openInterview = (candidate: any) => {
    setSelectedCandidate(candidate);
    const reqChecks = requirements.map((r: any) => ({
      category: r.category, text: r.text, status: 'pendiente', comment: '',
      weight: r.weight || undefined,
    }));
    setInterviewForm({ reqChecks, comments: '', globalScore: '', manualScore: '' });
    // Load existing interview
    if (token) {
      api.recruitment.candidates.getInterviews(token, candidate.id).then((interviews) => {
        const mine = (interviews || []).find((i: any) => i.evaluatorId === userId);
        if (mine) {
          // Merge weights from process requirements into saved checks
          const mergedChecks = mine.requirementChecks?.length > 0
            ? mine.requirementChecks.map((check: any) => {
                const procReq = requirements.find((r: any) => r.category === check.category && r.text === check.text);
                return { ...check, weight: check.weight != null ? check.weight : procReq?.weight };
              })
            : reqChecks;
          setInterviewForm({
            reqChecks: mergedChecks,
            comments: mine.comments || '',
            globalScore: mine.globalScore != null ? String(mine.globalScore) : '',
            manualScore: mine.manualScore != null ? String(mine.manualScore) : '',
          });
        }
      }).catch(() => {});
    }
    setTab('evaluacion');
  };

  const handleSaveInterview = async () => {
    if (!token || !selectedCandidate) return;
    setSavingInterview(true);
    try {
      await api.recruitment.candidates.submitInterview(token, selectedCandidate.id, {
        requirementChecks: interviewForm.reqChecks,
        comments: interviewForm.comments,
        globalScore: interviewForm.globalScore ? Number(interviewForm.globalScore) : null,
        manualScore: interviewForm.manualScore ? Number(interviewForm.manualScore) : null,
      });
      toast(t('postulantes.detail.eval.evalSaved') || 'Evaluación guardada', 'success');
      // Mark this candidate as evaluated by current user
      setEvaluatedCandidateIds((prev) => new Set(prev).add(selectedCandidate.id));
      fetchProcess();
    } catch (e: any) {
      toast(e.message || t('postulantes.detail.eval.saveError') || 'Error al guardar evaluación', 'error');
    }
    setSavingInterview(false);
  };

  // ─── Scorecard ──────────────────────────────────────────────────────
  const loadScorecard = async (candidateId: string) => {
    if (!token) return;
    try {
      const data = await api.recruitment.candidates.scorecard(token, candidateId);
      setScorecard(data);
      setTab('scorecard');
    } catch (e: any) {
      toast(e.message || t('postulantes.detail.scorecard.loadError') || 'Error al cargar puntuación', 'error');
    }
  };

  // ─── Comparative ────────────────────────────────────────────────────
  const loadComparative = async () => {
    if (!token) return;
    try {
      const data = await api.recruitment.processes.comparative(token, params.id);
      setComparative(data);
      setTab('comparativa');
    } catch (e: any) {
      toast(e.message || t('postulantes.detail.comparative.loadError') || 'Error al cargar comparativa', 'error');
    }
  };

  // ─── Tabs config ────────────────────────────────────────────────────
  const tabs = [
    { key: 'candidatos', label: t('postulantes.detail.tabs.candidates') },
    { key: 'evaluacion', label: t('postulantes.detail.tabs.evaluation') },
    { key: 'scorecard', label: t('postulantes.detail.tabs.scorecard') },
    ...(isInternal ? [{ key: 'comparativa', label: t('postulantes.detail.tabs.comparative') }] : []),
    { key: 'configuracion', label: t('postulantes.detail.tabs.config') },
  ];

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* AI Quota */}
      <AiQuotaBar />
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <Link href="/dashboard/postulantes" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'none' }}>&#8592; {t('postulantes.detail.backToList')}</Link>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{process.title}</h1>
          <span className={`badge ${STAGES.find((s) => s.key === process.status)?.badge || 'badge-ghost'}`} style={{ fontSize: '0.65rem' }}>
            {stageLabel(process.status)}
          </span>
          <span style={{ fontSize: '0.65rem', padding: '0.15rem 0.5rem', borderRadius: 10, fontWeight: 700,
            background: isInternal ? 'rgba(99,102,241,0.1)' : 'rgba(201,147,58,0.1)',
            color: isInternal ? '#6366f1' : 'var(--accent)',
          }}>{isInternal ? t('postulantes.type.internal') : t('postulantes.type.external')}</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {process.position}{process.department ? ' — ' + process.department : ''} | {evaluators.length} {t('postulantes.detail.evaluators')} | {candidates.length} {t('postulantes.detail.tabs.candidates').toLowerCase()}
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {tabs.map((tb) => (
          <button key={tb.key} onClick={() => { if (tb.key === 'comparativa') loadComparative(); else setTab(tb.key); }}
            style={{
              padding: '0.5rem 1rem', fontSize: '0.82rem',
              fontWeight: tab === tb.key ? 700 : 500,
              color: tab === tb.key ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none', border: 'none',
              borderBottom: tab === tb.key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer', marginBottom: '-1px',
            }}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: Candidatos ───────────────────────────────────────── */}
      {tab === 'candidatos' && (
        <div>
          {/* BUG FIX: agregar candidato solo permitido cuando proceso esta
              en DRAFT o ACTIVE. Antes el boton + form salian siempre que
              fuera admin, incluso en procesos COMPLETED/CLOSED — lo que
              permitia ensuciar procesos cerrados con candidatos nuevos. */}
          {isAdmin && (process.status === 'draft' || process.status === 'active') && (
            <button className="btn-primary" style={{ marginBottom: '1rem', fontSize: '0.85rem' }} onClick={() => setShowAddForm(!showAddForm)}>
              {t('postulantes.detail.addCandidate')}
            </button>
          )}

          {/* Banner read-only para procesos cerrados — explica por que no
              se pueden agregar candidatos y como reabrir si fuera necesario. */}
          {(process.status === 'completed' || process.status === 'closed') && (
            <div style={{
              padding: '0.85rem 1rem',
              marginBottom: '1rem',
              background: 'rgba(148,163,184,0.1)',
              border: '1px solid rgba(148,163,184,0.3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              <strong>Proceso {process.status === 'completed' ? 'completado' : 'cerrado'}.</strong> Los candidatos de un
              proceso finalizado son de solo lectura. Si necesita agregar uno, reabra el proceso en la pestaña <em>Configuración</em>.
            </div>
          )}

          {/* Add candidate form — gated igual que el boton */}
          {showAddForm && isAdmin && (process.status === 'draft' || process.status === 'active') && (
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
              {!isInternal ? (
                <>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('postulantes.detail.newExternal')}</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <input className="input" placeholder={`${t('postulantes.detail.form.firstName')} *`} value={extForm.firstName}
                        onChange={(e) => setExtForm((f) => ({ ...f, firstName: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.firstName && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.firstName}</div>}
                    </div>
                    <div>
                      <input className="input" placeholder={`${t('postulantes.detail.form.lastName')} *`} value={extForm.lastName}
                        onChange={(e) => setExtForm((f) => ({ ...f, lastName: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.lastName && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.lastName}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div>
                      <input className="input" type="email" placeholder={`${t('postulantes.detail.form.email')} *`} value={extForm.email}
                        onChange={(e) => setExtForm((f) => ({ ...f, email: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.email && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.email}</div>}
                    </div>
                    <div>
                      <input className="input" placeholder={`${t('postulantes.detail.form.phone')} *`} value={extForm.phone}
                        onChange={(e) => setExtForm((f) => ({ ...f, phone: e.target.value }))}
                        onBlur={validateExtForm} />
                      {extErrors.phone && <div style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.2rem' }}>{extErrors.phone}</div>}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <input className="input" placeholder={t('postulantes.detail.form.linkedin')} value={extForm.linkedIn}
                      onChange={(e) => setExtForm((f) => ({ ...f, linkedIn: e.target.value }))} />
                    <select className="input" value={extForm.availability} onChange={(e) => setExtForm((f) => ({ ...f, availability: e.target.value }))}>
                      <option value="">{t('postulantes.detail.form.availabilityLabel')}</option>
                      <option value="Inmediata">{t('postulantes.detail.form.availImmediate')}</option>
                      <option value="15 dias">{t('postulantes.detail.form.avail15')}</option>
                      <option value="30 dias">{t('postulantes.detail.form.avail30')}</option>
                      <option value="60 dias">{t('postulantes.detail.form.avail60')}</option>
                      <option value="90 dias">{t('postulantes.detail.form.avail90')}</option>
                      <option value="A convenir">{t('postulantes.detail.form.availNegotiable')}</option>
                    </select>
                    <input className="input" placeholder={t('postulantes.detail.form.salaryLabel')} value={extForm.salaryExpectation}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '');
                        const formatted = raw ? Number(raw).toLocaleString('es-CL') : '';
                        setExtForm((f) => ({ ...f, salaryExpectation: formatted }));
                      }} />
                  </div>
                  <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleAddExternal} disabled={addingCandidate}>
                    {addingCandidate ? t('postulantes.detail.adding') : t('postulantes.detail.addCandidate')}
                  </button>
                </>
              ) : (
                <>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>{t('postulantes.detail.searchCollab')}</h3>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input className="input" style={{ flex: 1 }} placeholder={t('postulantes.detail.searchPlaceholder')}
                      value={internalSearch} onChange={(e) => setInternalSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSearchInternal(); }} />
                    <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={handleSearchInternal}>{t('postulantes.detail.search')}</button>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                    <select className="input" style={{ flex: 1, minWidth: '160px', fontSize: '0.82rem' }}
                      value={internalDeptFilter} onChange={(e) => setInternalDeptFilter(e.target.value)}>
                      <option value="">{t('postulantes.detail.allDepartments')}</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input className="input" style={{ flex: 1, minWidth: '140px', fontSize: '0.82rem' }}
                      placeholder={t('postulantes.detail.filterPosition')}
                      value={internalPosFilter} onChange={(e) => setInternalPosFilter(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSearchInternal(); }} />
                  </div>
                  {internalUsers.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {internalUsers.map((u: any) => (
                        <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                          <div>
                            <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{u.firstName} {u.lastName}</span>
                            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{u.position} — {u.department}</span>
                          </div>
                          <button className="btn-primary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            onClick={() => handleAddInternal(u.id)} disabled={addingCandidate}>
                            {t('postulantes.detail.add')}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Candidates list */}
          {candidates.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{t('postulantes.detail.noCandidates') || 'No hay candidatos en este proceso'}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {/* S3.x — cuando el proceso esta completed/closed, los
                  candidatos son SOLO LECTURA (banner ya lo dice). Aqui
                  derivamos el flag para deshabilitar / ocultar las
                  acciones mutadoras (subir CV, re-analizar, editar,
                  cambiar stage). Si el admin necesita editar, debe
                  reabrir el proceso desde Configuracion. */}
              {(() => null)()}
              {candidates.map((c: any) => {
                const isReadOnly = process.status === 'completed' || process.status === 'closed';
                const stageInfo = STAGES.find((s) => s.key === c.stage) || STAGES[0];
                const name = c.candidateType === 'internal' && c.user
                  ? c.user.firstName + ' ' + c.user.lastName
                  : (c.firstName || '') + ' ' + (c.lastName || '');
                // For internal candidates: use profile CV if no process-specific CV exists
                const effectiveCvUrl = c.cvUrl || (c.candidateType === 'internal' && c.user?.cvUrl ? c.user.cvUrl : null);
                const cvFromProfile = !c.cvUrl && c.candidateType === 'internal' && c.user?.cvUrl;
                const cvStatus = c.cvAnalysis ? 'analyzed' : effectiveCvUrl ? 'uploaded' : 'none';
                let matchPct: number | null = null;
                if (c.cvAnalysis) {
                  const analysis = typeof c.cvAnalysis === 'string' ? (() => { try { return JSON.parse(c.cvAnalysis); } catch (_e) { return null; } })() : c.cvAnalysis;
                  matchPct = analysis?.matchPercentage ?? null;
                }
                const hasFinalScore = c.finalScore != null && Number(c.finalScore) > 0;
                const showCv = c.candidateType === 'external' || process.requireCvForInternal;

                return (
                  <div key={c.id} className="card" style={{ padding: '1.25rem' }}>
                    {/* Header: Name + badges + score */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{name}</span>
                          {c.candidateType === 'internal' && (
                            <span style={{ fontSize: '0.68rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '0.15rem 0.5rem', borderRadius: 10, fontWeight: 700 }}>{t('postulantes.detail.internal')}</span>
                          )}
                          <span className={stageInfo.badge} style={{ fontSize: '0.68rem' }}>{stageLabel(stageInfo.key)}</span>
                          {cvStatus === 'analyzed' && matchPct != null && (
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 10,
                              background: matchPct >= 70 ? 'rgba(16,185,129,0.1)' : matchPct >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                              color: matchPct >= 70 ? 'var(--success)' : matchPct >= 40 ? 'var(--warning)' : 'var(--danger)',
                            }}>CV {matchPct}%</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                          {c.email && <span>{c.email}</span>}
                          {c.phone && <span>{c.phone}</span>}
                          {c.availability && <span>{t('postulantes.detail.availability')}: {c.availability}</span>}
                          {c.salaryExpectation && <span>{t('postulantes.detail.salary')}: ${(() => { const raw = String(c.salaryExpectation).replace(/\D/g, ''); return raw ? Number(raw).toLocaleString('es-CL') : c.salaryExpectation; })()}</span>}
                        </div>
                      </div>
                      {hasFinalScore && (
                        <div style={{ textAlign: 'center', minWidth: 55, padding: '0.3rem 0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', marginLeft: '0.75rem' }}>
                          <div style={{ fontWeight: 800, fontSize: '1.3rem', lineHeight: 1, color: Number(c.finalScore) >= 7 ? 'var(--success)' : Number(c.finalScore) >= 4 ? 'var(--accent)' : 'var(--danger)' }}>
                            {Number(c.finalScore).toFixed(1)}
                          </div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>{t('postulantes.detail.outOf10')}</div>
                        </div>
                      )}
                    </div>

                    {/* Internal candidate: Eva360 profile summary */}
                    {c.candidateType === 'internal' && c.user && (
                      <InternalCandidateProfile userId={c.user.id || c.userId} user={c.user} />
                    )}

                    {/* Actions row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                        {isEvaluatorOfProcess ? (
                          <button className={evaluatedCandidateIds.has(c.id) ? 'btn-ghost' : 'btn-primary'} style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                            onClick={() => openInterview(c)}>
                            {evaluatedCandidateIds.has(c.id) ? 'Actualizar evaluación' : t('postulantes.detail.eval.evaluate')}
                          </button>
                        ) : isAdmin && (
                          <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem', borderColor: 'var(--accent)', color: 'var(--accent)' }}
                            onClick={() => { setSelectedCandidate(c); setTab('evaluacion'); }}>{t('postulantes.detail.eval.viewEvals')}</button>
                        )}
                        <button className="btn-ghost" style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                          onClick={() => loadScorecard(c.id)}>{t('postulantes.detail.scorecard.viewScorecard')}</button>
                        {showCv && (
                          // En procesos closed/completed: solo permitir VER el CV existente, no subir/cambiar.
                          // Si no hay CV (cvStatus='none') y el proceso es readonly, ocultar el boton entero.
                          (!isReadOnly || cvStatus !== 'none') && (
                            <button className="btn-ghost" onClick={() => { setExpandedCvPanel(expandedCvPanel === c.id ? null : c.id); setEditingCandidate(null); }}
                              style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
                              title={isReadOnly ? 'Solo lectura — proceso finalizado' : undefined}
                            >
                              {expandedCvPanel === c.id
                                ? t('postulantes.detail.cv.closeCv')
                                : (isReadOnly ? t('postulantes.detail.cv.viewCv') : (cvStatus === 'none' ? t('postulantes.detail.cv.uploadCv') : t('postulantes.detail.cv.viewCv')))}
                            </button>
                          )
                        )}
                        {isAdmin && !isReadOnly && (
                          <button className="btn-ghost" onClick={() => {
                            if (editingCandidate === c.id) { setEditingCandidate(null); } else {
                              setEditingCandidate(c.id); setExpandedCvPanel(null);
                              setEditForm({
                                email: c.email || '', phone: c.phone || '', linkedIn: c.linkedIn || '',
                                availability: c.availability || '', salaryExpectation: c.salaryExpectation || '',
                                recruiterNotes: c.recruiterNotes || '',
                              });
                            }
                          }} style={{ fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}>
                            {editingCandidate === c.id ? t('postulantes.detail.edit.close') : t('postulantes.detail.edit.editBtn')}
                          </button>
                        )}
                      </div>

                      {/* Stage selector (only for final decisions).
                          IMPORTANTE: 'hired' YA NO se puede seleccionar
                          desde aqui — pasar a hired ejecuta cascada
                          (User update + user_movement + audit) que solo
                          puede dispararse desde el modal "Marcar como
                          contratado" del panel de Configuracion. Si el
                          candidato ya esta hired (legacy o flow corregido),
                          el dropdown sigue mostrando el valor pero NO
                          permite reseleccionarlo. Si el admin selecciona
                          otro stage estando en hired, esta "revirtiendo"
                          el hire — caso valido para datos inconsistentes
                          previos al fix. */}
                      {isAdmin && (c.stage === 'scored' || c.stage === 'approved' || c.stage === 'rejected' || c.stage === 'hired' || c.stage === 'not_hired') && (
                        // S3.x — Caso especial: candidato HIRED. El boton
                        // "Revertir contratación" SIEMPRE visible (sin
                        // importar si proceso esta active/completed/closed)
                        // porque el rollback que dispara incluye reabrir el
                        // proceso si esta cerrado. Es la unica via UX para
                        // deshacer un hire con cascada al empleado.
                        c.stage === 'hired' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <span
                              className="badge badge-success"
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                            >
                              {stageLabel('hired')}
                            </span>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem', borderColor: '#ef4444', color: '#ef4444' }}
                              onClick={() => {
                                const isInternal = c.candidateType === 'internal';
                                const userName = isInternal && c.user
                                  ? `${c.user.firstName} ${c.user.lastName}`
                                  : `${c.firstName || ''} ${c.lastName || ''}`.trim();
                                const lines = [
                                  `¿Confirma revertir la contratación de ${userName}?`,
                                  '',
                                  'Esto ejecutará el rollback completo:',
                                  '  • Candidato volverá a estado "Aprobado"',
                                  '  • Proceso volverá a "Activo" (si estaba completado)',
                                  '  • Se limpiará el ganador y los datos del hire',
                                  '  • Los demás candidatos en "No contratado" volverán a "Aprobado"',
                                ];
                                if (isInternal) {
                                  lines.push(
                                    '',
                                    '⚠ Cascada al empleado (interno):',
                                    `  • Departamento, cargo y jefatura de ${userName} se restauran a sus valores ANTERIORES al hire`,
                                    '  • Se eliminará el registro en historial de movimientos creado por este hire',
                                  );
                                }
                                lines.push(
                                  '',
                                  'Esta acción no se puede deshacer fácilmente. Continuar?',
                                );
                                if (!window.confirm(lines.join('\n'))) return;
                                if (!token) return;
                                api.recruitment.revertHire(token, c.id)
                                  .then(() => {
                                    toast('Contratación revertida correctamente', 'success');
                                    fetchProcess();
                                  })
                                  .catch((err: any) => {
                                    toast(err?.message || 'Error al revertir contratación', 'error');
                                  });
                              }}
                              title="Revertir contratación: deshace el hire y restaura el estado previo (incluye reabrir el proceso si estaba cerrado)"
                            >
                              ↺ Revertir contratación
                            </button>
                            {/* S5.1 — Reenviar email de bienvenida (solo externos hired). */}
                            {c.candidateType === 'external' && c.email && (
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                                onClick={() => {
                                  if (!token) return;
                                  const ok = window.confirm(
                                    `Reenviar email de bienvenida a ${c.email}?\n\n` +
                                    'Esto rota la contraseña del empleado: el password actual queda invalidado y se envía uno nuevo en el email.',
                                  );
                                  if (!ok) return;
                                  api.recruitment.resendWelcomeEmail(token, c.id)
                                    .then((r) => {
                                      toast(
                                        r.emailSent
                                          ? `Email reenviado a ${c.email}`
                                          : 'El email no se pudo enviar — revisar logs.',
                                        r.emailSent ? 'success' : 'error',
                                      );
                                    })
                                    .catch((err: any) => {
                                      toast(err?.message || 'Error al reenviar email', 'error');
                                    });
                                }}
                                title="Reenviar email de bienvenida (rota la contraseña). Útil si el ganador reporta no haberlo recibido."
                              >
                                ✉ Reenviar email
                              </button>
                            )}
                          </div>
                        ) : isReadOnly ? (
                          // Para los demas stages (no hired) en proceso
                          // completed/closed: solo badge readonly. Si admin
                          // necesita cambiar, debe reabrir el proceso.
                          <span
                            className={`badge ${stageInfo.badge || 'badge-ghost'}`}
                            style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                            title="Solo lectura — proceso finalizado"
                          >
                            {stageLabel(c.stage)}
                          </span>
                        ) : (
                          <select className="input" value={c.stage} onChange={(e) => {
                            const newStage = e.target.value;
                            if (newStage === 'hired') {
                              // Bounce + guiar al usuario al flow correcto.
                              toast(
                                'Para contratar al candidato use "Generar contratación" en la pestaña Configuración. Eso ejecuta la cascada completa (actualiza el empleado, registra movimiento, audita).',
                                'info',
                              );
                              return;
                            }
                            if (token) api.recruitment.candidates.updateStage(token, c.id, newStage).then(() => fetchProcess());
                          }} style={{ fontSize: '0.75rem', width: 'auto', padding: '0.2rem 0.4rem' }}>
                            <option value="scored">{stageLabel('scored')}</option>
                            <option value="approved">{stageLabel('approved')}</option>
                            <option value="rejected">{stageLabel('rejected')}</option>
                            {c.stage === 'not_hired' && (
                              <option value="not_hired" disabled>{stageLabel('not_hired')}</option>
                            )}
                          </select>
                        )
                      )}
                    </div>

                    {/* CV Expandable Panel */}
                    {expandedCvPanel === c.id && (
                      <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        {/* Step indicators */}
                        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: c.cvUrl ? 'var(--success)' : 'var(--border)', color: c.cvUrl ? '#fff' : 'var(--text-muted)' }}>1</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: c.cvUrl ? 600 : 400, color: c.cvUrl ? 'var(--success)' : 'var(--text-muted)' }}>{t('postulantes.detail.cv.upload')}</span>
                          </div>
                          <div style={{ width: 30, height: 2, background: c.cvUrl ? 'var(--success)' : 'var(--border)' }} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: c.cvAnalysis ? 'var(--success)' : 'var(--border)', color: c.cvAnalysis ? '#fff' : 'var(--text-muted)' }}>2</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: c.cvAnalysis ? 600 : 400, color: c.cvAnalysis ? 'var(--success)' : 'var(--text-muted)' }}>{t('postulantes.detail.cv.analyze')}</span>
                          </div>
                          <div style={{ width: 30, height: 2, background: c.cvAnalysis ? 'var(--success)' : 'var(--border)' }} />
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                            <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, background: c.cvAnalysis ? 'var(--success)' : 'var(--border)', color: c.cvAnalysis ? '#fff' : 'var(--text-muted)' }}>3</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: c.cvAnalysis ? 600 : 400, color: c.cvAnalysis ? 'var(--success)' : 'var(--text-muted)' }}>{t('postulantes.detail.cv.report')}</span>
                          </div>
                        </div>

                        {/* S5.2 — CV archivado (proceso cerrado, compliance Chile 24m).
                            Solo admin puede solicitar acceso, requiere razon. */}
                        {!c.cvUrl && !cvFromProfile && c.cvArchivedAt && isAdmin ? (
                          <ArchivedCvBanner candidate={c} token={token} />
                        ) : !c.cvUrl && !cvFromProfile ? (
                          <div style={{ textAlign: 'center', padding: '1.5rem', border: '2px dashed var(--border)', borderRadius: 'var(--radius-sm)' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                              {c.candidateType === 'internal'
                                ? 'Este colaborador no tiene CV en su perfil. Puedes subir uno para este proceso.'
                                : t('postulantes.detail.cv.uploadDesc')}
                            </p>
                            {canManageCv && !isReadOnly && (
                              <label className="btn-primary" style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                                {uploadingCv ? t('postulantes.detail.cv.uploading') : t('postulantes.detail.cv.selectFile')}
                                <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                              </label>
                            )}
                          </div>
                        ) : !c.cvUrl && cvFromProfile ? (
                          <div style={{ padding: '1rem', background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.12)', borderRadius: 'var(--radius-sm)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                              <span style={{ fontSize: '1rem' }}>📄</span>
                              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>CV cargado desde el perfil del colaborador</span>
                              <span style={{ fontSize: '0.68rem', background: 'rgba(99,102,241,0.1)', color: '#6366f1', padding: '0.1rem 0.4rem', borderRadius: 8 }}>Perfil</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.82rem' }}>
                              <a href={c.user.cvUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
                                {c.user.cvFileName || 'Ver CV'} →
                              </a>
                              {canManageCv && !isReadOnly && (
                                <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                                  {uploadingCv ? 'Subiendo...' : 'Subir CV actualizado'}
                                  <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                                </label>
                              )}
                            </div>
                          </div>
                        ) : !c.cvAnalysis ? (
                          /* Step 2: Analyze */
                          <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', fontWeight: 600 }}>
                              {t('postulantes.detail.cv.uploaded')}
                            </p>
                            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                              {t('postulantes.detail.cv.aiDesc')}
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                              {canManageCv && !isReadOnly && (
                                <>
                                  <button className="btn-primary" onClick={() => handleAnalyzeCv(c.id)} disabled={!!analyzingCvId || aiBlocked} style={{ fontSize: '0.85rem' }}>
                                    {analyzingCvId === c.id ? t('postulantes.detail.cv.analyzing') : aiBlocked ? t('postulantes.detail.cv.noCredits') : t('postulantes.detail.cv.analyzeBtn')}
                                  </button>
                                  <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: '0.82rem' }}>
                                    {t('postulantes.detail.cv.changeCv')}
                                    <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                                  </label>
                                </>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* Step 3: Results summary */
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                              <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>{t('postulantes.detail.cv.analysisResult')}</span>
                              {canManageCv && !isReadOnly && (
                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                  <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                                    onClick={() => handleAnalyzeCv(c.id)} disabled={!!analyzingCvId || aiBlocked}>
                                    {analyzingCvId === c.id ? t('postulantes.detail.cv.analyzing') : aiBlocked ? t('postulantes.detail.cv.noCredits') : t('postulantes.detail.cv.reAnalyze')}
                                  </button>
                                  <label className="btn-ghost" style={{ cursor: 'pointer', fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>
                                    {t('postulantes.detail.cv.changeCv')}
                                    <input type="file" accept=".pdf" onChange={(e) => handleCvUpload(c.id, e)} style={{ display: 'none' }} />
                                  </label>
                                </div>
                              )}
                            </div>
                            {(() => {
                              let a = c.cvAnalysis;
                              if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_e) { a = null; } }
                              if (!a) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos de análisis</p>;
                              return (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                  {a.resumenEjecutivo && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{a.resumenEjecutivo}</p>}
                                  {a.matchPercentage != null && (
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ padding: '0.3rem 0.8rem', borderRadius: 20, fontWeight: 700, fontSize: '0.9rem',
                                        background: a.matchPercentage >= 70 ? 'rgba(16,185,129,0.1)' : a.matchPercentage >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                                        color: a.matchPercentage >= 70 ? 'var(--success)' : a.matchPercentage >= 40 ? 'var(--warning)' : 'var(--danger)',
                                      }}>Coincidencia: {a.matchPercentage}%</span>
                                    </div>
                                  )}
                                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0 }}>Ver informe completo en la Tarjeta de Puntuación</p>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Edit candidate panel */}
                    {editingCandidate === c.id && (
                      <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('postulantes.detail.edit.title')}</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('postulantes.detail.edit.email')}</label>
                            <input className="input" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('postulantes.detail.edit.phone')}</label>
                            <input className="input" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('postulantes.detail.edit.linkedin')}</label>
                            <input className="input" value={editForm.linkedIn} onChange={(e) => setEditForm((f) => ({ ...f, linkedIn: e.target.value }))} placeholder={t('postulantes.detail.edit.linkedinPlaceholder')} style={{ fontSize: '0.85rem' }} />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('postulantes.detail.edit.availability')}</label>
                            <select className="input" value={editForm.availability} onChange={(e) => setEditForm((f) => ({ ...f, availability: e.target.value }))} style={{ fontSize: '0.85rem' }}>
                              <option value="">{t('postulantes.detail.form.noSpec')}</option>
                              <option value="Inmediata">{t('postulantes.detail.form.availImmediate')}</option>
                              <option value="15 dias">{t('postulantes.detail.form.avail15')}</option>
                              <option value="30 dias">{t('postulantes.detail.form.avail30')}</option>
                              <option value="60 dias">{t('postulantes.detail.form.avail60')}</option>
                              <option value="90 dias">{t('postulantes.detail.form.avail90')}</option>
                              <option value="A convenir">{t('postulantes.detail.form.availNegotiable')}</option>
                            </select>
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('postulantes.detail.edit.salary')}</label>
                            <input className="input" value={editForm.salaryExpectation}
                              onChange={(e) => { const raw = e.target.value.replace(/\D/g, ''); setEditForm((f) => ({ ...f, salaryExpectation: raw ? Number(raw).toLocaleString('es-CL') : '' })); }}
                              placeholder="$0" style={{ fontSize: '0.85rem' }} />
                          </div>
                        </div>
                        <div style={{ marginBottom: '0.75rem' }}>
                          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>{t('postulantes.detail.edit.recruiterNotes')}</label>
                          <textarea className="input" value={editForm.recruiterNotes} onChange={(e) => setEditForm((f) => ({ ...f, recruiterNotes: e.target.value }))}
                            rows={3} placeholder={t('postulantes.detail.edit.notesPlaceholder')} style={{ fontSize: '0.85rem', resize: 'vertical' as const }} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn-primary" style={{ fontSize: '0.82rem' }} disabled={savingEdit} onClick={async () => {
                            if (!token) return;
                            setSavingEdit(true);
                            try {
                              await api.recruitment.candidates.update(token, c.id, editForm);
                              toast(t('postulantes.detail.edit.updated') || 'Datos actualizados', 'success');
                              setEditingCandidate(null);
                              fetchProcess();
                            } catch (err: any) { toast(err.message || t('postulantes.detail.edit.saveError') || 'Error al guardar', 'error'); }
                            setSavingEdit(false);
                          }}>
                            {savingEdit ? t('postulantes.detail.edit.saving') : t('postulantes.detail.edit.save')}
                          </button>
                          <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setEditingCandidate(null)}>{t('postulantes.detail.edit.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Evaluación (entrevista) ──────────────────────────── */}
      {tab === 'evaluacion' && (
        <div>
          {!selectedCandidate ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              {isEvaluatorOfProcess
                ? t('postulantes.detail.eval.selectToEval')
                : t('postulantes.detail.eval.selectToView')}
            </div>
          ) : !isEvaluatorOfProcess ? (
            /* ── Admin read-only view of evaluations ──────────────── */
            <AdminEvaluationView candidate={selectedCandidate} token={token} onViewScorecard={() => loadScorecard(selectedCandidate.id)} t={t} />
          ) : (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
                {t('postulantes.detail.eval.evalTitle')}: {selectedCandidate.firstName || selectedCandidate.user?.firstName} {selectedCandidate.lastName || selectedCandidate.user?.lastName}
              </h2>

              {/* Requirement checks */}
              {interviewForm.reqChecks.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('postulantes.detail.eval.reqCompliance')}</h3>
                  <table style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', fontSize: '0.78rem' }}>{t('postulantes.detail.eval.requirement')}</th>
                        <th style={{ width: 130, fontSize: '0.78rem' }}>{t('postulantes.detail.eval.state')}</th>
                        <th style={{ fontSize: '0.78rem' }}>{t('postulantes.detail.eval.comment')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interviewForm.reqChecks.map((rc: any, i: number) => (
                        <tr key={i}>
                          <td style={{ fontSize: '0.85rem' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--accent)', fontWeight: 600 }}>{categoryLabel(rc.category)}</span>
                            <br />{rc.text}
                          </td>
                          <td>
                            <select className="input" value={rc.status}
                              onChange={(e) => setInterviewForm((f) => {
                                const checks = [...f.reqChecks];
                                checks[i] = { ...checks[i], status: e.target.value };
                                return { ...f, reqChecks: checks };
                              })}
                              style={{ fontSize: '0.82rem', fontWeight: 600, minWidth: 140,
                                color: rc.status === 'cumple' ? 'var(--success)' : rc.status === 'no_cumple' ? 'var(--danger)' : rc.status === 'parcial' ? 'var(--warning)' : 'var(--text-muted)',
                              }}>
                              <option value="pendiente">{t('postulantes.detail.eval.pending')}</option>
                              <option value="cumple">{t('postulantes.detail.eval.meets')}</option>
                              <option value="parcial">{t('postulantes.detail.eval.partial')}</option>
                              <option value="no_cumple">{t('postulantes.detail.eval.notMeet')}</option>
                            </select>
                          </td>
                          <td>
                            <input className="input" value={rc.comment || ''} style={{ fontSize: '0.78rem' }}
                              onChange={(e) => setInterviewForm((f) => {
                                const checks = [...f.reqChecks];
                                checks[i] = { ...checks[i], comment: e.target.value };
                                return { ...f, reqChecks: checks };
                              })}
                              placeholder={t('postulantes.detail.eval.commentPlaceholder')} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Score section */}
              {(() => {
                const checks = interviewForm.reqChecks || [];
                const answered = checks.filter((c: any) => c.status !== 'pendiente');
                const scoreMap: Record<string, number> = { cumple: 10, parcial: 5, no_cumple: 0 };
                const hasWeights = answered.some((c: any) => c.weight > 0);
                const equalW = answered.length > 0 ? 100 / checks.length : 1;
                const autoScore = answered.length > 0
                  ? hasWeights
                    ? Number((answered.reduce((sum: number, c: any) => sum + (scoreMap[c.status] || 0) * (c.weight || equalW), 0) / answered.reduce((s: number, c: any) => s + (c.weight || equalW), 0)).toFixed(1))
                    : Number((answered.reduce((sum: number, c: any) => sum + (scoreMap[c.status] || 0), 0) / answered.length).toFixed(1))
                  : 0;
                // Compute final globalScore: weighted 70% requirements + 30% evaluator
                const manualScore = interviewForm.manualScore ? Number(interviewForm.manualScore) : null;
                const finalScore = manualScore != null && answered.length > 0
                  ? Number(((autoScore * 0.7) + (manualScore * 0.3)).toFixed(1))
                  : manualScore != null ? manualScore
                  : answered.length > 0 ? autoScore : 0;
                // Auto-update globalScore
                if (String(finalScore) !== interviewForm.globalScore) {
                  setTimeout(() => setInterviewForm((f) => ({ ...f, globalScore: String(finalScore) })), 0);
                }
                return null;
              })()}
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '140px 140px 1fr', gap: '1rem' }}>
                  {/* Auto score from requirements */}
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{t('postulantes.detail.eval.scoreReqs')}</label>
                    <div style={{ textAlign: 'center', fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-muted)', padding: '0.3rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                      {(() => {
                        const checks = interviewForm.reqChecks || [];
                        const answered = checks.filter((c: any) => c.status !== 'pendiente');
                        const scoreMap: Record<string, number> = { cumple: 10, parcial: 5, no_cumple: 0 };
                        const hw = answered.some((c: any) => c.weight > 0);
                        const eqW = checks.length > 0 ? 100 / checks.length : 1;
                        if (answered.length === 0) return '--';
                        return hw
                          ? (answered.reduce((s: number, c: any) => s + (scoreMap[c.status] || 0) * (c.weight || eqW), 0) / answered.reduce((s: number, c: any) => s + (c.weight || eqW), 0)).toFixed(1)
                          : (answered.reduce((s: number, c: any) => s + (scoreMap[c.status] || 0), 0) / answered.length).toFixed(1);
                      })()}/10
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.2rem' }}>
                      {(interviewForm.reqChecks || []).some((c: any) => c.weight > 0) ? t('postulantes.detail.eval.weightedByWeight') : t('postulantes.detail.eval.autoCalc')}
                    </div>
                  </div>
                  {/* Manual evaluator score */}
                  <div>
                    <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{t('postulantes.detail.eval.myScore')}</label>
                    <input className="input" type="number" min={1} max={10} step={0.1}
                      value={interviewForm.manualScore || ''}
                      onChange={(e) => {
                        let val = e.target.value;
                        if (val && Number(val) > 10) val = '10';
                        if (val && Number(val) < 0) val = '0';
                        setInterviewForm((f) => ({ ...f, manualScore: val }));
                      }}
                      placeholder="1-10"
                      style={{ textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, padding: '0.3rem' }} />
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '0.2rem' }}>{t('postulantes.detail.eval.yourAssessment')}</div>
                  </div>
                  {/* Final combined score */}
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0.5rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>{t('postulantes.detail.eval.finalScore')}</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)' }}>
                      {interviewForm.globalScore || '--'}<span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>/10</span>
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{t('postulantes.detail.eval.weightFormula')}</div>
                  </div>
                </div>
              </div>

              {/* Comments */}
              <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>{t('postulantes.detail.eval.generalComments')}</label>
                <textarea className="input" rows={3} value={interviewForm.comments}
                  onChange={(e) => setInterviewForm((f) => ({ ...f, comments: e.target.value }))}
                  style={{ resize: 'vertical', fontSize: '0.85rem' }} placeholder={t('postulantes.detail.eval.commentsPlaceholder')} />
              </div>

              <button className="btn-primary" onClick={handleSaveInterview} disabled={savingInterview}>
                {savingInterview ? t('postulantes.detail.eval.saving') : t('postulantes.detail.eval.saveEval')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Scorecard ────────────────────────────────────────── */}
      {tab === 'scorecard' && (
        <div>
          {!scorecard ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              {t('postulantes.detail.scorecard.selectToView')}
            </div>
          ) : (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>
                {t('postulantes.detail.scorecard.title')}: {scorecard.candidate?.firstName || scorecard.candidate?.user?.firstName} {scorecard.candidate?.lastName || scorecard.candidate?.user?.lastName}
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {scorecard.scores?.cvMatchPct != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('postulantes.detail.scorecard.cvMatch')}</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)' }}>{scorecard.scores.cvMatchPct}%</div>
                  </div>
                )}
                {scorecard.scores?.interviewAvg != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('postulantes.detail.scorecard.interviewAvg')}</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6366f1' }}>{Number(scorecard.scores.interviewAvg).toFixed(1)}/10</div>
                  </div>
                )}
                {scorecard.scores?.requirementPct != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('postulantes.detail.scorecard.requirements')}</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#10b981' }}>{scorecard.scores.requirementPct}%</div>
                  </div>
                )}
                {scorecard.scores?.historyAvg != null && (
                  <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('postulantes.detail.scorecard.historyAvg')}</div>
                    <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f59e0b' }}>{Number(scorecard.scores.historyAvg).toFixed(1)}/10</div>
                  </div>
                )}
                <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{t('postulantes.detail.scorecard.finalScore')}</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--success)' }}>
                    {scorecard.scores?.finalScore != null ? Number(scorecard.scores.finalScore).toFixed(1) : '--'}/10
                  </div>
                </div>
              </div>

              {/* Interviews detail */}
              {scorecard.interviews?.length > 0 && (
                <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('postulantes.detail.scorecard.interviewsTitle')}</h3>
                  {scorecard.interviews.map((i: any) => (
                    <div key={i.id} style={{ padding: '0.75rem', marginBottom: '0.5rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{i.evaluator?.firstName} {i.evaluator?.lastName}</span>
                        <span style={{ fontWeight: 700, color: '#6366f1' }}>{i.globalScore != null ? Number(i.globalScore).toFixed(1) + '/10' : '--'}</span>
                      </div>
                      {i.comments && <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>{i.comments}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* CV Analysis */}
              {scorecard.candidate?.cvAnalysis && (() => {
                // Parse if stored as string
                let analysis = scorecard.candidate.cvAnalysis;
                if (typeof analysis === 'string') {
                  try { analysis = JSON.parse(analysis); } catch (_e) { analysis = null; }
                }
                if (!analysis) return null;
                return (
                  <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--accent)' }}>{t('postulantes.detail.scorecard.aiReport')}</h3>
                    {analysis.resumenEjecutivo && (
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '0.75rem' }}>{analysis.resumenEjecutivo}</p>
                    )}
                    {analysis.experienciaRelevante && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>{t('postulantes.detail.scorecard.relevantExp')}</div>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>{analysis.experienciaRelevante}</p>
                      </div>
                    )}
                    {analysis.habilidadesTecnicas?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>{t('postulantes.detail.scorecard.techSkills')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {analysis.habilidadesTecnicas.map((h: string, i: number) => (
                            <span key={i} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'rgba(201,147,58,0.08)', borderRadius: 10, color: 'var(--accent)' }}>{h}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.habilidadesBlandas?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>{t('postulantes.detail.scorecard.softSkills')}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                          {analysis.habilidadesBlandas.map((h: string, i: number) => (
                            <span key={i} style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: 'rgba(99,102,241,0.08)', borderRadius: 10, color: '#6366f1' }}>{h}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {analysis.formacionAcademica && (
                      <div style={{ marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        <strong>Formaci&oacute;n:</strong> {analysis.formacionAcademica}
                      </div>
                    )}
                    {analysis.alertas?.length > 0 && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--danger)', marginBottom: '0.3rem' }}>{t('postulantes.detail.scorecard.alerts')}</div>
                        {analysis.alertas.map((a: string, i: number) => (
                          <div key={i} style={{ fontSize: '0.82rem', color: 'var(--danger)', padding: '0.25rem 0', lineHeight: 1.4 }}>&#9888; {a}</div>
                        ))}
                      </div>
                    )}
                    {analysis.recomendacion && (
                      <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(16,185,129,0.15)', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                        <strong>Recomendaci&oacute;n:</strong> {analysis.recomendacion}
                      </div>
                    )}
                    {analysis.matchPercentage != null && (
                      <div style={{ display: 'inline-block', padding: '0.3rem 0.8rem', borderRadius: 20, fontWeight: 700, fontSize: '0.85rem',
                        background: analysis.matchPercentage >= 70 ? 'rgba(16,185,129,0.1)' : analysis.matchPercentage >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                        color: analysis.matchPercentage >= 70 ? 'var(--success)' : analysis.matchPercentage >= 40 ? 'var(--warning)' : 'var(--danger)',
                      }}>
                        Coincidencia: {analysis.matchPercentage}%
                        {analysis.matchJustification && (
                          <span style={{ fontWeight: 400, fontSize: '0.78rem', marginLeft: '0.5rem' }}>— {analysis.matchJustification}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Comparativa (solo internos) ──────────────────────── */}
      {tab === 'comparativa' && (
        <div>
          {!comparative ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{t('postulantes.detail.comparative.loading')}</div>
          ) : (
            <div>
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '1rem' }}>{t('postulantes.detail.comparative.title')}</h2>
              <div className="card" style={{ overflow: 'auto', marginBottom: '1rem' }}>
                <table style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>{t('postulantes.detail.comparative.candidate')}</th>
                      <th>{t('postulantes.detail.comparative.interviews')}</th>
                      {isInternal && <th>{t('postulantes.detail.comparative.history')}</th>}
                      {isInternal && <th>{t('postulantes.detail.comparative.seniority')}</th>}
                      <th>{t('postulantes.detail.comparative.finalScore')}</th>
                      {/* S3.x — columna Estado para que se vea claramente
                          quien fue contratado / aprobado / rechazado en
                          la comparativa, especialmente en procesos cerrados. */}
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(comparative.rows || []).map((row: any) => {
                      const c = row.candidate;
                      const name = c.user ? c.user.firstName + ' ' + c.user.lastName : (c.firstName || '') + ' ' + (c.lastName || '');
                      const isWinner = process.winningCandidateId === c.id;
                      const stageBadgeColor: Record<string, string> = {
                        hired: '#10b981',
                        approved: '#10b981',
                        rejected: '#ef4444',
                        not_hired: '#94a3b8',  // S3.x — gris neutro: no fue elegido pero no rechazado
                        scored: '#f59e0b',
                        interviewing: '#6366f1',
                        cv_review: '#94a3b8',
                        registered: '#94a3b8',
                      };
                      const sBadge = stageBadgeColor[c.stage] || '#94a3b8';
                      return (
                        <tr
                          key={c.id}
                          style={{
                            // Row destacada para el ganador del proceso.
                            background: isWinner ? 'rgba(16,185,129,0.06)' : undefined,
                            borderLeft: isWinner ? '3px solid #10b981' : undefined,
                          }}
                        >
                          <td>
                            <span style={{ fontWeight: 600 }}>{name}</span>
                            {isWinner && (
                              <span style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700, marginLeft: '0.4rem' }} title="Candidato contratado">
                                🏆 GANADOR
                              </span>
                            )}
                            {c.candidateType === 'internal' && <span style={{ fontSize: '0.68rem', color: '#6366f1', fontWeight: 700, marginLeft: '0.4rem' }}>INTERNO</span>}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 600 }}>{row.interviewAvg != null ? row.interviewAvg + '/10' : '--'}</td>
                          {isInternal && <td style={{ textAlign: 'center', fontWeight: 600, color: '#6366f1' }}>{row.internalProfile?.avgScore ? Number(row.internalProfile.avgScore).toFixed(2) + '/10' : '--'}</td>}
                          {isInternal && <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{row.internalProfile?.user?.tenureMonths != null ? (row.internalProfile.user.tenureMonths >= 12 ? Math.floor(row.internalProfile.user.tenureMonths / 12) + 'a ' + (row.internalProfile.user.tenureMonths % 12) + 'm' : row.internalProfile.user.tenureMonths + 'm') : '--'}</td>}
                          <td style={{ textAlign: 'center', fontWeight: 800, fontSize: '1.1rem', color: 'var(--success)' }}>
                            {c.finalScore != null ? Number(c.finalScore).toFixed(1) : '--'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '999px',
                                fontSize: '0.7rem',
                                fontWeight: 600,
                                background: `${sBadge}18`,
                                color: sBadge,
                              }}
                            >
                              {stageLabel(c.stage)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Tab: Configuración ────────────────────────────────────── */}
      {tab === 'configuracion' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* S3.x — Estado del Proceso movido al INICIO de Configuracion.
              Era el ultimo elemento (ScoringWeightsEditor + Estado abajo);
              ahora arranca con la accion mas relevante: el boton "Generar
              contratacion". El admin entra a Configuracion para gestionar
              el cierre, no para mirar requisitos. */}
          {isAdmin && (
            <ProcessStatusPanel
              process={process}
              candidates={candidates}
              token={token}
              processId={params.id}
              onSaved={fetchProcess}
            />
          )}

          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>{t('postulantes.detail.config.processInfo')}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div><span style={{ color: 'var(--text-muted)' }}>{t('postulantes.detail.config.title')}:</span> <strong>{process.title}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>{t('postulantes.detail.config.position')}:</span> <strong>{process.position}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>{t('postulantes.detail.config.department')}:</span> <strong>{process.department || '—'}</strong></div>
              <div><span style={{ color: 'var(--text-muted)' }}>{t('postulantes.detail.config.type')}:</span> <strong>{isInternal ? t('postulantes.type.internal') : t('postulantes.type.external')}</strong></div>
              {process.startDate && <div><span style={{ color: 'var(--text-muted)' }}>{t('postulantes.detail.config.start')}:</span> <strong>{new Date(process.startDate).toLocaleDateString('es-CL')}</strong></div>}
              {process.endDate && <div><span style={{ color: 'var(--text-muted)' }}>{t('postulantes.detail.config.end')}:</span> <strong>{new Date(process.endDate).toLocaleDateString('es-CL')}</strong></div>}
            </div>
            {process.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.75rem' }}>{process.description}</p>}

            {/* S3.x — banner de contratacion. Si el proceso tiene un
                winningCandidateId, mostrar destacado en verde quien fue
                contratado, con la fecha efectiva (de hireData) cuando esta. */}
            {process.winningCandidateId && (() => {
              const winner = candidates.find((c: any) => c.id === process.winningCandidateId);
              if (!winner) return null;
              const winnerName = winner.candidateType === 'internal' && winner.user
                ? `${winner.user.firstName} ${winner.user.lastName}`
                : `${winner.firstName || ''} ${winner.lastName || ''}`.trim();
              const effDate = process.hireData?.effectiveDate;
              return (
                <div
                  style={{
                    marginTop: '1rem',
                    padding: '0.85rem 1rem',
                    background: 'rgba(16,185,129,0.08)',
                    border: '1px solid rgba(16,185,129,0.3)',
                    borderLeft: '4px solid #10b981',
                    borderRadius: 'var(--radius-sm)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '1rem' }} aria-hidden="true">🏆</span>
                    <strong style={{ color: '#059669', fontSize: '0.9rem' }}>Candidato contratado</strong>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{winnerName}</strong>
                    {winner.candidateType === 'internal' ? ' (interno)' : ' (externo)'}
                    {effDate && (
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' — Fecha efectiva: '}
                        <strong style={{ color: 'var(--text-secondary)' }}>{new Date(effDate).toLocaleDateString('es-CL')}</strong>
                      </span>
                    )}
                  </div>
                  {process.hireData?.notes && (
                    <p style={{ margin: '0.4rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {process.hireData.notes}
                    </p>
                  )}
                </div>
              );
            })()}
          </div>

          {requirements.length > 0 && (
            <div className="card" style={{ padding: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('postulantes.detail.config.requirements')}</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {requirements.map((r: any, i: number) => (
                  <span key={i} style={{ padding: '0.3rem 0.7rem', borderRadius: 20, fontSize: '0.78rem', background: 'rgba(201,147,58,0.08)', border: '1px solid rgba(201,147,58,0.2)', color: 'var(--accent)', fontWeight: 500 }}>
                    {categoryLabel(r.category)}: {r.text}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('postulantes.detail.config.evaluators')} ({evaluators.length})</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {evaluators.map((ev: any) => (
                <div key={ev.id} style={{ padding: '0.4rem 0.8rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}>
                  {ev.evaluator?.firstName} {ev.evaluator?.lastName}
                  {ev.evaluator?.department && <span style={{ color: 'var(--text-muted)', marginLeft: '0.3rem' }}>({ev.evaluator.department})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* Scoring weights configuration. S3.x — solo editable cuando
              el proceso esta DRAFT o ACTIVE. En completed/closed se muestra
              en modo readonly (los pesos finales son los que se aplicaron
              al ultimo recalculo, no se deberian poder cambiar
              retroactivamente). Al reabrir el proceso, se re-habilita. */}
          {isAdmin && (
            <ScoringWeightsEditor
              process={process}
              isInternal={isInternal}
              token={token}
              processId={params.id}
              onSaved={fetchProcess}
              readOnly={process.status === 'completed' || process.status === 'closed'}
            />
          )}
        </div>
      )}
    </div>
  );
}
