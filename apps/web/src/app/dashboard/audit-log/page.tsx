'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const actionBadge: Record<string, string> = {
  create: 'badge-success',
  delete: 'badge-danger',
  update: 'badge-accent',
  login: 'badge-warning',
};

export default function AuditLogPage() {
  const token = useAuthStore((s) => s.token);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const limit = 50;

  const fetchLogs = () => {
    if (!token) return;
    setLoading(true);
    setError('');
    api.auditLogs.list(token, page, limit, actionFilter || undefined)
      .then((res: any) => {
        setLogs(Array.isArray(res) ? res : res.data ?? []);
        setTotal(res.total ?? (Array.isArray(res) ? res.length : 0));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchLogs();
  }, [token, page, actionFilter]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Log del Sistema</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Registro de actividad de la plataforma</p>
      </div>

      {/* Filter */}
      <div className="animate-fade-up" style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <input
          style={{
            padding: '0.55rem 0.75rem',
            fontSize: '0.85rem',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)',
            width: '240px',
            transition: 'var(--transition)',
          }}
          placeholder="Filtrar por accion (ej: create, login)"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {total} registros
        </span>
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
        <div className="card animate-fade-up-delay-1" style={{ padding: 0, overflow: 'hidden' }}>
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
                    <th>Usuario ID</th>
                    <th>Organizacion ID</th>
                    <th>Entidad</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any, i: number) => (
                    <tr key={log.id || i}>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.createdAt || log.timestamp).toLocaleDateString('es-ES')}{' '}
                        {new Date(log.createdAt || log.timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`badge ${actionBadge[log.action] ?? 'badge-accent'}`}>
                          {log.action}
                        </span>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.userId ?? '-'}
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {log.tenantId ?? '-'}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        {log.entity ?? log.entityType ?? '-'}
                      </td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
          <button
            className="btn-ghost"
            style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Pagina {page} de {totalPages}
          </span>
          <button
            className="btn-ghost"
            style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
