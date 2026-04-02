'use client';

import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

/* ─── helpers ─────────────────────────────────────────────────── */

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const ACTION_BADGES: Record<string, { cls: string; label: string }> = {
  approved:  { cls: 'badge-success', label: 'Aprobado' },
  rejected:  { cls: 'badge-danger',  label: 'Rechazado' },
  created:   { cls: 'badge-accent',  label: 'Creado' },
  submitted: { cls: 'badge-warning', label: 'Enviado' },
  completed: { cls: 'badge-success', label: 'Completado' },
  updated:   { cls: 'badge-accent',  label: 'Modificado' },
  cancelled: { cls: 'badge-ghost',   label: 'Cancelado' },
  changed:   { cls: 'badge-warning', label: 'Cambiado' },
  hired:     { cls: 'badge-success', label: 'Contratado' },
  deactivated: { cls: 'badge-danger', label: 'Desactivado' },
  sent:      { cls: 'badge-accent',  label: 'Enviado' },
  launched:  { cls: 'badge-accent',  label: 'Lanzada' },
  closed:    { cls: 'badge-ghost',   label: 'Cerrada' },
  assessed:  { cls: 'badge-warning', label: 'Evaluado' },
  adjusted:  { cls: 'badge-warning', label: 'Ajustado' },
  signed:    { cls: 'badge-success', label: 'Firmado' },
};

function getActionBadge(action: string): { cls: string; label: string } {
  // try to match the suffix after the last dot
  const suffix = action.split('.').pop() || action;
  if (ACTION_BADGES[suffix]) return ACTION_BADGES[suffix];
  // fallback keywords
  if (action.includes('approved')) return ACTION_BADGES.approved;
  if (action.includes('rejected')) return ACTION_BADGES.rejected;
  if (action.includes('created')) return ACTION_BADGES.created;
  if (action.includes('completed')) return ACTION_BADGES.completed;
  return { cls: 'badge-accent', label: action };
}

/* ─── Traduccion de acciones ──────────────────────────────────── */

const ACTION_LABELS: Record<string, string> = {
  // Sesion
  'login': 'Inicio de sesion',
  // Objetivos
  'objective.created': 'Objetivo creado',
  'objective.updated': 'Objetivo modificado',
  'objective.submitted_for_approval': 'Objetivo enviado a aprobacion',
  'objective.approved': 'Objetivo aprobado',
  'objective.rejected': 'Objetivo rechazado',
  'objective.cancelled': 'Objetivo cancelado',
  'objective.progress_updated': 'Progreso actualizado',
  // Evaluaciones / Ciclos
  'cycle.created': 'Ciclo de evaluacion creado',
  'cycle.launched': 'Ciclo de evaluacion lanzado',
  'cycle.closed': 'Ciclo de evaluacion cerrado',
  'cycle.paused': 'Ciclo de evaluacion pausado',
  'cycle.resumed': 'Ciclo de evaluacion reanudado',
  'cycle.stage_advanced': 'Etapa de ciclo avanzada',
  'evaluation.submitted': 'Evaluacion enviada',
  'evaluation.response_saved': 'Respuesta de evaluacion guardada',
  // Check-ins
  'checkin.created': 'Check-in programado',
  'checkin.completed': 'Check-in completado',
  'checkin.rejected': 'Check-in rechazado',
  // Feedback
  'feedback.sent': 'Feedback enviado',
  // Competencias
  'competency.created': 'Competencia creada',
  'competency.approved': 'Competencia aprobada',
  'competency.rejected': 'Competencia rechazada',
  // Planes de desarrollo
  'pdi.created': 'Plan de desarrollo creado',
  'pdi.status_changed': 'Estado de plan cambiado',
  // Talento
  'talent.assessed': 'Evaluacion de talento',
  'calibration.entry_adjusted': 'Calibracion ajustada',
  // Usuarios
  'user.created': 'Usuario creado',
  'user.updated': 'Usuario modificado',
  'user.deactivated': 'Usuario desactivado',
  'user.role_changed': 'Rol de usuario cambiado',
  'user.invited': 'Usuario invitado',
  'user.invite_resent': 'Invitacion reenviada',
  'users.bulk_imported': 'Importacion masiva de usuarios',
  // Encuestas
  'survey_created': 'Encuesta creada',
  'survey.launched': 'Encuesta lanzada',
  'survey.closed': 'Encuesta cerrada',
  // Seleccion
  'recruitment.process_created': 'Proceso de seleccion creado',
  'candidate.stage_changed': 'Etapa de candidato cambiada',
  'candidate.hired': 'Candidato contratado',
  'candidate.rejected': 'Candidato rechazado',
  // Firma digital
  'document.signed': 'Documento firmado',
  // Suscripciones
  'subscription.created': 'Suscripcion creada',
  'subscription.cancelled': 'Suscripcion cancelada',
  'subscription.plan_changed': 'Plan de suscripcion cambiado',
  'subscription.status_changed': 'Estado de suscripcion cambiado',
  'payment.registered': 'Pago registrado',
  'subscription_request.approved': 'Solicitud de suscripcion aprobada',
  'subscription_request.rejected': 'Solicitud de suscripcion rechazada',
  // Reportes
  'report.viewed': 'Reporte consultado',
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] || action;
}

/* ─── Traduccion de entidades ─────────────────────────────────── */

const ENTITY_LABELS: Record<string, string> = {
  objective: 'Objetivo',
  cycle: 'Ciclo de evaluacion',
  cycle_stage: 'Etapa de ciclo',
  evaluation: 'Evaluacion',
  checkin: 'Check-in',
  feedback: 'Feedback',
  competency: 'Competencia',
  development_plan: 'Plan de desarrollo',
  talent_assessment: 'Evaluacion de talento',
  calibration_entry: 'Calibracion',
  user: 'Usuario',
  User: 'Usuario',
  bulk_import: 'Importacion masiva',
  engagement_survey: 'Encuesta de clima',
  recruitment_process: 'Proceso de seleccion',
  report: 'Reporte',
  subscription: 'Suscripcion',
  subscription_request: 'Solicitud',
  payment: 'Pago',
  document: 'Documento',
};

function formatEntity(entityType: string): string {
  return ENTITY_LABELS[entityType] || entityType;
}

/* ─── Filtros ─────────────────────────────────────────────────── */

const ENTITY_TYPES = [
  { value: '', label: 'Todas las entidades' },
  { value: 'objective', label: 'Objetivos' },
  { value: 'cycle', label: 'Ciclos de evaluacion' },
  { value: 'checkin', label: 'Check-ins' },
  { value: 'feedback', label: 'Feedback' },
  { value: 'competency', label: 'Competencias' },
  { value: 'development_plan', label: 'Planes de desarrollo' },
  { value: 'talent_assessment', label: 'Talento' },
  { value: 'calibration_entry', label: 'Calibracion' },
  { value: 'user', label: 'Usuarios' },
  { value: 'engagement_survey', label: 'Encuestas de clima' },
  { value: 'recruitment_process', label: 'Seleccion' },
  { value: 'subscription', label: 'Suscripciones' },
  { value: 'report', label: 'Reportes' },
];

const ACTION_TYPES = [
  { value: '', label: 'Todas las acciones' },
  { value: 'login', label: 'Inicios de sesion' },
  { value: 'created', label: 'Creaciones' },
  { value: 'approved', label: 'Aprobaciones' },
  { value: 'rejected', label: 'Rechazos' },
  { value: 'submitted', label: 'Envios' },
  { value: 'completed', label: 'Completados' },
  { value: 'updated', label: 'Modificaciones' },
  { value: 'launched', label: 'Lanzamientos' },
  { value: 'viewed', label: 'Consultas' },
];

function formatMetadata(metadata: any): string {
  if (!metadata) return '-';
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch (_e) { return metadata; }
  }
  const parts: string[] = [];
  if (metadata.title) parts.push(metadata.title);
  if (metadata.name) parts.push(metadata.name);
  if (metadata.userName) parts.push(metadata.userName);
  if (metadata.candidateName) parts.push(metadata.candidateName);
  if (metadata.reason) parts.push('Razon: ' + metadata.reason);
  if (metadata.previousValue !== undefined && metadata.newValue !== undefined) {
    parts.push(metadata.field + ': ' + metadata.previousValue + ' -> ' + metadata.newValue);
  }
  if (metadata.overallScore !== undefined) parts.push('Nota: ' + metadata.overallScore);
  if (metadata.nineBoxPosition) parts.push('9-Box: ' + metadata.nineBoxPosition);
  if (parts.length === 0) return JSON.stringify(metadata).slice(0, 120);
  return parts.join(' | ');
}

/* ─── Expandable detail panel ─────────────────────────────────── */

function DetailPanel(props: { log: any }) {
  const { log } = props;
  let meta = log.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch (_e) { meta = null; }
  }

  const detailStyle = {
    padding: '1rem 1.5rem',
    background: 'var(--bg-surface)',
    borderTop: '1px solid var(--border)',
    fontSize: '0.83rem',
    color: 'var(--text-secondary)',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem 2rem',
  } as const;

  const labelSt = { fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.15rem', fontSize: '0.78rem' } as const;
  const valSt = { fontSize: '0.82rem' } as const;

  return (
    <tr>
      <td colSpan={7} style={{ padding: 0 }}>
        <div style={detailStyle}>
          <div>
            <div style={labelSt}>Fecha y hora exacta</div>
            <div style={valSt}>{new Date(log.createdAt).toLocaleString('es-CL', { dateStyle: 'full', timeStyle: 'medium' })}</div>
          </div>
          <div>
            <div style={labelSt}>IP de origen</div>
            <div style={valSt}>{log.ipAddress || 'No registrada'}</div>
          </div>
          <div>
            <div style={labelSt}>Usuario</div>
            <div style={valSt}>{log.userName || 'Sistema'} {log.userEmail ? '(' + log.userEmail + ')' : ''}</div>
          </div>
          <div>
            <div style={labelSt}>ID de Entidad</div>
            <div style={{ ...valSt, fontFamily: 'monospace', fontSize: '0.78rem' }}>{log.entityId || '-'}</div>
          </div>
          {meta && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelSt}>Metadata completa</div>
              <pre style={{
                background: 'var(--bg-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '0.75rem',
                fontSize: '0.78rem',
                overflow: 'auto',
                maxHeight: '200px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {JSON.stringify(meta, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ─── Guide panel ─────────────────────────────────────────────── */

function GuidePanel(props: { open: boolean; onToggle: () => void }) {
  if (!props.open) return null;

  const sectionSt = { marginBottom: '1rem' } as const;
  const titleSt = { fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.35rem' } as const;
  const textSt = { fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 } as const;

  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.25rem', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>Guia del Registro de Auditoria</h3>
        <button className="btn-ghost" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={props.onToggle}>Cerrar</button>
      </div>

      <div style={sectionSt}>
        <div style={titleSt}>Que informacion se registra?</div>
        <p style={textSt}>
          El sistema registra automaticamente cada accion relevante: aprobaciones, rechazos, creaciones,
          modificaciones, envios de evaluaciones, cambios de estado, feedback, contrataciones y mas.
          Cada registro incluye quien realizo la accion, cuando, desde que IP, y los detalles del cambio.
        </p>
      </div>

      <div style={sectionSt}>
        <div style={titleSt}>Que son las acciones con evidencia legal?</div>
        <p style={textSt}>
          Las acciones marcadas con el icono de escudo son aquellas con valor probatorio:
          aprobaciones/rechazos de objetivos, evaluaciones enviadas, check-ins completados,
          decisiones de talento, contrataciones/rechazos de candidatos, y cambios de rol.
          Estas acciones no pueden ser modificadas ni eliminadas retroactivamente.
        </p>
      </div>

      <div style={sectionSt}>
        <div style={titleSt}>Como exportar para uso legal?</div>
        <p style={textSt}>
          Use el boton &quot;Exportar CSV&quot; para descargar un archivo con todos los registros del rango
          de fechas seleccionado. El archivo incluye todos los campos: fecha, usuario, email, accion,
          entidad, detalle, IP y si es evidencia legal. El formato es compatible con Excel y herramientas de compliance.
        </p>
      </div>

      <div style={sectionSt}>
        <div style={titleSt}>Retencion de datos</div>
        <p style={textSt}>
          Los registros de auditoria se mantienen indefinidamente mientras la suscripcion este activa.
          No se eliminan al desactivar usuarios o completar ciclos de evaluacion.
        </p>
      </div>

      <div>
        <div style={titleSt}>Auditoria laboral</div>
        <p style={textSt}>
          Si necesita un informe para una auditoria laboral o proceso legal, exporte el rango de fechas
          relevante con el filtro &quot;Solo evidencia legal&quot; activado. El CSV resultante contiene toda
          la trazabilidad necesaria: quien, que, cuando, desde donde y por que.
        </p>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────── */

export default function AuditoriaPage() {
  const token = useAuthStore((s) => s.token);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const limit = 25;

  // filters
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [evidenceOnly, setEvidenceOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search text by 400ms
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(searchText);
      setPage(1);
    }, 400);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchText]);

  const fetchLogs = useCallback(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    const filters: Record<string, any> = { page, limit };
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    if (entityType) filters.entityType = entityType;
    if (actionFilter) filters.action = actionFilter;
    if (debouncedSearch) filters.searchText = debouncedSearch;
    if (evidenceOnly) filters.evidenceOnly = true;
    api.auditLogs.tenant(token, filters)
      .then((res: any) => {
        setLogs(Array.isArray(res) ? res : res.data || []);
        setTotal(res.total || 0);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, page, dateFrom, dateTo, entityType, actionFilter, debouncedSearch, evidenceOnly]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const handleExport = async () => {
    if (!token) return;
    setExporting(true);
    try {
      const blob = await api.auditLogs.exportCsv(token, {
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        entityType: entityType || undefined,
        action: actionFilter || undefined,
        evidenceOnly: evidenceOnly || undefined,
        searchText: debouncedSearch || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'auditoria_' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (_e) {
      setError('Error al exportar CSV');
    } finally {
      setExporting(false);
    }
  };

  const resetFilters = () => {
    setDateFrom('');
    setDateTo('');
    setEntityType('');
    setActionFilter('');
    setSearchText('');
    setDebouncedSearch('');
    setEvidenceOnly(false);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const inputSt = {
    padding: '0.5rem 0.7rem',
    fontSize: '0.83rem',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-primary)',
    transition: 'var(--transition)',
  } as const;

  const selectSt = { ...inputSt, cursor: 'pointer' } as const;

  /* shield icon for evidence */
  const shieldIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );

  /* expand chevron */
  const chevron = (expanded: boolean) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', color: 'var(--text-muted)' }}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Registro de Auditoria</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Historial de acciones y evidencia de su organizacion</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" style={{ padding: '0.45rem 0.9rem', fontSize: '0.83rem' }} onClick={() => setGuideOpen((v) => !v)}>
            {guideOpen ? 'Cerrar guia' : 'Como funciona'}
          </button>
          <button
            className="btn-primary"
            style={{ padding: '0.45rem 1rem', fontSize: '0.83rem' }}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? 'Exportando...' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* Guide */}
      <GuidePanel open={guideOpen} onToggle={() => setGuideOpen(false)} />

      {/* Filters */}
      <div className="animate-fade-up" style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" style={{ ...inputSt, width: '145px' }} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="Fecha desde" />
        <input type="date" style={{ ...inputSt, width: '145px' }} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="Fecha hasta" />

        <select style={{ ...selectSt, width: '180px' }} value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
          {ENTITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <select style={{ ...selectSt, width: '180px' }} value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
          {ACTION_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <input
          style={{ ...inputSt, width: '180px' }}
          placeholder="Buscar por usuario..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={evidenceOnly} onChange={(e) => { setEvidenceOnly(e.target.checked); setPage(1); }} />
          Solo evidencia legal
        </label>

        {(dateFrom || dateTo || entityType || actionFilter || searchText || evidenceOnly) && (
          <button className="btn-ghost" style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }} onClick={resetFilters}>Limpiar</button>
        )}

        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {total} registros
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <Spinner />
      ) : (
        <div className="card animate-fade-up-delay-1" style={{ padding: 0 }}>
          {logs.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {(dateFrom || dateTo || entityType || actionFilter || searchText || evidenceOnly)
                ? 'No se encontraron registros con los filtros seleccionados'
                : 'Aun no hay registros de auditoria'}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '28px' }}></th>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th>Accion</th>
                    <th>Entidad</th>
                    <th>Detalle</th>
                    <th style={{ width: '36px', textAlign: 'center' }}>Ev.</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => {
                    const badge = getActionBadge(log.action);
                    const isExpanded = expandedId === (log.id || log.createdAt);
                    const rowKey = log.id || log.createdAt;
                    return (
                      <Fragment key={rowKey}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : rowKey)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td style={{ textAlign: 'center', padding: '0.5rem 0.35rem' }}>{chevron(isExpanded)}</td>
                          <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {new Date(log.createdAt).toLocaleDateString('es-CL')}{' '}
                            {new Date(log.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td style={{ fontSize: '0.84rem' }}>
                            {log.userName || 'Sistema'}
                          </td>
                          <td>
                            <span className={'badge ' + badge.cls} style={{ fontSize: '0.76rem' }}>
                              {formatAction(log.action)}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                            {formatEntity(log.entityType) || '-'}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatMetadata(log.metadata)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {log.isEvidence ? shieldIcon : null}
                          </td>
                        </tr>
                        {isExpanded && <DetailPanel log={log} />}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="animate-fade-up-delay-2" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
          <button className="btn-ghost" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Pagina {page} de {totalPages}
          </span>
          <button className="btn-ghost" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}

