'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/LoadingSkeleton';

const docTypeLabels: Record<string, string> = {
  evaluation_response: 'Resultado de Evaluación',
  evaluation_cycle: 'Ciclo de Evaluación',
  development_plan: 'Plan de Desarrollo',
  calibration_session: 'Sesión de Calibración',
};

const statusLabels: Record<string, { label: string; color: string }> = {
  valid: { label: 'Válida', color: 'var(--success)' },
  revoked: { label: 'Revocada', color: 'var(--danger)' },
};

function FirmasPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'tenant_admin' || user?.role === 'super_admin';

  const [signatures, setSignatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, { valid: boolean; message: string }>>({});
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showGuide, setShowGuide] = useState(false);
  const PAGE_SIZE = 15;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.signatures.listAll(token)
      .then((data: any) => setSignatures(Array.isArray(data) ? data : []))
      .catch(() => setSignatures([]))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleVerifyIntegrity(signatureId: string) {
    if (!token) return;
    setVerifying(signatureId);
    try {
      const result = await api.signatures.verifyIntegrity(token, signatureId);
      setVerifyResult(prev => ({ ...prev, [signatureId]: result as any }));
    } catch {
      setVerifyResult(prev => ({ ...prev, [signatureId]: { valid: false, message: 'Error al verificar' } }));
    }
    setVerifying(null);
  }

  if (loading) return <PageSkeleton cards={3} tableRows={8} />;

  // Filters
  let filtered = signatures;
  if (searchText) {
    const q = searchText.toLowerCase();
    filtered = filtered.filter((s: any) =>
      (s.documentName || '').toLowerCase().includes(q) ||
      (s.signer?.firstName || '').toLowerCase().includes(q) ||
      (s.signer?.lastName || '').toLowerCase().includes(q)
    );
  }
  if (typeFilter) filtered = filtered.filter((s: any) => s.documentType === typeFilter);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Stats
  const totalSigs = signatures.length;
  const validSigs = signatures.filter((s: any) => s.status === 'valid').length;
  const docTypes = Array.from(new Set(signatures.map((s: any) => s.documentType).filter(Boolean)));

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Firmas Digitales</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Historial de firmas electrónicas de la organización
        </p>
      </div>

      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>Guía: Firmas Digitales</h3>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p><strong>¿Qué muestra?</strong> Historial de documentos firmados digitalmente en la organización (evaluaciones, planes de desarrollo, etc.).</p>
            <p><strong>Proceso de firma:</strong> El sistema envía un código OTP al correo del firmante. El firmante ingresa el código para validar su identidad. Se genera un hash SHA-256 del documento como evidencia.</p>
            <p><strong>Validez:</strong> Cada firma registra: quién firmó, cuándo, desde qué IP, y el hash del documento al momento de la firma. Si el documento se modifica después, el hash no coincidirá.</p>
            <p><strong>Estados:</strong> Válida (documento sin alteraciones), Revocada (firma anulada por administrador).</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong> Cada usuario ve sus propias firmas. Administradores ven todas las firmas de la organización.
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Total Firmas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{totalSigs}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Válidas</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{validSigs}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>Tipos de Documento</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{docTypes.length}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card animate-fade-up" style={{ padding: '1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)', width: '220px' }}
          placeholder="Buscar por documento o firmante..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
        />
        <select
          style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          <option value="">Todos los tipos</option>
          {docTypes.map((t: string) => <option key={t} value={t}>{docTypeLabels[t] || t}</option>)}
        </select>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{filtered.length} firma{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="card animate-fade-up" style={{ padding: 0 }}>
        {paged.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {signatures.length === 0 ? 'No hay firmas registradas en la organización' : 'Sin resultados para los filtros aplicados'}
          </div>
        ) : (
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Documento</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Tipo</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Firmante</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fecha</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Estado</th>
                  {isAdmin && <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Integridad</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((sig: any) => {
                  const st = statusLabels[sig.status] || statusLabels.valid;
                  const vr = verifyResult[sig.id];
                  return (
                    <tr key={sig.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <div style={{ fontWeight: 500 }}>{sig.documentName || 'Sin nombre'}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{sig.documentId?.substring(0, 8)}...</div>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>{docTypeLabels[sig.documentType] || sig.documentType}</span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        {sig.signer ? `${sig.signer.firstName} ${sig.signer.lastName}` : sig.signedBy?.substring(0, 8)}
                        {sig.signerIp && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>IP: {sig.signerIp}</div>}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>
                        {sig.signedAt ? new Date(sig.signedAt).toLocaleString('es-CL') : '—'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span style={{ color: st.color, fontWeight: 600, fontSize: '0.78rem' }}>✍️ {st.label}</span>
                      </td>
                      {isAdmin && (
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          {vr ? (
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: vr.valid ? 'var(--success)' : 'var(--danger)' }}>
                              {vr.valid ? '✅ Íntegro' : '⚠️ Modificado'}
                            </span>
                          ) : (
                            <button className="btn-ghost" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                              onClick={() => handleVerifyIntegrity(sig.id)} disabled={verifying === sig.id}>
                              {verifying === sig.id ? '...' : 'Verificar'}
                            </button>
                          )}
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

export default function FirmasPage() {
  return (
    <PlanGate feature="SIGNATURES">
      <FirmasPageContent />
    </PlanGate>
  );
}
