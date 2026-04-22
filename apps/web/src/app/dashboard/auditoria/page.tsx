'use client';

import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState, useCallback, useRef, Fragment } from 'react';
import { useTranslation } from 'react-i18next';
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
  failed:    { cls: 'badge-danger',  label: 'Fallo' },
  denied:    { cls: 'badge-danger',  label: 'Acceso denegado' },
  error:     { cls: 'badge-danger',  label: 'Error' },
};

const FULL_ACTION_BADGES: Record<string, { cls: string; label: string }> = {
  'cron.failed':         { cls: 'badge-danger', label: 'Cron fallido' },
  'notification.failed': { cls: 'badge-danger', label: 'Notificación fallida' },
  'access.denied':       { cls: 'badge-danger', label: 'Acceso denegado' },
  'system.error':        { cls: 'badge-danger', label: 'Error de sistema' },
};

function getActionBadge(action: string): { cls: string; label: string } {
  // Exact full-action match first (e.g. 'cron.failed')
  if (FULL_ACTION_BADGES[action]) return FULL_ACTION_BADGES[action];
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

/* ─── Filter keys (values sent to API) ─────────────────────────── */

const ENTITY_TYPE_KEYS = [
  '', 'objective', 'cycle', 'checkin', 'feedback', 'competency',
  'development_plan', 'talent_assessment', 'calibration_entry',
  'user', 'engagement_survey', 'recruitment_process', 'subscription', 'report',
];

const ACTION_TYPE_KEYS = [
  '', 'login', 'created', 'approved', 'rejected', 'submitted',
  'completed', 'updated', 'launched', 'viewed',
  'cron.failed', 'notification.failed', 'access.denied', 'system.error',
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

function DetailPanel(props: { log: any; t: any }) {
  const { log, t } = props;
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '0.75rem 2rem',
  } as const;

  const labelSt = { fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.15rem', fontSize: '0.78rem' } as const;
  const valSt = { fontSize: '0.82rem' } as const;

  return (
    <tr>
      <td colSpan={7} style={{ padding: 0 }}>
        <div style={detailStyle}>
          <div>
            <div style={labelSt}>{t('audit.exactDateTime')}</div>
            <div style={valSt}>{new Date(log.createdAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })}</div>
          </div>
          <div>
            <div style={labelSt}>{t('audit.sourceIp')}</div>
            <div style={valSt}>{log.ipAddress || t('audit.notRecorded')}</div>
          </div>
          <div>
            <div style={labelSt}>{t('audit.user')}</div>
            <div style={valSt}>{log.userName || t('audit.system')} {log.userEmail ? '(' + log.userEmail + ')' : ''}</div>
          </div>
          <div>
            <div style={labelSt}>{t('audit.entityId')}</div>
            <div style={{ ...valSt, fontFamily: 'monospace', fontSize: '0.78rem' }}>{log.entityId || '-'}</div>
          </div>
          {meta && (
            <div style={{ gridColumn: '1 / -1' }}>
              <div style={labelSt}>{t('audit.fullMetadata')}</div>
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

function GuidePanel(props: { open: boolean; onToggle: () => void; t: any }) {
  if (!props.open) return null;
  const { t } = props;

  const sectionSt = { marginBottom: '1rem' } as const;
  const titleSt = { fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.35rem' } as const;
  const textSt = { fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 } as const;

  return (
    <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.25rem', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{t('audit.guideTitle')}</h3>
        <button className="btn-ghost" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={props.onToggle}>{t('audit.guideClose')}</button>
      </div>
      <div style={sectionSt}>
        <div style={titleSt}>{t('audit.guideWhatTitle')}</div>
        <p style={textSt}>{t('audit.guideWhatText')}</p>
      </div>
      <div style={sectionSt}>
        <div style={titleSt}>{t('audit.guideEvidenceTitle')}</div>
        <p style={textSt}>{t('audit.guideEvidenceText')}</p>
      </div>
      <div style={sectionSt}>
        <div style={titleSt}>{t('audit.guideExportTitle')}</div>
        <p style={textSt}>{t('audit.guideExportText')}</p>
      </div>
      <div style={sectionSt}>
        <div style={titleSt}>{t('audit.guideRetentionTitle')}</div>
        <p style={textSt}>{t('audit.guideRetentionText')}</p>
      </div>
      <div>
        <div style={titleSt}>{t('audit.guideLaborTitle')}</div>
        <p style={textSt}>{t('audit.guideLaborText')}</p>
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────── */

/* ─── AI Usage Log Tab ──────────────────────────────────────── */

function AiUsageTab() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role) || '';
  const isSuperAdmin = role === 'super_admin';
  const [data, setData] = useState<any>(null);
  const [quota, setQuota] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const LIMIT = 25;
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

  // Load tenants list for super_admin filter
  useEffect(() => {
    if (!token || !isSuperAdmin) return;
    fetch(`${BASE_URL}/tenants`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(setTenants).catch(() => []);
  }, [token, isSuperAdmin]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const tenantParam = isSuperAdmin && selectedTenantId ? `&tenantId=${selectedTenantId}` : '';
    Promise.all([
      fetch(`${BASE_URL}/ai/usage-log?page=${page}&limit=${LIMIT}${tenantParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json()),
      !isSuperAdmin ? fetch(`${BASE_URL}/ai/usage`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.ok ? r.json() : null) : Promise.resolve(null),
    ]).then(([d, q]) => { setData(d); setQuota(q); })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token, page, isSuperAdmin, selectedTenantId]);

  if (loading) return <Spinner />;
  if (!data) return <p style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>No se pudo cargar el registro de uso IA</p>;

  const totalPages = Math.max(1, Math.ceil((data.total || 0) / LIMIT));

  return (
    <div>
      {/* SuperAdmin: Organization filter */}
      {isSuperAdmin && tenants.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
            Filtrar por organización
          </label>
          <select className="input" value={selectedTenantId} onChange={(e) => { setSelectedTenantId(e.target.value); setPage(1); }}
            style={{ maxWidth: '400px', width: '100%' }}>
            <option value="">Todas las organizaciones</option>
            {tenants.map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: isSuperAdmin ? 'repeat(auto-fit, minmax(155px, 1fr))' : 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.25rem' }}>Total ejecuciones</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent)' }}>{data.total || 0}</div>
        </div>
        {isSuperAdmin && (
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.25rem' }}>Tokens consumidos</div>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#6366f1' }}>{(data.totalTokens || 0).toLocaleString()}</div>
          </div>
        )}
        {!isSuperAdmin && quota && (
          <>
            <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.25rem' }}>Usados este período</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent)' }}>{quota.monthlyUsed || 0}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>de {quota.monthlyLimit || 0}</div>
            </div>
            <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.25rem' }}>Créditos restantes</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: (quota.monthlyRemaining || 0) <= 0 ? 'var(--danger)' : 'var(--success)' }}>
                {quota.monthlyRemaining || 0}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Plan: {quota?.planLimit || 0} {(quota?.addonRemaining ?? 0) > 0 ? `+ ${quota.addonRemaining} addon` : ''}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {(!data.data || data.data.length === 0) ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin registros de uso de IA</div>
        ) : (
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>#</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tipo de informe</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Usuario</th>
                  {isSuperAdmin && <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tokens</th>}
                </tr>
              </thead>
              <tbody>
                {data.data.map((r: any, i: number) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{(page - 1) * LIMIT + i + 1}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {new Date(r.createdAt).toLocaleDateString('es-CL')} {new Date(r.createdAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span className="badge badge-accent" style={{ fontSize: '0.72rem' }}>{r.typeLabel}</span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      {r.userName ? (
                        <div>
                          <div style={{ fontWeight: 500 }}>{r.userName}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.userEmail}</div>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Sistema</span>}
                    </td>
                    {isSuperAdmin && (
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        {(r.tokensUsed || 0).toLocaleString()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Anterior</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Página {page} de {totalPages}</span>
          <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Siguiente</button>
        </div>
      )}
    </div>
  );
}

/* ─── Main Audit Page ──────────────────────────────────────── */

function AuditoriaPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role) || '';
  const isSuperAdmin = role === 'super_admin';
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
  const [activeAuditTab, setActiveAuditTab] = useState<'logs' | 'ai-usage'>('logs');
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

    // super_admin uses /audit-logs (all orgs); tenant_admin uses /audit-logs/tenant
    const apiCall = isSuperAdmin
      ? api.auditLogs.list(token, page, limit, { action: actionFilter || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, entityType: entityType || undefined, searchText: debouncedSearch || undefined })
      : api.auditLogs.tenant(token, filters);

    apiCall
      .then((res: any) => {
        setLogs(Array.isArray(res) ? res : res.data || []);
        setTotal(res.total || 0);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, page, dateFrom, dateTo, entityType, actionFilter, debouncedSearch, evidenceOnly, isSuperAdmin]);

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
      setError(t('audit.exportError'));
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
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('audit.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('audit.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" style={{ padding: '0.45rem 0.9rem', fontSize: '0.83rem' }} onClick={() => setGuideOpen((v) => !v)}>
            {guideOpen ? t('audit.closeGuide') : t('audit.howItWorks')}
          </button>
          <button
            className="btn-primary"
            style={{ padding: '0.45rem 1rem', fontSize: '0.83rem' }}
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? t('audit.exporting') : t('audit.exportCsv')}
          </button>
        </div>
      </div>

      {/* Guide */}
      <GuidePanel open={guideOpen} onToggle={() => setGuideOpen(false)} t={t} />

      {/* Tab bar */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
        {[
          { id: 'logs' as const, label: 'Registro de Auditoría' },
          { id: 'ai-usage' as const, label: 'Uso de IA (Anthropic)' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveAuditTab(tab.id)} style={{
            padding: '0.5rem 1rem', fontSize: '0.82rem', fontWeight: activeAuditTab === tab.id ? 700 : 500,
            color: activeAuditTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)',
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: `2px solid ${activeAuditTab === tab.id ? 'var(--accent)' : 'transparent'}`,
            marginBottom: '-1px',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* AI Usage Tab */}
      {activeAuditTab === 'ai-usage' && <AiUsageTab />}

      {/* Audit Logs Tab */}
      {activeAuditTab !== 'ai-usage' && <>
      {/* Filters */}
      <div className="animate-fade-up" style={{ marginBottom: '1.25rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" style={{ ...inputSt, width: '145px' }} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} title="Fecha desde" />
        <input type="date" style={{ ...inputSt, width: '145px' }} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} title="Fecha hasta" />

        <select style={{ ...selectSt, width: '180px' }} value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }}>
          {ENTITY_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>{k ? t('audit.filterEntities.' + k, k) : t('audit.allEntities')}</option>
          ))}
        </select>

        <select style={{ ...selectSt, width: '180px' }} value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}>
          {ACTION_TYPE_KEYS.map((k) => (
            <option key={k} value={k}>{k ? t('audit.filterActions.' + k, k) : t('audit.allActions')}</option>
          ))}
        </select>

        <input
          style={{ ...inputSt, width: '240px' }}
          placeholder="Buscar (usuario, acción, detalle, ID...)"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          aria-label="Búsqueda full-text en el log de auditoría"
          title="Busca en nombre, email, acción, ID de entidad y dentro de los detalles (metadata JSON)"
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={evidenceOnly} onChange={(e) => { setEvidenceOnly(e.target.checked); setPage(1); }} />
          {t('audit.evidenceOnly')}
        </label>

        {(dateFrom || dateTo || entityType || actionFilter || searchText || evidenceOnly) && (
          <button className="btn-ghost" style={{ padding: '0.35rem 0.7rem', fontSize: '0.78rem' }} onClick={resetFilters}>{t('audit.clearFilters')}</button>
        )}

        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
          {total} {t('audit.records')}
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
                ? t('audit.noResultsFiltered')
                : t('audit.noResults')}
            </div>
          ) : (
            <div className="table-wrapper">
              <table style={{ minWidth: '700px' }}>
                <thead>
                  <tr>
                    <th style={{ width: '28px' }}></th>
                    <th style={{ whiteSpace: 'nowrap' }}>{t('audit.date')}</th>
                    <th style={{ whiteSpace: 'nowrap' }}>{t('audit.user')}</th>
                    <th style={{ whiteSpace: 'nowrap' }}>{t('audit.action')}</th>
                    <th style={{ whiteSpace: 'nowrap' }}>{t('audit.entity')}</th>
                    <th style={{ whiteSpace: 'nowrap' }}>{t('audit.detail')}</th>
                    <th style={{ width: '36px', textAlign: 'center', whiteSpace: 'nowrap' }}>{t('audit.evidence')}</th>
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
                            {log.userName || t('audit.system')}
                          </td>
                          <td>
                            <span className={'badge ' + badge.cls} style={{ fontSize: '0.76rem' }}>
                              {String(t('audit.actions.' + log.action, log.action))}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                            {log.entityType ? String(t('audit.entities.' + log.entityType, log.entityType)) : '-'}
                          </td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatMetadata(log.metadata)}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {log.isEvidence ? shieldIcon : null}
                          </td>
                        </tr>
                        {isExpanded && <DetailPanel log={log} t={t} />}
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
            {t('audit.previous')}
          </button>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {t('audit.page')} {page} {t('audit.of')} {totalPages}
          </span>
          <button className="btn-ghost" style={{ padding: '0.4rem 1rem', fontSize: '0.85rem' }} disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t('audit.next')}
          </button>
        </div>
      )}
      </>}
    </div>
  );
}

export default function AuditoriaPage() {
  return (
    <PlanGate feature="AUDIT_LOG">
      <AuditoriaPageContent />
    </PlanGate>
  );
}
