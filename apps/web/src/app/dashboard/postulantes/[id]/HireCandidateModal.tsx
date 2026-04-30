'use client';

/**
 * HireCandidateModal — S1.3 Sprint 1.
 *
 * Modal que se abre desde el detalle de un proceso ACTIVE cuando el
 * admin hace click en "Completar (contratado)". Pide:
 *   - Candidato ganador (dropdown filtrado a stages INTERVIEWING/SCORED/APPROVED)
 *   - Fecha efectiva de inicio (effectiveDate)
 *   - Departamento, cargo y manager destino (pre-poblados con el proceso)
 *   - Salario y tipo de contrato (opcionales)
 *   - Notas (opcional)
 *
 * Al confirmar invoca POST /recruitment/processes/:id/hire/:candidateId
 * que ejecuta toda la cascada (candidate → HIRED, process → COMPLETED,
 * user update/create, user_movements, audit log).
 *
 * Si el candidato es EXTERNO, el response trae `tempPassword` que
 * mostramos en una pantalla de exito final con boton "Copiar" — es la
 * unica oportunidad de verlo en clear-text. El admin debe entregarlo
 * al nuevo empleado para que haga su primer login y cambie password.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import useFocusTrap from '@/hooks/useFocusTrap';
import { useDepartments } from '@/hooks/useDepartments';
import { usePositionsV2 } from '@/hooks/usePositions';
import { useActiveUsersForPicker } from '@/hooks/useUsers';

const CANDIDATE_HIREABLE_STAGES = ['interviewing', 'scored', 'approved'];

const CONTRACT_TYPES = [
  { value: 'indefinido', label: 'Indefinido' },
  { value: 'plazo_fijo', label: 'Plazo fijo' },
  { value: 'honorarios', label: 'Honorarios' },
  { value: 'practicante', label: 'Practicante' },
] as const;

export interface HireCandidateModalProps {
  open: boolean;
  process: any;        // RecruitmentProcess shape
  candidates: any[];   // RecruitmentCandidate[] del proceso
  token: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function HireCandidateModal({
  open,
  process,
  candidates,
  token,
  onClose,
  onSuccess,
}: HireCandidateModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // useDepartments retorna { departments: string[], departmentRecords: DepartmentData[] }
  // — usamos `departmentRecords` que tiene { id, name } necesarios para el dropdown.
  const { departmentRecords } = useDepartments();
  // usePositionsV2 retorna PositionData[] con id+name+level (necesitamos id
  // porque el backend espera newPositionId: uuid).
  const { positions: positionRecords } = usePositionsV2();
  const { data: usersResp } = useActiveUsersForPicker();
  const allUsers: any[] = (usersResp as any)?.data ?? [];
  // Candidatos elegibles: solo los que llegaron al menos a entrevista.
  const hireableCandidates = useMemo(
    () => (candidates || []).filter((c) => CANDIDATE_HIREABLE_STAGES.includes(c.stage)),
    [candidates],
  );
  // Managers + admins (los unicos validos como newManagerId en el backend)
  const eligibleManagers = useMemo(
    () => allUsers.filter((u) => u.role === 'manager' || u.role === 'tenant_admin'),
    [allUsers],
  );

  const [candidateId, setCandidateId] = useState<string>('');
  const [effectiveDate, setEffectiveDate] = useState<string>('');
  const [newDepartmentId, setNewDepartmentId] = useState<string>('');
  const [newPositionId, setNewPositionId] = useState<string>('');
  const [newManagerId, setNewManagerId] = useState<string>('');
  const [salary, setSalary] = useState<string>('');
  const [contractType, setContractType] = useState<string>('indefinido');
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Estado post-exito: si fue externo, mostrar el tempPassword una vez.
  const [successData, setSuccessData] = useState<{
    isExternal: boolean;
    tempPassword: string | null;
    employeeName: string;
    employeeEmail: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  // Pre-poblar valores cuando abre el modal con valores del proceso.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSuccessData(null);
    setCopied(false);
    setCandidateId('');
    // effectiveDate por defecto = hoy
    const today = new Date().toISOString().slice(0, 10);
    setEffectiveDate(today);
    setNewDepartmentId(process?.departmentId || '');
    setNewPositionId(process?.positionId || '');
    setNewManagerId('');
    setSalary('');
    setContractType('indefinido');
    setNotes('');
  }, [open, process?.id, process?.departmentId, process?.positionId]);

  // Cuando el admin selecciona un candidato INTERNO, pre-pueblo manager
  // con el manager actual del User (asi se entiende rapido si hay cambio).
  useEffect(() => {
    if (!candidateId) return;
    const sel = hireableCandidates.find((c) => c.id === candidateId);
    if (sel?.candidateType === 'internal' && sel.user?.managerId && !newManagerId) {
      setNewManagerId(sel.user.managerId);
    }
  }, [candidateId, hireableCandidates, newManagerId]);

  // S2-UX (post-bug fix) — Auto-poblar jefatura cuando cambia el dept,
  // si el dept tiene UN solo manager configurado (head implicito). Si hay
  // varios managers en el dept, dejamos vacio para que el admin elija.
  // Solo se ejecuta cuando newDepartmentId cambia Y newManagerId no fue
  // explicitamente seleccionado por el usuario (heuristica: si el manager
  // actual ya pertenece a ese dept, no pisamos nada).
  useEffect(() => {
    if (!newDepartmentId) return;
    if (!eligibleManagers.length) return;
    // Filtrar managers que pertenezcan al dept seleccionado
    const deptName = (departmentRecords || []).find((d: any) => d.id === newDepartmentId)?.name;
    const candidatesForDept = eligibleManagers.filter(
      (u: any) => u.departmentId === newDepartmentId || (deptName && u.department === deptName),
    );
    // Si el manager actualmente seleccionado YA pertenece al dept, no tocamos
    if (newManagerId && candidatesForDept.some((u: any) => u.id === newManagerId)) return;
    // Si solo hay UN candidato natural para el dept → auto-popular
    if (candidatesForDept.length === 1) {
      setNewManagerId(candidatesForDept[0].id);
      return;
    }
    // Si hay varios o ninguno, dejar al admin que decida (no pisamos)
  }, [newDepartmentId, eligibleManagers, departmentRecords, newManagerId]);

  // Cierre con Escape — patron consistente con otros modales.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  if (!open) return null;

  const selectedCandidate = hireableCandidates.find((c) => c.id === candidateId);
  const isExternal = selectedCandidate?.candidateType === 'external';
  const candidateLabel = (c: any) => {
    if (c.candidateType === 'internal' && c.user) {
      return `${c.user.firstName} ${c.user.lastName} (interno)`;
    }
    return `${c.firstName ?? ''} ${c.lastName ?? ''} (externo)`.trim();
  };

  const canSubmit =
    !!candidateId &&
    !!effectiveDate &&
    !submitting &&
    !successData;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.recruitment.hireCandidate(token, process.id, candidateId, {
        effectiveDate,
        newDepartmentId: newDepartmentId || null,
        newPositionId: newPositionId || null,
        newManagerId: newManagerId || null,
        salary: salary ? Number(salary) : null,
        contractType: contractType || null,
        notes: notes || null,
      });
      const employeeName = selectedCandidate
        ? candidateLabel(selectedCandidate).replace(/ \((interno|externo)\)$/, '')
        : '';
      const employeeEmail = selectedCandidate?.email
        || selectedCandidate?.user?.email
        || '';
      setSuccessData({
        isExternal: !!isExternal,
        tempPassword: result.tempPassword,
        employeeName,
        employeeEmail,
      });
      // No cerramos el modal aun — el admin debe ver el tempPassword si externo.
      // Para internos podriamos cerrar inmediatamente, pero mostramos la
      // pantalla de exito tambien (consistencia + chance de verificar datos).
    } catch (e: any) {
      setError(e?.message || 'No se pudo completar el hire. Intente nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyPassword = async () => {
    if (!successData?.tempPassword) return;
    try {
      await navigator.clipboard.writeText(successData.tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // navigator.clipboard puede fallar en http (no https) — el password ya esta visible en pantalla.
    }
  };

  const handleClose = () => {
    if (successData) {
      onSuccess();
    }
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hire-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="animate-fade-up"
        style={{
          maxWidth: '720px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--bg-surface)',
          borderRadius: 'var(--radius-sm, 8px)',
          border: '1px solid var(--border)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 id="hire-modal-title" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            {successData ? '✓ Contratación registrada' : 'Marcar como contratado'}
          </h2>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleClose}
            aria-label="Cerrar"
            disabled={submitting}
            style={{ fontSize: '1rem', padding: '0.3rem 0.6rem', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.25rem 1.5rem' }}>
          {successData ? (
            <SuccessView
              data={successData}
              copied={copied}
              onCopyPassword={handleCopyPassword}
              onClose={handleClose}
            />
          ) : (
            <FormView
              process={process}
              hireableCandidates={hireableCandidates}
              departments={departmentRecords || []}
              positions={positionRecords || []}
              eligibleManagers={eligibleManagers}
              candidateId={candidateId}
              setCandidateId={setCandidateId}
              effectiveDate={effectiveDate}
              setEffectiveDate={setEffectiveDate}
              newDepartmentId={newDepartmentId}
              setNewDepartmentId={setNewDepartmentId}
              newPositionId={newPositionId}
              setNewPositionId={setNewPositionId}
              newManagerId={newManagerId}
              setNewManagerId={setNewManagerId}
              salary={salary}
              setSalary={setSalary}
              contractType={contractType}
              setContractType={setContractType}
              notes={notes}
              setNotes={setNotes}
              isExternal={!!isExternal}
              error={error}
              submitting={submitting}
              canSubmit={canSubmit}
              onSubmit={handleSubmit}
              onCancel={handleClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Form view ─────────────────────────────────────────────────────────

function FormView(props: any) {
  const {
    process, hireableCandidates, departments, positions, eligibleManagers,
    candidateId, setCandidateId, effectiveDate, setEffectiveDate,
    newDepartmentId, setNewDepartmentId, newPositionId, setNewPositionId,
    newManagerId, setNewManagerId, salary, setSalary,
    contractType, setContractType, notes, setNotes,
    isExternal, error, submitting, canSubmit, onSubmit, onCancel,
  } = props;

  const candidateLabel = (c: any) => {
    if (c.candidateType === 'internal' && c.user) {
      return `${c.user.firstName} ${c.user.lastName} (interno)`;
    }
    return `${c.firstName ?? ''} ${c.lastName ?? ''} (externo)`.trim();
  };

  return (
    <>
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: '1rem', lineHeight: 1.5 }}>
        Esta acción cierra el proceso (status → <strong>completado</strong>) y ejecuta la cascada al
        registro del empleado:{' '}
        <strong>actualiza departamento/cargo/manager</strong> e inserta una entrada en el historial de
        movimientos. Para candidatos externos, además crea el usuario con password temporal.
      </p>

      {hireableCandidates.length === 0 && (
        <div style={{
          padding: '0.85rem 1rem', marginBottom: '1rem',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.85rem', color: '#b45309',
        }}>
          ⚠ No hay candidatos elegibles para contratar. Un candidato debe estar en stage{' '}
          <strong>en entrevista</strong>, <strong>evaluado</strong> o <strong>aprobado</strong>.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        {/* Candidato */}
        <Field label="Candidato a contratar" required>
          <select
            className="input"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            disabled={submitting || hireableCandidates.length === 0}
          >
            <option value="">— Seleccionar candidato —</option>
            {hireableCandidates.map((c: any) => (
              <option key={c.id} value={c.id}>
                {candidateLabel(c)} {c.finalScore != null ? ` · score ${Number(c.finalScore).toFixed(1)}` : ''}
              </option>
            ))}
          </select>
        </Field>

        {/* Fecha efectiva */}
        <Field label="Fecha efectiva de inicio" required hint="Cuándo inicia en el nuevo cargo">
          <input
            type="date"
            className="input"
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
            disabled={submitting}
          />
        </Field>

        {/* Grid 2 cols: dept + posicion */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
          <Field label="Departamento" hint="Pre-poblado del proceso">
            <select
              className="input"
              value={newDepartmentId}
              onChange={(e) => setNewDepartmentId(e.target.value)}
              disabled={submitting}
            >
              <option value="">— Sin cambio —</option>
              {(departments || []).map((d: any) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Cargo" hint="Pre-poblado del proceso">
            <select
              className="input"
              value={newPositionId}
              onChange={(e) => setNewPositionId(e.target.value)}
              disabled={submitting}
            >
              <option value="">— Sin cambio —</option>
              {(positions || []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Manager */}
        <Field label="Jefatura directa" hint="Manager o admin que reportará el empleado">
          <select
            className="input"
            value={newManagerId}
            onChange={(e) => setNewManagerId(e.target.value)}
            disabled={submitting}
          >
            <option value="">— Sin cambio / sin asignar —</option>
            {eligibleManagers.map((u: any) => {
              // Etiqueta enriquecida: "Nombre Apellido — Cargo · Depto (admin)".
              // Si el cargo o dept no estan, los omitimos sin romper layout.
              const roleSuffix = u.role === 'tenant_admin' ? ' (admin)' : '';
              const positionPart = u.position ? ` — ${u.position}` : '';
              const deptPart = u.department ? ` · ${u.department}` : '';
              return (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}{positionPart}{deptPart}{roleSuffix}
                </option>
              );
            })}
          </select>
        </Field>

        {/* Salario + contractType */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem' }}>
          <Field label="Salario (opcional)" hint="Solo registro — el módulo Contratos es la fuente formal">
            <input
              type="number"
              min={0}
              step="0.01"
              className="input"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
              disabled={submitting}
              placeholder="—"
            />
          </Field>
          <Field label="Tipo de contrato">
            <select
              className="input"
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              disabled={submitting}
            >
              {CONTRACT_TYPES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
        </div>

        {/* Notas */}
        <Field label="Notas internas (opcional)">
          <textarea
            className="input"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            placeholder="Justificación, contexto, condiciones especiales, etc."
            style={{ resize: 'vertical', fontFamily: 'inherit' }}
          />
        </Field>

        {/* Aviso externo */}
        {isExternal && (
          <div style={{
            padding: '0.7rem 0.9rem',
            background: 'rgba(99,102,241,0.08)',
            border: '1px solid rgba(99,102,241,0.25)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.8rem', color: '#4338ca', lineHeight: 1.5,
          }}>
            <strong>Candidato externo:</strong> al confirmar se creará un nuevo usuario en el sistema
            con un password temporal. Verás el password una sola vez en la pantalla siguiente —
            tendrás que entregárselo al empleado para su primer login.
          </div>
        )}

        {error && (
          <div style={{
            padding: '0.7rem 0.9rem',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.82rem', color: 'var(--danger)',
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        display: 'flex', gap: '0.5rem', justifyContent: 'flex-end',
        marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)',
      }}>
        <button type="button" className="btn-ghost" onClick={onCancel} disabled={submitting}>
          Cancelar
        </button>
        <button
          type="button"
          className="btn-primary"
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{ fontSize: '0.88rem' }}
        >
          {submitting ? 'Procesando…' : '✓ Confirmar contratación'}
        </button>
      </div>
    </>
  );
}

// ─── Success view ──────────────────────────────────────────────────────

function SuccessView(props: any) {
  const { data, copied, onCopyPassword, onClose } = props;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{
        padding: '1rem',
        background: 'rgba(16,185,129,0.06)',
        border: '1px solid rgba(16,185,129,0.25)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.88rem',
      }}>
        <div style={{ fontWeight: 700, marginBottom: '0.4rem', color: 'var(--success)' }}>
          {data.isExternal ? '🎉 Empleado creado y contratado' : '🎉 Empleado contratado'}
        </div>
        <div style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <strong>{data.employeeName}</strong> ({data.employeeEmail}) fue marcado como contratado y la
          cascada quedó registrada en el historial de movimientos del empleado.
        </div>
      </div>

      {data.isExternal && data.tempPassword && (
        <div style={{
          padding: '1rem',
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.35)',
          borderRadius: 'var(--radius-sm)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: '0.45rem', color: '#b45309' }}>
            ⚠ Password temporal — guárdalo ahora
          </div>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', margin: '0 0 0.6rem', lineHeight: 1.5 }}>
            Este es el único momento en que puedes ver el password en texto plano. Entrégaselo al empleado
            por un canal seguro. Será forzado a cambiarlo en su primer login.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code style={{
              flex: 1,
              padding: '0.55rem 0.8rem',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.95rem',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontWeight: 700,
              letterSpacing: '0.05em',
              wordBreak: 'break-all',
            }}>
              {data.tempPassword}
            </code>
            <button
              type="button"
              className="btn-ghost"
              onClick={onCopyPassword}
              style={{ fontSize: '0.78rem', flexShrink: 0 }}
            >
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '0.5rem' }}>
        <button type="button" className="btn-primary" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.82rem' }}>
      <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
        {label}
        {required && <span style={{ color: 'var(--danger)', marginLeft: '0.2rem' }}>*</span>}
      </span>
      {children}
      {hint && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{hint}</span>
      )}
    </label>
  );
}

export default HireCandidateModal;
