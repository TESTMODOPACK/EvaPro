'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
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
  const [createForm, setCreateForm] = useState({
    tenantId: '', type: 'service_agreement', title: '', description: '', content: '', effectiveDate: new Date().toISOString().split('T')[0],
  });

  const loadData = () => {
    if (!token) return;
    api.contracts.list(token).then(setContracts).catch((e) => setError(e.message)).finally(() => setLoading(false));
    if (isSuperAdmin) {
      api.contracts.getTemplates(token).then(setTemplates).catch(() => {});
      api.tenants.list(token).then(setTenants).catch(() => {});
    }
  };

  useEffect(() => { loadData(); }, [token]);

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
            <strong style={{ color: 'var(--accent)' }}>Acceso:</strong> Los administradores de la organización pueden ver y firmar contratos. Ambas partes (Ascenda y su organización) pueden consultar los documentos firmados en cualquier momento.
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
                setError('');
                try {
                  const result = await api.contracts.bulkCreate(token, createForm.tenantId);
                  setShowCreate(false);
                  setCreateForm(f => ({ ...f, tenantId: '' }));
                  loadData();
                  if (result.created === 0) setError('Todos los contratos ya existen para esta organización.');
                } catch (e: any) { setError(e.message); }
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
                              } catch (e: any) { setError(e.message); }
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
                                loadData();
                              } catch (e: any) { setError(e.message); }
                              setSending(null);
                            }}
                            style={{ fontSize: '0.82rem' }}>
                            {sending === c.id ? 'Enviando...' : 'Enviar a Firma'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Sign button — tenant_admin */}
                    {canSign && sigs.length === 0 && (
                      <button className="btn-primary" onClick={() => setSignModal({ documentType: 'contract', documentId: c.id, documentName: c.title })}
                        style={{ fontSize: '0.85rem' }}>
                        {t('contracts.signContract')}
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
            // Reload contracts and signatures
            if (token) {
              api.contracts.list(token).then(setContracts).catch(() => {});
            }
          }}
        />
      )}
    </div>
  );
}
