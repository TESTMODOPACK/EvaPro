'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useRequireRole } from '@/hooks/useRequireRole';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const actionBadge: Record<string, string> = {
  create: 'badge-success',
  created: 'badge-success',
  delete: 'badge-danger',
  deleted: 'badge-danger',
  deactivated: 'badge-danger',
  update: 'badge-accent',
  updated: 'badge-accent',
  login: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
  completed: 'badge-success',
  submitted: 'badge-accent',
  launched: 'badge-warning',
  closed: 'badge-warning',
};

function getActionBadgeClass(action: string): string {
  const key = action.split('.').pop() || action;
  return actionBadge[key] ?? 'badge-accent';
}

const inputStyle: React.CSSProperties = {
  padding: '0.45rem 0.65rem', fontSize: '0.82rem',
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)',
  outline: 'none',
};

export default function AuditLogPage() {
  // P11 audit tenant_admin — guard defensivo super_admin-only.
  // Vista cross-tenant (todos los logs de todas las orgs). Tenant_admin
  // ve el audit de SU tenant en /dashboard/auditoria.
  const authorized = useRequireRole(['super_admin']);

  const token = useAuthStore((s) => s.token);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // Filters
  const [actionFilter, setActionFilter] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [entityType, setEntityType] = useState('');
  const [searchText, setSearchText] = useState('');

  const fetchLogs = () => {
    if (!token) return;
    setLoading(true);
    setError('');
    const filters: any = {};
    if (actionFilter) filters.action = actionFilter;
    if (tenantFilter) filters.tenantId = tenantFilter;
    if (dateFrom) filters.dateFrom = dateFrom;
    if (dateTo) filters.dateTo = dateTo;
    if (entityType) filters.entityType = entityType;
    if (searchText) filters.searchText = searchText;

    api.auditLogs.list(token, page, limit, Object.keys(filters).length > 0 ? filters : undefined)
      .then((res: any) => {
        setLogs(Array.isArray(res) ? res : res.data ?? []);
        setTotal(res.total ?? (Array.isArray(res) ? res.length : 0));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, [token, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyFilters = () => {
    setPage(1);
    fetchLogs();
  };

  const handleClearFilters = () => {
    setActionFilter('');
    setTenantFilter('');
    setDateFrom('');
    setDateTo('');
    setEntityType('');
    setSearchText('');
    setPage(1);
    // Fetch with no filters after state clears
    if (!token) return;
    setLoading(true);
    api.auditLogs.list(token, 1, limit)
      .then((res: any) => {
        setLogs(Array.isArray(res) ? res : res.data ?? []);
        setTotal(res.total ?? (Array.isArray(res) ? res.length : 0));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const hasActiveFilters = actionFilter || tenantFilter || dateFrom || dateTo || entityType || searchText;

  // P11 audit — bloquear render si no autorizado (useRequireRole ya disparó redirect).
  if (!authorized) return null;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1300px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Log del Sistema</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Registro completo de actividad de la plataforma — {total} registros
        </p>
      </div>

      {/* Filters */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Buscar usuario
            </label>
            <input
              style={{ ...inputStyle, width: '100%' }}
              placeholder="Nombres o email"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Accion
            </label>
            <input
              style={{ ...inputStyle, width: '100%' }}
              placeholder="ej: login, create, cycle"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Tipo entidad
            </label>
            <select style={{ ...inputStyle, width: '100%' }} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
              <option value="">Todas</option>
              <option value="User">Usuario</option>
              <option value="cycle">Ciclo</option>
              <option value="evaluation">Evaluacion</option>
              <option value="objective">Objetivo</option>
              <option value="feedback">Feedback</option>
              <option value="checkin">Check-in</option>
              <option value="development_plan">PDI</option>
              <option value="recognition">Reconocimiento</option>
              <option value="survey">Encuesta</option>
              <option value="tenant">Organizacion</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Desde
            </label>
            <input
              type="date"
              style={{ ...inputStyle, width: '100%' }}
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Hasta
            </label>
            <input
              type="date"
              style={{ ...inputStyle, width: '100%' }}
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Org. (Tenant ID)
            </label>
            <input
              style={{ ...inputStyle, width: '100%' }}
              placeholder="UUID del tenant"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn-primary" onClick={handleApplyFilters} style={{ padding: '0.4rem 1rem', fontSize: '0.82rem' }}>
            Aplicar filtros
          </button>
          {hasActiveFilters && (
            <button className="btn-ghost" onClick={handleClearFilters} style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}>
              Limpiar
            </button>
          )}
        </div>
      </div>

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
              Sin registros de auditoria
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Fecha/hora</th>
                    <th>Accion</th>
                    <th>Usuario</th>
                    <th>Entidad</th>
                    <th>Organizacion</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any, i: number) => (
                    <tr key={log.id || i}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt || log.timestamp).toLocaleDateString('es-CL')}{' '}
                        {new Date(log.createdAt || log.timestamp).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`badge ${getActionBadgeClass(log.action)}`} style={{ fontSize: '0.72rem' }}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ fontSize: '0.82rem' }}>
                        {log.userName ? (
                          <div>
                            <div style={{ fontWeight: 500 }}>{log.userName}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{log.userEmail}</div>
                          </div>
                        ) : (
                          <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {log.userId ? log.userId.substring(0, 8) + '...' : 'Sistema'}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {log.entityType || '-'}
                        {log.entityId && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                            {log.entityId.substring(0, 8)}...
                          </div>
                        )}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.tenantId ? log.tenantId.substring(0, 8) + '...' : '-'}
                      </td>
                      <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {log.metadata ? (typeof log.metadata === 'string' ? log.metadata : JSON.stringify(log.metadata)) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="animate-fade-up-delay-2" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
          <button className="btn-ghost" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Anterior
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Pagina {page} de {totalPages}
          </span>
          <button className="btn-ghost" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
