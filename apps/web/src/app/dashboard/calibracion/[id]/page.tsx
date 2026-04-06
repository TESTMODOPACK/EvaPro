'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { calibrationEntryStatusLabel as STATUS_LABEL, calibrationEntryStatusBadge as STATUS_BADGE } from '@/lib/statusMaps';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const FALLBACK_CAUSALS = [
  'Ajuste por desempeño real observado',
  'Consideración de circunstancias excepcionales',
  'Alineación con el equipo',
  'Contexto adicional del período evaluado',
  'Inconsistencia en la autoevaluación',
  'Reconocimiento de logros no capturados',
  'Criterio del comité calibrador',
];

const STATUS_ROW_ACCENT: Record<string, string> = {
  pending: 'var(--warning)',
  discussed: 'var(--accent)',
  agreed: 'var(--success)',
  adjusted: 'var(--accent)',
  approved: 'var(--success)',
};

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function ScoreDelta({ original, adjusted }: { original: number | null; adjusted: number | '' }) {
  const orig = original ?? null;
  const adj = adjusted === '' ? null : Number(adjusted);
  if (orig === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const delta = adj !== null ? adj - orig : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{Number(orig).toFixed(1)}</span>
      {adj !== null && delta !== 0 && (
        <span style={{
          fontSize: '0.72rem', fontWeight: 700,
          color: delta > 0 ? 'var(--success)' : 'var(--danger)',
          background: delta > 0 ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
          padding: '0.1rem 0.3rem', borderRadius: '4px',
        }}>
          {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)}
        </span>
      )}
    </div>
  );
}

export default function CalibracionDetailPage({ params }: { params: { id: string } }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);

  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [populating, setPopulating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [editState, setEditState] = useState<Record<string, {
    adjustedScore: number | '';
    adjustedPotential: number | '';
    rationale: string;
    rationaleType: string;
  }>>({});
  const [savingEntry, setSavingEntry] = useState<string | null>(null);

  // Preview & selection before populate
  const [previewUsers, setPreviewUsers] = useState<any[] | null>(null);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Add entry after populate
  const [showAddEntry, setShowAddEntry] = useState(false);
  const [addEntrySearch, setAddEntrySearch] = useState('');
  const [addingEntryId, setAddingEntryId] = useState<string | null>(null);

  // Distribution analysis
  const [distribution, setDistribution] = useState<any>(null);

  // Filters & grouping
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [collapsedDepts, setCollapsedDepts] = useState<Set<string>>(new Set());
  const [causals, setCausals] = useState<string[]>(FALLBACK_CAUSALS);

  // "Otro" is always appended in the UI, not stored in the list
  const CAUSALS = [...causals, 'Otro'];
  const presetCausals = causals;

  async function fetchSession(activeCausals?: string[]) {
    if (!token) return;
    const useCausals = activeCausals ?? causals;
    setLoading(true);
    try {
      const data = await api.talent.calibration.detail(token, params.id);
      setSession(data);
      const es: typeof editState = {};
      if (data.entries) {
        for (const entry of data.entries) {
          const r = entry.rationale ?? '';
          let rationaleType = '';
          if (!r) {
            rationaleType = '';
          } else if (useCausals.includes(r)) {
            rationaleType = r;
          } else {
            rationaleType = 'Otro';
          }
          es[entry.id] = {
            adjustedScore: entry.adjustedScore ?? entry.originalScore ?? '',
            adjustedPotential: entry.adjustedPotential ?? entry.originalPotential ?? '',
            rationale: r,
            rationaleType,
          };
        }
      }
      setEditState(es);
      // Load distribution analysis if session has entries
      if (data.entries && data.entries.length > 0) {
        api.talent.calibration.getDistribution(token, params.id)
          .then((dist) => setDistribution(dist))
          .catch(() => setDistribution(null));
      }
    } catch { setSession(null); }
    setLoading(false);
  }

  // Load tenant causals then session data together
  useEffect(() => {
    if (!token) return;
    api.tenants.getCustomSetting(token, 'calibrationCausals')
      .then((data) => {
        const loaded = Array.isArray(data) && data.length > 0 ? data : FALLBACK_CAUSALS;
        setCausals(loaded);
        return loaded;
      })
      .catch(() => FALLBACK_CAUSALS)
      .then((resolved) => fetchSession(resolved));
  }, [token, params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleLoadPreview() {
    if (!token) return;
    setLoadingPreview(true);
    try {
      const users = await api.talent.calibration.preview(token, params.id);
      setPreviewUsers(users);
      setExcludedIds(new Set());
    } catch { setPreviewUsers([]); }
    setLoadingPreview(false);
  }

  async function handlePopulate() {
    if (!token) return;
    setPopulating(true);
    try {
      const excluded = Array.from(excludedIds);
      await api.talent.calibration.populate(token, params.id, excluded.length > 0 ? excluded : undefined);
      setPreviewUsers(null);
      await fetchSession();
    } catch { /* ignore */ }
    setPopulating(false);
  }

  async function handleAddEntry(userId: string) {
    if (!token) return;
    setAddingEntryId(userId);
    try {
      await api.talent.calibration.addEntry(token, params.id, userId);
      setAddEntrySearch('');
      setShowAddEntry(false);
      await fetchSession();
    } catch { /* ignore */ }
    setAddingEntryId(null);
  }

  async function handleRemoveEntry(entryId: string, name: string) {
    if (!token || !confirm(`¿Quitar a ${name} de esta sesión de calibración?`)) return;
    try {
      await api.talent.calibration.removeEntry(token, entryId);
      await fetchSession();
    } catch { /* ignore */ }
  }

  async function handleSaveEntry(entryId: string) {
    if (!token) return;
    const e = editState[entryId];
    if (!e) return;
    setSavingEntry(entryId);
    try {
      await api.talent.calibration.updateEntry(token, entryId, {
        adjustedScore: e.adjustedScore === '' ? null : Number(e.adjustedScore),
        adjustedPotential: e.adjustedPotential === '' ? null : Number(e.adjustedPotential),
        rationale: e.rationaleType === 'Otro' ? e.rationale : e.rationaleType,
      });
      await fetchSession();
    } catch { /* ignore */ }
    setSavingEntry(null);
  }

  async function handleComplete() {
    if (!token) return;
    setCompleting(true);
    try {
      await api.talent.calibration.complete(token, params.id);
      await fetchSession();
      setSuccessMsg(t('calibracionDetalle.successMsg'));
      setTimeout(() => setSuccessMsg(''), 5000);
    } catch { /* ignore */ }
    setCompleting(false);
  }

  function updateEntry(entryId: string, field: string, value: any) {
    setEditState((prev) => ({ ...prev, [entryId]: { ...prev[entryId], [field]: value } }));
  }

  function toggleDept(dept: string) {
    setCollapsedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept); else next.add(dept);
      return next;
    });
  }

  if (!token) return null;
  if (loading) return <Spinner />;
  if (!session) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          {t('calibracionDetalle.notFound')}
        </div>
      </div>
    );
  }

  const entries: any[] = session.entries || [];
  const isReadOnly = session.status === 'completed';

  // Stats
  const totalEntries = entries.length;
  const pendingCount = entries.filter((e) => e.status === 'pending').length;
  const adjustedCount = entries.filter((e) => e.status !== 'pending').length;
  const progressPct = totalEntries > 0 ? Math.round((adjustedCount / totalEntries) * 100) : 0;

  // Filter
  const filtered = entries.filter((e) => {
    const u = e.user || {};
    const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
    const q = search.toLowerCase();
    const matchSearch = !q || name.includes(q) || (u.department || '').toLowerCase().includes(q) || (u.position || '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || e.status === statusFilter;
    return matchSearch && matchStatus;
  });

  // Group by department
  const deptOrder: string[] = [];
  const grouped: Record<string, any[]> = {};
  for (const e of filtered) {
    const dept = e.user?.department || t('calibracionDetalle.noDept');
    if (!grouped[dept]) { grouped[dept] = []; deptOrder.push(dept); }
    grouped[dept].push(e);
  }

  const colCount = isReadOnly ? 6 : 7;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1300px' }}>
    <div className="animate-fade-up">

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{session.name}</h1>
            <span className={`badge ${STATUS_BADGE[session.status] || 'badge-accent'}`}>
              {STATUS_LABEL[session.status] || session.status}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
            {session.cycle && <span>{t('calibracionDetalle.cycle')} <strong>{session.cycle.name}</strong></span>}
            {session.department && <span>{t('calibracionDetalle.department')} <strong>{session.department}</strong></span>}
            {session.moderator && <span>{t('calibracionDetalle.moderator')} <strong>{session.moderator.firstName} {session.moderator.lastName}</strong></span>}
          </div>
        </div>
        {entries.length > 0 && session.status === 'in_progress' && (
          <button className="btn-primary" onClick={handleComplete} disabled={completing}
            style={{ background: 'var(--success)', padding: '.6rem 1.5rem', flexShrink: 0 }}>
            {completing ? t('calibracionDetalle.completing') : t('calibracionDetalle.completeBtn')}
          </button>
        )}
      </div>

      {/* Progress summary */}
      {entries.length > 0 && (
        <div className="card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', flex: 1 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{totalEntries}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('calibracionDetalle.statsTotal')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--warning)' }}>{pendingCount}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('calibracionDetalle.statsPending')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>{adjustedCount}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('calibracionDetalle.statsReviewed')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{deptOrder.length || Object.keys(grouped).length || new Set(entries.map((e) => e.user?.department || t('calibracionDetalle.noDept'))).size}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('calibracionDetalle.statsDepts')}</div>
              </div>
            </div>
            <div style={{ flex: 2, minWidth: '200px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('calibracionDetalle.progressLabel')}</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: progressPct === 100 ? 'var(--success)' : 'var(--accent)' }}>{progressPct}%</span>
              </div>
              <div style={{ height: '8px', background: 'var(--bg-surface)', borderRadius: '999px', overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: progressPct === 100 ? 'var(--success)' : 'var(--accent)', borderRadius: '999px', transition: 'width 0.5s ease' }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notices */}
      {isReadOnly && (
        <div className="card" style={{ padding: '0.875rem 1rem', background: 'rgba(245,158,11,0.08)', borderLeft: '4px solid var(--warning)', marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            {t('calibracionDetalle.readOnly')}
          </p>
        </div>
      )}
      {successMsg && (
        <div className="card animate-fade-up" style={{ background: 'var(--success)', color: '#fff', marginBottom: '1rem', padding: '.75rem 1rem', fontWeight: 600 }}>
          {successMsg}
        </div>
      )}

      {/* Empty state — preview & select before populating */}
      {entries.length === 0 && !isReadOnly && (
        <div className="card" style={{ padding: '1.5rem' }}>
          {!previewUsers ? (
            // Step 1: Show button to load preview
            <div style={{ textAlign: 'center', padding: '1.5rem' }}>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('calibracionDetalle.emptyState')}</p>
              <button className="btn-primary" onClick={handleLoadPreview} disabled={loadingPreview}>
                {loadingPreview ? 'Cargando...' : 'Ver colaboradores disponibles'}
              </button>
            </div>
          ) : previewUsers.length === 0 ? (
            // No users available
            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)' }}>
              No hay colaboradores con evaluación de talento para este ciclo. Primero genere las evaluaciones en la sección de Talento.
            </div>
          ) : (
            // Step 2: Preview with selection
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div>
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>Seleccionar colaboradores a calibrar</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>
                    {previewUsers.length} disponible{previewUsers.length !== 1 ? 's' : ''} · {previewUsers.length - excludedIds.size} seleccionado{previewUsers.length - excludedIds.size !== 1 ? 's' : ''}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setExcludedIds(new Set())}>
                    Seleccionar todos
                  </button>
                  <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setExcludedIds(new Set(previewUsers.map((u: any) => u.userId)))}>
                    Deseleccionar todos
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
                {previewUsers.map((u: any) => {
                  const excluded = excludedIds.has(u.userId);
                  return (
                    <label key={u.userId} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', background: excluded ? 'transparent' : 'rgba(99,102,241,0.05)' }}>
                      <input type="checkbox" checked={!excluded} style={{ accentColor: 'var(--accent)' }}
                        onChange={() => {
                          const next = new Set(excludedIds);
                          if (excluded) next.delete(u.userId); else next.add(u.userId);
                          setExcludedIds(next);
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: excluded ? 400 : 600, color: excluded ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                          {u.firstName} {u.lastName}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          {[u.position, u.department].filter(Boolean).join(' · ')}{u.performanceScore != null ? ` · Puntaje: ${Number(u.performanceScore).toFixed(1)}` : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button className="btn-ghost" onClick={() => setPreviewUsers(null)}>Cancelar</button>
                <button className="btn-primary" onClick={handlePopulate} disabled={populating || previewUsers.length - excludedIds.size === 0}>
                  {populating ? 'Cargando...' : `Cargar ${previewUsers.length - excludedIds.size} colaborador${previewUsers.length - excludedIds.size !== 1 ? 'es' : ''}`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {entries.length === 0 && isReadOnly && (
        <div className="card" style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)' }}>
          Esta sesión no tiene participantes.
        </div>
      )}

      {/* Filter bar */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="input"
            type="text"
            placeholder={t('calibracionDetalle.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: '220px', fontSize: '0.875rem' }}
          />
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ fontSize: '0.875rem', minWidth: '160px' }}
          >
            <option value="all">{t('calibracionDetalle.allStatuses')}</option>
            <option value="pending">{t('calibracionDetalle.filterPending')}</option>
            <option value="discussed">{t('calibracionDetalle.filterDiscussed')}</option>
            <option value="agreed">{t('calibracionDetalle.filterAgreed')}</option>
            <option value="adjusted">{t('calibracionDetalle.filterAdjusted')}</option>
            <option value="approved">{t('calibracionDetalle.filterApproved')}</option>
          </select>
          {(search || statusFilter !== 'all') && (
            <button className="btn-ghost" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}
              onClick={() => { setSearch(''); setStatusFilter('all'); }}>
              {t('common.clearFilters')}
            </button>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setCollapsedDepts(new Set())}>
              {t('calibracionDetalle.expandAll')}
            </button>
            <button className="btn-ghost" style={{ fontSize: '0.78rem' }}
              onClick={() => setCollapsedDepts(new Set(deptOrder))}>
              {t('calibracionDetalle.collapseAll')}
            </button>
          </div>
          {/* Add collaborator button */}
          {!isReadOnly && (
            <button className="btn-ghost" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }} onClick={() => setShowAddEntry(!showAddEntry)}>
              {showAddEntry ? 'Cerrar' : '+ Agregar colaborador'}
            </button>
          )}
        </div>
      )}

      {/* Add entry search */}
      {showAddEntry && !isReadOnly && entries.length > 0 && (
        <div className="card" style={{ padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>Buscar colaborador para agregar a la sesión:</p>
          <input className="input" placeholder="Buscar por nombre..." value={addEntrySearch} onChange={(e) => setAddEntrySearch(e.target.value)} style={{ fontSize: '0.82rem', marginBottom: '0.4rem' }} />
          {addEntrySearch.trim() && (() => {
            const q = addEntrySearch.toLowerCase();
            const existingIds = new Set(entries.map((e: any) => e.userId));
            // Search all users from session data (we don't have a full user list here, but we can use preview)
            return (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={async () => {
                  if (!token) return;
                  try {
                    const preview = await api.talent.calibration.preview(token, params.id);
                    const filtered = preview.filter((u: any) => !existingIds.has(u.userId) && `${u.firstName} ${u.lastName}`.toLowerCase().includes(q));
                    if (filtered.length === 0) { alert('No se encontraron colaboradores disponibles con ese nombre'); return; }
                    if (filtered.length === 1) { await handleAddEntry(filtered[0].userId); return; }
                    const names = filtered.map((u: any) => `${u.firstName} ${u.lastName} (${u.department || 'Sin depto.'})`).join('\n');
                    const idx = prompt(`Se encontraron ${filtered.length} resultados:\n${names}\n\nEscribe el número (1-${filtered.length}) para agregar:`);
                    if (idx && filtered[Number(idx) - 1]) { await handleAddEntry(filtered[Number(idx) - 1].userId); }
                  } catch { alert('Error al buscar'); }
                }}>
                  Buscar y agregar
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Grouped table */}
      {entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {deptOrder.length === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              {t('calibracionDetalle.noFilterResults')}
            </div>
          )}

          {deptOrder.map((dept) => {
            const deptEntries = grouped[dept];
            const isCollapsed = collapsedDepts.has(dept);
            const deptPending = deptEntries.filter((e) => e.status === 'pending').length;
            const deptAdjusted = deptEntries.length - deptPending;
            const deptPct = deptEntries.length > 0 ? Math.round((deptAdjusted / deptEntries.length) * 100) : 0;

            return (
              <div key={dept} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                {/* Department header */}
                <div
                  onClick={() => toggleDept(dept)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.875rem 1.25rem',
                    background: 'var(--bg-surface)',
                    borderBottom: isCollapsed ? 'none' : '1px solid var(--border)',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                >
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{dept}</span>
                  <span className="badge badge-ghost" style={{ fontSize: '0.72rem' }}>{deptEntries.length} persona{deptEntries.length !== 1 ? 's' : ''}</span>
                  {deptPending > 0 && <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>{deptPending} pendiente{deptPending !== 1 ? 's' : ''}</span>}
                  {deptPct === 100 && <span className="badge badge-success" style={{ fontSize: '0.72rem' }}>{t('calibracionDetalle.deptCompleted')}</span>}
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
                    <div style={{ flex: 1, height: '5px', background: 'var(--border)', borderRadius: '999px', overflow: 'hidden' }}>
                      <div style={{ width: `${deptPct}%`, height: '100%', background: deptPct === 100 ? 'var(--success)' : 'var(--accent)', borderRadius: '999px' }} />
                    </div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', minWidth: '28px', textAlign: 'right' }}>{deptPct}%</span>
                  </div>
                </div>

                {/* Entries table */}
                {!isCollapsed && (
                  <div className="table-wrapper" style={{ margin: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>{t('calibracionDetalle.colUser')}</th>
                          <th style={{ whiteSpace: 'nowrap' }}>{t('calibracionDetalle.colPerformance')}</th>
                          <th style={{ whiteSpace: 'nowrap' }}>{t('calibracionDetalle.colPotential')}</th>
                          <th>{t('calibracionDetalle.colCausal')}</th>
                          <th>{t('calibracionDetalle.colStatus')}</th>
                          {!isReadOnly && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {deptEntries.map((entry: any) => {
                          const u = entry.user || {};
                          const es = editState[entry.id] || { adjustedScore: '', adjustedPotential: '', rationale: '', rationaleType: '' };
                          const isSaving = savingEntry === entry.id;
                          const rowAccent = STATUS_ROW_ACCENT[entry.status] || 'var(--border)';

                          return (
                            <tr key={entry.id} style={{ borderLeft: `3px solid ${rowAccent}` }}>
                              {/* Colaborador */}
                              <td>
                                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{u.firstName} {u.lastName}</div>
                                {u.position && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{u.position}</div>}
                              </td>

                              {/* Desempeño: original → ajustado */}
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <ScoreDelta original={entry.originalScore} adjusted={es.adjustedScore} />
                                  <input
                                    className="input"
                                    type="number" min={0} max={10} step={0.5}
                                    value={es.adjustedScore}
                                    disabled={isReadOnly}
                                    onChange={(e) => updateEntry(entry.id, 'adjustedScore', e.target.value === '' ? '' : +e.target.value)}
                                    style={{ width: '80px', fontSize: '0.95rem', textAlign: 'center', opacity: isReadOnly ? 0.7 : 1, cursor: isReadOnly ? 'not-allowed' : undefined }}
                                  />
                                </div>
                              </td>

                              {/* Potencial: original → ajustado */}
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <ScoreDelta original={entry.originalPotential} adjusted={es.adjustedPotential} />
                                  <input
                                    className="input"
                                    type="number" min={0} max={10} step={0.5}
                                    value={es.adjustedPotential}
                                    disabled={isReadOnly}
                                    onChange={(e) => updateEntry(entry.id, 'adjustedPotential', e.target.value === '' ? '' : +e.target.value)}
                                    style={{ width: '80px', fontSize: '0.95rem', textAlign: 'center', opacity: isReadOnly ? 0.7 : 1, cursor: isReadOnly ? 'not-allowed' : undefined }}
                                  />
                                </div>
                              </td>

                              {/* Causal */}
                              <td>
                                <div style={{ minWidth: '200px' }}>
                                  <select
                                    className="input"
                                    value={es.rationaleType}
                                    disabled={isReadOnly}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setEditState((prev) => ({
                                        ...prev,
                                        [entry.id]: {
                                          ...prev[entry.id],
                                          rationaleType: v,
                                          rationale: v !== 'Otro' ? v : prev[entry.id].rationale,
                                        },
                                      }));
                                    }}
                                    style={{ width: '100%', fontSize: '0.85rem', opacity: isReadOnly ? 0.7 : 1, cursor: isReadOnly ? 'not-allowed' : undefined }}
                                  >
                                    <option value="">{t('calibracionDetalle.selectCausal')}</option>
                                    {CAUSALS.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                  {es.rationaleType === 'Otro' && (
                                    <input
                                      className="input"
                                      type="text"
                                      value={es.rationale}
                                      disabled={isReadOnly}
                                      onChange={(e) => updateEntry(entry.id, 'rationale', e.target.value)}
                                      placeholder={t('calibracionDetalle.otherCausalPlaceholder')}
                                      style={{ marginTop: '4px', width: '100%', fontSize: '0.85rem', opacity: isReadOnly ? 0.7 : 1 }}
                                    />
                                  )}
                                </div>
                              </td>

                              {/* Estado */}
                              <td>
                                <span className={`badge ${STATUS_BADGE[entry.status] || 'badge-accent'}`}>
                                  {STATUS_LABEL[entry.status] || entry.status || 'Pendiente'}
                                </span>
                              </td>

                              {/* Acción */}
                              {!isReadOnly && (
                                <td>
                                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                                    <button
                                      className="btn-primary"
                                      onClick={() => handleSaveEntry(entry.id)}
                                      disabled={isSaving}
                                      style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem', whiteSpace: 'nowrap' }}
                                    >
                                      {isSaving ? '...' : 'Guardar'}
                                    </button>
                                    {entry.status === 'pending' && (
                                      <button
                                        className="btn-ghost"
                                        onClick={() => handleRemoveEntry(entry.id, `${u.firstName} ${u.lastName}`)}
                                        style={{ fontSize: '0.72rem', padding: '0.25rem 0.4rem', color: 'var(--danger)' }}
                                        title="Quitar de esta sesión"
                                      >
                                        ✕
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Distribution Analysis */}
      {distribution && distribution.expectedVsActual && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem' }}>{t('calibracionDetalle.distribution.title')}</h3>
            <span className={`badge ${distribution.distributionFit === 'desviada' ? 'badge-danger' : 'badge-success'}`}>
              χ² = {Number(distribution.chiSquared).toFixed(2)} — {distribution.distributionFit === 'desviada' ? t('calibracionDetalle.distribution.deviated') : t('calibracionDetalle.distribution.acceptable')}
            </span>
          </div>
          {distribution.distributionFit === 'desviada' && (
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '1rem' }}>
              {t('calibracionDetalle.distribution.deviatedAlert')}
            </div>
          )}
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={distribution.expectedVsActual} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <YAxis unit="%" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
              <Tooltip formatter={(v: any) => `${v}%`} />
              <Legend />
              <Bar dataKey="actualPercent" name={t('calibracionDetalle.distribution.actual')} fill="var(--accent)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expectedPercent" name={t('calibracionDetalle.distribution.expected')} fill="rgba(99,102,241,0.3)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '1rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('calibracionDetalle.distribution.colBucket')}</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('calibracionDetalle.distribution.colExpected')}</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('calibracionDetalle.distribution.colActual')}</th>
                <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('calibracionDetalle.distribution.colDeviation')}</th>
              </tr>
            </thead>
            <tbody>
              {distribution.expectedVsActual.map((b: any) => (
                <tr key={b.bucket} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.4rem 0.6rem' }}>{b.bucket}</td>
                  <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{Number(b.expectedPercent).toFixed(1)}%</td>
                  <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{Number(b.actualPercent).toFixed(1)}%</td>
                  <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right', color: Math.abs(b.deviation) > 5 ? 'var(--danger)' : 'var(--text-secondary)', fontWeight: Math.abs(b.deviation) > 5 ? 700 : 400 }}>
                    {b.deviation > 0 ? `+${Number(b.deviation).toFixed(1)}` : Number(b.deviation).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

    </div>
    </div>
  );
}
