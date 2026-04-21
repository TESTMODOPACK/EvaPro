'use client';

/**
 * /dashboard/leads — panel de gestión del pipeline pre-venta de Ascenda.
 *
 * Solo visible para super_admin. Muestra los leads capturados desde los
 * forms públicos (ascenda.cl + eva360.ascenda.cl), con filtros por estado,
 * detalle al clickear y form de actualización.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { useRequireRole } from '@/hooks/useRequireRole';
import { useToastStore } from '@/store/toast.store';

type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'discarded';

interface Lead {
  id: string;
  name: string;
  company: string;
  role: string | null;
  email: string;
  phone: string;
  companySize: string | null;
  industry: string | null;
  region: string | null;
  source: string | null;
  message: string;
  origin: string;
  ipAddress: string | null;
  captchaVerdict: string;
  status: LeadStatus;
  internalNotes: string | null;
  assignedTo: string | null;
  assignee: { id: string; firstName: string; lastName: string } | null;
  statusChangedAt: string | null;
  convertedTenantId: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_META: Record<LeadStatus, { label: string; color: string; bg: string }> = {
  new:       { label: 'Nuevo',       color: '#1d4ed8', bg: 'rgba(29,78,216,0.12)' },
  contacted: { label: 'Contactado',  color: '#8A6318', bg: 'rgba(201,147,58,0.15)' },
  qualified: { label: 'Calificado',  color: '#047857', bg: 'rgba(4,120,87,0.12)' },
  converted: { label: 'Convertido',  color: '#065F46', bg: 'rgba(16,185,129,0.15)' },
  discarded: { label: 'Descartado',  color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
};

const STATUS_ORDER: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'discarded'];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-CL', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'hace instantes';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return formatDate(iso);
}

// P8-C: paginación client-side. El endpoint del backend aún no paginará
// (pipeline de ventas chico), pero evita un DOM gigante si un período de
// tráfico alto genera 200+ leads. Al hacer backend-side paging en v3.0,
// reemplazar el slice por llamadas con page param.
const LEADS_PAGE_SIZE = 50;

export default function LeadsPage() {
  // P11 audit tenant_admin — guard defensivo super_admin-only.
  // Pipeline pre-venta de Ascenda (leads capturados de forms públicos).
  const authorized = useRequireRole(['super_admin']);

  const token = useAuthStore((s) => s.token);
  const toast = useToastStore((s) => s.toast);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Record<LeadStatus, number> & { total: number }>({
    new: 0, contacted: 0, qualified: 0, converted: 0, discarded: 0, total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<LeadStatus | 'all'>('all');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editedStatus, setEditedStatus] = useState<LeadStatus>('new');
  const [editedNotes, setEditedNotes] = useState('');
  const [page, setPage] = useState(1);

  // Reset page cuando cambia filtro.
  useEffect(() => { setPage(1); }, [filterStatus]);

  useEffect(() => {
    if (!token) return;
    load();
  }, [token, filterStatus]);

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        api.leads.list(token, filterStatus === 'all' ? undefined : { status: filterStatus }),
        api.leads.getStats(token),
      ]);
      setLeads(listRes as Lead[]);
      setStats(statsRes as any);
    } catch (err: any) {
      toast(err?.message || 'No se pudieron cargar los leads', 'error');
    } finally {
      setLoading(false);
    }
  }

  function openDetail(lead: Lead) {
    setSelected(lead);
    setEditedStatus(lead.status);
    setEditedNotes(lead.internalNotes || '');
  }

  async function saveChanges() {
    if (!selected || !token) return;
    setSavingId(selected.id);
    try {
      await api.leads.update(token, selected.id, {
        status: editedStatus,
        internalNotes: editedNotes,
      });
      toast('Lead actualizado', 'success');
      setSelected(null);
      await load();
    } catch (err: any) {
      toast(err?.message || 'Error al guardar', 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function deleteLead(id: string) {
    if (!token) return;
    if (!window.confirm('¿Descartar este lead definitivamente? Esta acción no se puede deshacer.')) return;
    try {
      await api.leads.remove(token, id);
      toast('Lead eliminado', 'success');
      if (selected?.id === id) setSelected(null);
      await load();
    } catch (err: any) {
      toast(err?.message || 'Error al eliminar', 'error');
    }
  }

  const filtered = useMemo(() => {
    if (filterStatus === 'all') return leads;
    return leads.filter((l) => l.status === filterStatus);
  }, [leads, filterStatus]);

  // P8-C: slice para paginar sin cambiar el resto del código del render.
  const totalPages = Math.max(1, Math.ceil(filtered.length / LEADS_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginatedLeads = useMemo(() => {
    const start = (safePage - 1) * LEADS_PAGE_SIZE;
    return filtered.slice(start, start + LEADS_PAGE_SIZE);
  }, [filtered, safePage]);

  // P11 audit — bloquear render si no autorizado (useRequireRole ya disparó redirect).
  if (!authorized) return null;

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Leads de Ascenda</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '0.35rem 0 0', fontSize: '0.9rem' }}>
            Pipeline pre-venta — prospects captados desde ascenda.cl y eva360.ascenda.cl
          </p>
        </div>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : '↻ Refrescar'}
        </button>
      </div>

      {/* Stats tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <StatTile label="Total" value={stats.total} active={filterStatus === 'all'} onClick={() => setFilterStatus('all')} />
        {STATUS_ORDER.map((s) => (
          <StatTile
            key={s}
            label={STATUS_META[s].label}
            value={stats[s]}
            color={STATUS_META[s].color}
            bg={STATUS_META[s].bg}
            active={filterStatus === s}
            onClick={() => setFilterStatus(s)}
          />
        ))}
      </div>

      {/* Lista */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando leads…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {filterStatus === 'all' ? 'No hay leads todavía.' : `No hay leads en estado "${STATUS_META[filterStatus as LeadStatus]?.label}".`}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}>
                  <th style={thStyle}>Empresa / Contacto</th>
                  <th style={thStyle}>Email / Teléfono</th>
                  <th style={thStyle}>Industria · Región</th>
                  <th style={thStyle}>Estado</th>
                  <th style={thStyle}>Recibido</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {paginatedLeads.map((l) => (
                  <tr
                    key={l.id}
                    style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(201,147,58,0.04)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    onClick={() => openDetail(l)}
                  >
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{l.company}</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                        {l.name}{l.role ? ` · ${l.role}` : ''}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: '0.85rem' }}>{l.email}</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{l.phone}</div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: '0.85rem' }}>{l.industry || '—'}</div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{l.region || '—'}</div>
                    </td>
                    <td style={tdStyle}>
                      <StatusBadge status={l.status} />
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontSize: '0.85rem' }}>{timeAgo(l.createdAt)}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{l.origin}</div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn-ghost"
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.82rem' }}
                        onClick={(e) => { e.stopPropagation(); openDetail(l); }}
                      >
                        Ver detalle
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* P8-C: paginación solo visible si excede 1 página. */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '0.75rem 1rem', borderTop: '1px solid var(--border)',
                fontSize: '0.82rem', color: 'var(--text-muted)',
              }}>
                <span>
                  Mostrando {(safePage - 1) * LEADS_PAGE_SIZE + 1}–{Math.min(safePage * LEADS_PAGE_SIZE, filtered.length)} de {filtered.length}
                </span>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button
                    className="btn-ghost btn-compact"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    aria-label="Página anterior"
                  >
                    ← Anterior
                  </button>
                  <span style={{ fontWeight: 600 }}>
                    {safePage} / {totalPages}
                  </span>
                  <button
                    className="btn-ghost btn-compact"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    aria-label="Página siguiente"
                  >
                    Siguiente →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal de detalle */}
      {selected && (
        <LeadDetailModal
          lead={selected}
          editedStatus={editedStatus}
          editedNotes={editedNotes}
          saving={savingId === selected.id}
          onClose={() => setSelected(null)}
          onChangeStatus={setEditedStatus}
          onChangeNotes={setEditedNotes}
          onSave={saveChanges}
          onDelete={() => deleteLead(selected.id)}
        />
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.75rem 1rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '0.9rem 1rem',
  verticalAlign: 'top',
};

function StatTile({ label, value, color, bg, active, onClick }: {
  label: string; value: number; color?: string; bg?: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? (bg || 'rgba(201,147,58,0.14)') : 'var(--bg-card)',
        border: `1px solid ${active ? (color || 'var(--gold)') : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        padding: '0.85rem 1rem',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: color || 'var(--text-muted)' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.65rem', fontWeight: 700, color: color || 'var(--text-primary)', marginTop: '0.25rem' }}>
        {value}
      </div>
    </button>
  );
}

function StatusBadge({ status }: { status: LeadStatus }) {
  const meta = STATUS_META[status];
  return (
    <span style={{
      display: 'inline-block',
      padding: '0.22rem 0.7rem',
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      color: meta.color,
      background: meta.bg,
      borderRadius: 999,
    }}>
      {meta.label}
    </span>
  );
}

function LeadDetailModal(props: {
  lead: Lead;
  editedStatus: LeadStatus;
  editedNotes: string;
  saving: boolean;
  onClose: () => void;
  onChangeStatus: (s: LeadStatus) => void;
  onChangeNotes: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { lead, editedStatus, editedNotes, saving, onClose, onChangeStatus, onChangeNotes, onSave, onDelete } = props;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)', padding: '1rem',
      }}
    >
      <div className="card" style={{
        display: 'flex', flexDirection: 'column',
        width: 720, maxWidth: '100%', maxHeight: '90vh',
        padding: 0, overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0, position: 'relative' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Cerrar"
            style={{
              position: 'absolute', top: '0.9rem', right: '0.9rem',
              width: 28, height: 28, borderRadius: '50%', border: 'none',
              background: 'transparent', fontSize: '1.3rem', cursor: saving ? 'not-allowed' : 'pointer',
              color: 'var(--text-muted)',
            }}
          >×</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.3rem' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0, paddingRight: '2.5rem' }}>{lead.company}</h3>
            <StatusBadge status={lead.status} />
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>
            {lead.name}{lead.role ? ` · ${lead.role}` : ''} · Recibido {timeAgo(lead.createdAt)}
          </p>
        </div>

        {/* Body */}
        <div style={{ flex: '1 1 auto', overflowY: 'auto', padding: '1.5rem 1.75rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <InfoRow label="Email"    value={<a href={`mailto:${lead.email}`} style={{ color: 'var(--accent)' }}>{lead.email}</a>} />
            <InfoRow label="Teléfono" value={<a href={`tel:${lead.phone}`} style={{ color: 'var(--accent)' }}>{lead.phone}</a>} />
            <InfoRow label="Tamaño"   value={lead.companySize || '—'} />
            <InfoRow label="Industria" value={lead.industry || '—'} />
            <InfoRow label="Región"   value={lead.region || '—'} />
            <InfoRow label="Fuente"   value={lead.source || '—'} />
            <InfoRow label="Origen"   value={lead.origin} />
            <InfoRow label="CAPTCHA"  value={lead.captchaVerdict} />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={labelStyle}>Mensaje del lead</label>
            <div style={{
              padding: '1rem 1.2rem',
              background: 'rgba(201,147,58,0.05)',
              border: '1px solid rgba(201,147,58,0.2)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.92rem',
              lineHeight: 1.6,
              whiteSpace: 'pre-wrap',
              color: 'var(--text-primary)',
            }}>{lead.message}</div>
          </div>

          <div style={{ marginBottom: '1.2rem' }}>
            <label style={labelStyle}>Estado del pipeline</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={saving}
                  onClick={() => onChangeStatus(s)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    borderRadius: 999,
                    border: `1px solid ${editedStatus === s ? STATUS_META[s].color : 'var(--border)'}`,
                    background: editedStatus === s ? STATUS_META[s].bg : 'transparent',
                    color: editedStatus === s ? STATUS_META[s].color : 'var(--text-secondary)',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="lead-notes" style={labelStyle}>Notas internas (solo equipo Ascenda)</label>
            <textarea
              id="lead-notes"
              className="input"
              rows={4}
              value={editedNotes}
              onChange={(e) => onChangeNotes(e.target.value)}
              disabled={saving}
              placeholder="Ej: llamado el 18/04 a las 15h, pidió propuesta para 80 colaboradores en plan Pro..."
              maxLength={5000}
              style={{ width: '100%', resize: 'vertical', minHeight: 90 }}
            />
            <div style={{ textAlign: 'right', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {editedNotes.length}/5000
            </div>
          </div>

          {lead.ipAddress && (
            <details style={{ marginTop: '1.5rem' }}>
              <summary style={{ fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                Metadata técnica
              </summary>
              <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-hover)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                <div><strong>Lead ID:</strong> {lead.id}</div>
                <div><strong>IP:</strong> {lead.ipAddress}</div>
                <div><strong>Creado:</strong> {formatDate(lead.createdAt)}</div>
                <div><strong>Actualizado:</strong> {formatDate(lead.updatedAt)}</div>
                {lead.statusChangedAt && <div><strong>Status cambiado:</strong> {formatDate(lead.statusChangedAt)}</div>}
              </div>
            </details>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '1rem 1.75rem 1.25rem',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: '0.75rem',
          alignItems: 'center', flexWrap: 'wrap',
          flexShrink: 0,
        }}>
          <button
            type="button"
            className="btn-primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            style={{
              padding: '0.55rem 1rem',
              fontSize: '0.85rem',
              background: 'transparent',
              color: '#B5452C',
              border: '1px solid rgba(181,69,44,0.35)',
              borderRadius: 999,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Eliminar lead
          </button>
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.72rem',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.5rem',
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}
