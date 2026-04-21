'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { useRequireRole } from '@/hooks/useRequireRole';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import SignatureModal, { SignatureBadge } from '@/components/SignatureModal';

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  pending_signature: '#f59e0b',
  active: '#10b981',
  expired: '#ef4444',
  superseded: '#6366f1',
};

export default function ContratosPage() {
  // P11 audit tenant_admin — guard defensivo: backend @Roles(super_admin, tenant_admin).
  const authorized = useRequireRole(['super_admin', 'tenant_admin']);
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const [contracts, setContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [signModal, setSignModal] = useState<{ documentType: string; documentId: string; documentName: string } | null>(null);
  const [signatureMap, setSignatureMap] = useState<Record<string, any[]>>({});
  const toast = useToastStore((s) => s.toast);
  const isSuperAdmin = role === 'super_admin';

  // Super admin: create contract form
  const [showCreate, setShowCreate] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [tenants, setTenants] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [editingContract, setEditingContract] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [orgFilter, setOrgFilter] = useState('');
  const [queryModal, setQueryModal] = useState<{ contractId: string; contractTitle: string } | null>(null);
  const [queryForm, setQueryForm] = useState({ type: 'question', message: '' });
  const [querySubmitting, setQuerySubmitting] = useState(false);
  // Reject state
  const [rejectModal, setRejectModal] = useState<{ contractId: string; contractTitle: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [createForm, setCreateForm] = useState({
    tenantId: '', type: 'service_agreement', title: '', description: '', content: '', effectiveDate: new Date().toISOString().split('T')[0],
  });

  const loadData = () => {
    if (!token) return;
    const listCall = isSuperAdmin && orgFilter
      ? api.contracts.listByTenant(token, orgFilter)
      : api.contracts.list(token);
    listCall.then(setContracts).catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
    if (isSuperAdmin) {
      api.contracts.getTemplates(token).then(setTemplates).catch(() => {});
      api.tenants.list(token).then(setTenants).catch(() => {});
    }
  };

  useEffect(() => { loadData(); }, [token, orgFilter]);

  // Load signatures for each contract
  useEffect(() => {
    if (!token || contracts.length === 0) return;
    const loadSigs = async () => {
      const map: Record<string, any[]> = {};
      for (const c of contracts) {
        try {
          const sigs = await api.signatures.list(token, 'contract', c.id);
          if (sigs.length > 0) map[c.id] = sigs;
        } catch { /* ignore */ }
      }
      setSignatureMap(map);
    };
    loadSigs();
  }, [token, contracts]);

  // P11 audit — bloquear render si no autorizado (useRequireRole ya disparó redirect).
  if (!authorized) return null;
  if (loading) return <PageSkeleton cards={2} tableRows={5} />;
  if (error) return (
    <div style={{ padding: '2rem 2.5rem' }}>
      <div className="card" style={{ padding: '2rem', textAlign: 'center', borderLeft: '4px solid var(--danger)' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('common.errorLoading')}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{error}</p>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('contracts.title')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('contracts.subtitle')}
          </p>
        </div>
        {isSuperAdmin && (
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)} style={{ fontSize: '0.85rem' }}>
            {showCreate ? t('common.cancel') : '+ Crear Contrato'}
          </button>
        )}
      </div>

      {/* SA: Organization filter */}
      {isSuperAdmin && tenants.length > 0 && (
        <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
          <select className="input" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)}
            style={{ maxWidth: '350px', fontSize: '0.85rem' }}>
            <option value="">Todas las organizaciones ({contracts.length} contratos)</option>
            {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}

      {/* Guide */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('contracts.guide.title')}</h3>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Qué documentos encontrará aquí?</p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li><strong>Contrato de Servicios:</strong> Alcance del servicio, precio, plazo, obligaciones de ambas partes</li>
              <li><strong>DPA (Procesamiento de Datos):</strong> Cumplimiento de la Ley 19.628, datos tratados, medidas de seguridad, subprocesadores</li>
              <li><strong>Términos y Condiciones:</strong> Reglas de uso aceptable, propiedad intelectual, limitaciones</li>
              <li><strong>Política de Privacidad:</strong> Qué datos se recolectan, cómo se usan, derechos del titular</li>
              <li><strong>SLA:</strong> Disponibilidad del servicio (99.5%), tiempos de respuesta, compensaciones</li>
              <li><strong>NDA:</strong> Protección de información confidencial de ambas partes</li>
            </ul>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Firma electrónica</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
              Los contratos se firman con código OTP enviado a su correo. La firma genera un hash SHA-256 del documento como evidencia de integridad. Registra: quién firmó, cuándo, desde qué IP. Una vez firmado, el contrato queda vigente y no puede modificarse.
            </p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Acceso:</strong> Los administradores de la organización pueden ver y firmar contratos. Ambas partes (Eva360 y su organización) pueden consultar los documentos firmados en cualquier momento.
          </div>
        </div>
      )}

      {/* Create contracts — super_admin only */}
      {showCreate && isSuperAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>Crear Contratos para una Organización</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Seleccione la organización y se crearán automáticamente los 6 contratos base (Servicios, DPA, Términos, Privacidad, SLA, NDA) con contenido legal pre-cargado y el nombre de la organización. Los contratos quedan como borrador para su revisión antes de enviar a firma.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '250px' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>Organización *</label>
              <select value={createForm.tenantId} onChange={(e) => setCreateForm(f => ({ ...f, tenantId: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                <option value="">— Seleccionar organización —</option>
                {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name} {t.rut ? `(${t.rut})` : ''}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={creating || !createForm.tenantId}
              onClick={async () => {
                if (!token || !createForm.tenantId) return;
                setCreating(true);
                setActionError(null);
                try {
                  const result = await api.contracts.bulkCreate(token, createForm.tenantId);
                  setShowCreate(false);
                  setCreateForm(f => ({ ...f, tenantId: '' }));
                  loadData();
                  if (result.created === 0) setActionError('Todos los contratos ya existen para esta organización.');
                } catch (e: any) { setActionError(e.message); }
                setCreating(false);
              }}
              style={{ fontSize: '0.85rem', opacity: !createForm.tenantId ? 0.5 : 1 }}>
              {creating ? 'Creando...' : 'Crear Contratos Base'}
            </button>
            <button className="btn-ghost" onClick={() => setShowCreate(false)} style={{ fontSize: '0.85rem' }}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Inline error messages */}
      {actionError && (
        <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--danger)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.1rem', padding: '0 0.3rem' }}>&times;</button>
        </div>
      )}

      {/* Contracts list */}
      {contracts.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('contracts.noContracts')}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.5rem' }}>{t('contracts.noContractsHint')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {contracts.map((c: any) => {
            const statusColor = STATUS_COLORS[c.status] || STATUS_COLORS.draft;
            const statusLabel = t(`contracts.statuses.${c.status}`, { defaultValue: c.status });
            const isExpanded = expandedId === c.id;
            const sigs = signatureMap[c.id] || [];
            const canSign = c.status === 'pending_signature' && role === 'tenant_admin';

            return (
              <div key={c.id} className="card animate-fade-up" style={{ overflow: 'hidden', padding: 0 }}>
                {/* Header */}
                <button type="button" onClick={() => setExpandedId(isExpanded ? null : c.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: isExpanded ? 'var(--bg-secondary)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '8px', background: `${statusColor}15`, color: statusColor, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>
                      {c.type === 'service_agreement' ? '📋' : c.type === 'dpa' ? '🔒' : c.type === 'nda' ? '🤝' : c.type === 'sla' ? '⚡' : '📄'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{c.title}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {isSuperAdmin && c.tenant?.name && <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{c.tenant.name}</span>}
                        <span>{t(`contracts.types.${c.type}`, { defaultValue: c.type })}</span>
                        <span>· v{c.version}</span>
                        {c.effectiveDate && <span>· Desde {new Date(c.effectiveDate).toLocaleDateString('es-CL')}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {sigs.length > 0 && <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600 }}>{t('contracts.signed')}</span>}
                    <span style={{ padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, background: `${statusColor}15`, color: statusColor }}>
                      {statusLabel}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</span>
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border)' }}>
                    {c.description && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>{c.description}</p>}

                    {/* Contract content — view or edit mode */}
                    {c.content && editingContract !== c.id && (
                      <div style={{ maxHeight: '400px', overflowY: 'auto', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '0.82rem', lineHeight: 1.7, color: 'var(--text-secondary)', marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>
                        {c.content}
                      </div>
                    )}
                    {editingContract === c.id && (
                      <div style={{ marginBottom: '1rem' }}>
                        <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)}
                          rows={16}
                          style={{ width: '100%', padding: '0.75rem', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem', lineHeight: 1.7, fontFamily: 'inherit', resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                          <button className="btn-primary" disabled={savingEdit}
                            onClick={async () => {
                              if (!token) return;
                              setSavingEdit(true);
                              try {
                                await api.contracts.update(token, c.id, { content: editContent });
                                setEditingContract(null);
                                loadData();
                              } catch (e: any) { setActionError(e.message); }
                              setSavingEdit(false);
                            }}
                            style={{ fontSize: '0.82rem' }}>
                            {savingEdit ? t('common.saving') : 'Guardar Borrador'}
                          </button>
                          <button className="btn-ghost" onClick={() => setEditingContract(null)} style={{ fontSize: '0.82rem' }}>
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                    {!c.content && c.status === 'draft' && (
                      <p style={{ fontSize: '0.82rem', color: 'var(--warning)', marginBottom: '1rem' }}>
                        Este contrato no tiene contenido. Edite el borrador antes de enviar a firma.
                      </p>
                    )}

                    {c.fileUrl && (
                      <a href={c.fileUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost" style={{ fontSize: '0.82rem', marginBottom: '1rem', display: 'inline-block' }}>
                        {t('contracts.downloadAttachment')}
                      </a>
                    )}

                    {/* Signatures */}
                    {sigs.length > 0 && (
                      <div style={{ marginBottom: '1rem' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>{t('contracts.signatures')}</div>
                        <SignatureBadge signatures={sigs} />
                      </div>
                    )}

                    {/* Super admin: draft actions */}
                    {isSuperAdmin && c.status === 'draft' && editingContract !== c.id && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <button className="btn-ghost"
                          onClick={() => { setEditingContract(c.id); setEditContent(c.content || ''); }}
                          style={{ fontSize: '0.82rem' }}>
                          Editar Borrador
                        </button>
                        {c.content && (
                          <button className="btn-primary"
                            disabled={sending === c.id}
                            onClick={async () => {
                              if (!token) return;
                              setSending(c.id);
                              try {
                                await api.contracts.sendForSignature(token, c.id);
                                setActionError(null);
                                loadData();
                              } catch (e: any) { setActionError(e.message); }
                              setSending(null);
                            }}
                            style={{ fontSize: '0.82rem' }}>
                            {sending === c.id ? 'Enviando...' : 'Enviar a Firma'}
                          </button>
                        )}
                        <button
                          disabled={deleting === c.id}
                          onClick={async () => {
                            if (!token || !confirm(`¿Eliminar "${c.title}"? Esta acción no se puede deshacer.`)) return;
                            setDeleting(c.id);
                            setActionError(null);
                            try {
                              await api.contracts.remove(token, c.id);
                              loadData();
                            } catch (e: any) { setActionError(e.message); }
                            setDeleting(null);
                          }}
                          style={{ background: 'none', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm, 6px)', padding: '0.35rem 0.75rem', fontSize: '0.82rem', color: 'var(--danger)', cursor: deleting === c.id ? 'wait' : 'pointer', opacity: deleting === c.id ? 0.5 : 1 }}>
                          {deleting === c.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    )}

                    {/* Rejection info — show if contract was previously rejected */}
                    {c.rejectionReason && (
                      <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(239,68,68,0.06)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.15)', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
                        <div style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: '0.2rem' }}>Contrato rechazado</div>
                        <div style={{ color: 'var(--text-secondary)' }}>{c.rejectionReason}</div>
                        {c.rejectedAt && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{new Date(c.rejectedAt).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}</div>}
                      </div>
                    )}

                    {/* Status history timeline */}
                    {Array.isArray(c.statusHistory) && c.statusHistory.length > 0 && (
                      <details style={{ marginBottom: '0.75rem', fontSize: '0.78rem' }}>
                        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontWeight: 600 }}>Historial de estados ({c.statusHistory.length})</summary>
                        <div style={{ marginTop: '0.35rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                          {c.statusHistory.map((h: any, idx: number) => (
                            <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', padding: '0.15rem 0', borderBottom: '1px solid var(--border)' }}>
                              <span style={{
                                fontSize: '0.7rem', fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                                background: h.status === 'rejected' ? 'rgba(239,68,68,0.1)' : h.status === 'active' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                                color: h.status === 'rejected' ? 'var(--danger)' : h.status === 'active' ? 'var(--success)' : 'var(--warning)',
                              }}>
                                {h.status === 'pending_signature' ? 'Enviado a firma' : h.status === 'rejected' ? 'Rechazado' : h.status === 'active' ? 'Firmado' : h.status}
                              </span>
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{new Date(h.date).toLocaleDateString('es-CL')}</span>
                              {h.reason && <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontStyle: 'italic' }}>— {h.reason}</span>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Sign + Reject buttons — tenant_admin */}
                    {canSign && sigs.length === 0 && (
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                        <button className="btn-primary" onClick={() => setSignModal({ documentType: 'contract', documentId: c.id, documentName: c.title })}
                          style={{ fontSize: '0.85rem' }}>
                          {t('contracts.signContract')}
                        </button>
                        <button
                          onClick={() => { setRejectModal({ contractId: c.id, contractTitle: c.title }); setRejectReason(''); }}
                          style={{ background: 'none', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm, 6px)', padding: '0.35rem 0.75rem', fontSize: '0.82rem', color: 'var(--danger)', cursor: 'pointer' }}>
                          Rechazar
                        </button>
                      </div>
                    )}

                    {/* Download PDF */}
                    {c.content && (
                      <button className="btn-ghost" style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}
                        onClick={async () => {
                          if (!token) return;
                          try {
                            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/contracts/${c.id}/pdf`, {
                              headers: { Authorization: `Bearer ${token}` },
                            });
                            if (!res.ok) throw new Error('Error al generar PDF');
                            const blob = await res.blob();
                            const a = document.createElement('a');
                            a.href = URL.createObjectURL(blob);
                            a.download = `contrato-${c.title?.replace(/[^a-zA-Z0-9]/g, '-') || c.id.slice(0, 8)}.pdf`;
                            a.click();
                            URL.revokeObjectURL(a.href);
                          } catch (e: any) { toast(e.message || 'Error al descargar', 'error'); }
                        }}>
                        {'📄'} Descargar PDF
                      </button>
                    )}

                    {/* Admin: Query/request button */}
                    {role === 'tenant_admin' && (
                      <button className="btn-ghost" style={{ fontSize: '0.82rem', marginTop: '0.5rem' }}
                        onClick={() => { setQueryModal({ contractId: c.id, contractTitle: c.title }); setQueryForm({ type: 'question', message: '' }); }}>
                        {'💬'} Enviar consulta o solicitud
                      </button>
                    )}

                    {/* Contract metadata */}
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                      {c.effectiveDate && <span>{t('contracts.effectiveDate')}: {new Date(c.effectiveDate).toLocaleDateString('es-CL')}</span>}
                      {c.expirationDate && <span>{t('contracts.expirationDate')}: {new Date(c.expirationDate).toLocaleDateString('es-CL')}</span>}
                      <span>{t('contracts.version')}: {c.version}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Signature Modal */}
      {signModal && (
        <SignatureModal
          documentType={signModal.documentType}
          documentId={signModal.documentId}
          documentName={signModal.documentName}
          onCancel={() => setSignModal(null)}
          onSigned={() => {
            setSignModal(null);
            loadData(); // Respects orgFilter
          }}
        />
      )}

      {/* Admin: Query modal */}
      {queryModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '500px', width: '95%' }}>
            <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>Enviar consulta sobre contrato</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              <strong>{queryModal.contractTitle}</strong>
            </p>

            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Tipo de solicitud</label>
              <select className="input" value={queryForm.type} onChange={(e) => setQueryForm({ ...queryForm, type: e.target.value })} style={{ width: '100%' }}>
                <option value="question">Consulta general</option>
                <option value="modification">Solicitud de modificación</option>
                <option value="renewal">Solicitud de renovación</option>
                <option value="cancellation">Solicitud de cancelación</option>
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>Mensaje</label>
              <textarea className="input" rows={4} placeholder="Describa su consulta o solicitud..."
                value={queryForm.message} onChange={(e) => setQueryForm({ ...queryForm, message: e.target.value })}
                style={{ width: '100%', resize: 'vertical' }} />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setQueryModal(null)}>Cancelar</button>
              <button className="btn-primary" disabled={!queryForm.message.trim() || querySubmitting}
                onClick={async () => {
                  if (!token || !queryForm.message.trim()) return;
                  setQuerySubmitting(true);
                  try {
                    await api.contracts.submitQuery(token, queryModal.contractId, { type: queryForm.type, message: queryForm.message.trim() });
                    setQueryModal(null);
                    toast('Consulta enviada al administrador del sistema', 'success');
                  } catch (e: any) {
                    toast(e.message || 'Error al enviar consulta', 'error');
                  }
                  setQuerySubmitting(false);
                }}>
                {querySubmitting ? 'Enviando...' : 'Enviar consulta'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Reject Modal */}
      {rejectModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '500px', width: '90%' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--danger)' }}>
              Rechazar contrato
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              <strong>{rejectModal.contractTitle}</strong>
            </p>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
              Al rechazar, el contrato volverá al estado borrador y se notificará al administrador del sistema para que realice los cambios necesarios.
            </p>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                Motivo del rechazo *
              </label>
              <textarea className="input" rows={3} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explique el motivo del rechazo o los cambios que solicita..." style={{ resize: 'vertical', fontSize: '0.82rem' }} />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                disabled={rejecting || !rejectReason.trim()}
                onClick={async () => {
                  if (!token || !rejectReason.trim()) return;
                  setRejecting(true);
                  try {
                    await api.contracts.reject(token, rejectModal.contractId, rejectReason.trim());
                    toast('Contrato rechazado. Se notificó al administrador del sistema.', 'success');
                    setRejectModal(null); setRejectReason('');
                    loadData();
                  } catch (e: any) {
                    toast(e.message || 'Error al rechazar', 'error');
                  }
                  setRejecting(false);
                }}
                style={{ background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm, 6px)', padding: '0.45rem 1rem', fontSize: '0.82rem', cursor: rejecting ? 'wait' : 'pointer', opacity: rejecting || !rejectReason.trim() ? 0.5 : 1 }}>
                {rejecting ? 'Rechazando...' : 'Confirmar rechazo'}
              </button>
              <button className="btn-ghost" onClick={() => setRejectModal(null)} style={{ fontSize: '0.82rem' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
