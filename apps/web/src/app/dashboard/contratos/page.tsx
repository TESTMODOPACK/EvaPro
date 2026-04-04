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

  useEffect(() => {
    if (!token) return;
    api.contracts.list(token)
      .then(setContracts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

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
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('contracts.title')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('contracts.subtitle')}
        </p>
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

                    {/* Contract content preview */}
                    {c.content && (
                      <div style={{ maxHeight: '300px', overflowY: 'auto', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px', fontSize: '0.82rem', lineHeight: 1.7, color: 'var(--text-secondary)', marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>
                        {c.content}
                      </div>
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

                    {/* Sign button */}
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
