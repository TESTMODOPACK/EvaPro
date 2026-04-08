'use client';
import { PlanGate } from '@/components/PlanGate';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import dynamic from 'next/dynamic';

const SignatureModal = dynamic(() => import('@/components/SignatureModal'), { ssr: false });

/* ── Signature Table Component ────────────────────────────────────── */

function SignatureTable({
  signatures,
  canVerify,
  token,
}: {
  signatures: any[];
  canVerify: boolean;
  token: string | null;
}) {
  const { t } = useTranslation();
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<Record<string, { valid: boolean; message: string }>>({});
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;

  async function handleVerifyIntegrity(signatureId: string) {
    if (!token) return;
    setVerifying(signatureId);
    try {
      const result: any = await api.signatures.verifyIntegrity(token, signatureId);
      setVerifyResult(prev => ({
        ...prev,
        [signatureId]: {
          valid: result.integrity === 'valid',
          message: result.message || (result.integrity === 'valid' ? t('firmas.intact') : t('firmas.modified')),
        },
      }));
    } catch {
      setVerifyResult(prev => ({ ...prev, [signatureId]: { valid: false, message: t('firmas.verifyError') } }));
    }
    setVerifying(null);
  }

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
  const docTypes = Array.from(new Set(signatures.map((s: any) => s.documentType).filter(Boolean)));

  return (
    <>
      {/* Filters */}
      <div className="card" style={{ padding: '1rem', marginBottom: '1.25rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)', width: '220px' }}
          placeholder={t('firmas.searchPlaceholder')}
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(1); }}
        />
        <select
          style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          <option value="">{t('firmas.allTypes')}</option>
          {docTypes.map((dt: string) => <option key={dt} value={dt}>{t(`firmas.docTypeLabel.${dt}`, dt)}</option>)}
        </select>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('firmas.signatureCount', { count: filtered.length })}</span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: 0 }}>
        {paged.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {signatures.length === 0 ? t('firmas.noSignatures') : t('firmas.noResults')}
          </div>
        ) : (
          <div className="table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('firmas.thDocument')}</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('firmas.thType')}</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('firmas.thSigner')}</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('firmas.thDate')}</th>
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('firmas.thStatus')}</th>
                  {canVerify && <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>{t('firmas.thIntegrity')}</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((sig: any) => {
                  const statusColor = sig.status === 'revoked' ? 'var(--danger)' : 'var(--success)';
                  const statusLabel = sig.status === 'revoked' ? t('firmas.statusRevoked') : t('firmas.statusValid');
                  const vr = verifyResult[sig.id];
                  return (
                    <tr key={sig.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <div style={{ fontWeight: 500 }}>{sig.documentName || t('firmas.noName')}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{sig.documentId?.substring(0, 8)}...</div>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>{String(t(`firmas.docTypeLabel.${sig.documentType}`, { defaultValue: sig.documentType }))}</span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        {sig.signer ? `${sig.signer.firstName} ${sig.signer.lastName}` : sig.signedBy?.substring(0, 8)}
                        {sig.signerIp && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>IP: {sig.signerIp}</div>}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>
                        {sig.signedAt ? new Date(sig.signedAt).toLocaleString('es-CL') : '\u2014'}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span style={{ color: statusColor, fontWeight: 600, fontSize: '0.78rem' }}>{statusLabel}</span>
                      </td>
                      {canVerify && (
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          {vr ? (
                            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: vr.valid ? 'var(--success)' : 'var(--danger)' }}>
                              {vr.valid ? t('firmas.intact') : t('firmas.modified')}
                            </span>
                          ) : (
                            <button className="btn-ghost" style={{ fontSize: '0.72rem', padding: '0.2rem 0.5rem' }}
                              onClick={() => handleVerifyIntegrity(sig.id)} disabled={verifying === sig.id}>
                              {verifying === sig.id ? '...' : t('firmas.verifyBtn')}
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
          <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>{t('firmas.prevPage')}</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('firmas.pageOf', { page, total: totalPages })}</span>
          <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>{t('firmas.nextPage')}</button>
        </div>
      )}
    </>
  );
}

/* ── Main Page ────────────────────────────────────────────────────── */

function FirmasPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const role = user?.role || '';
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const isManager = role === 'manager';

  const [mySignatures, setMySignatures] = useState<any[]>([]);
  const [teamSignatures, setTeamSignatures] = useState<any[]>([]);
  const [allSignatures, setAllSignatures] = useState<any[]>([]);
  const [pendingContracts, setPendingContracts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'mine' | 'team' | 'all'>('mine');
  const [showGuide, setShowGuide] = useState(false);
  const [signingContract, setSigningContract] = useState<any | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);

    const promises: Promise<void>[] = [];

    // All roles: own signatures
    promises.push(
      api.signatures.mine(token)
        .then((data: any) => setMySignatures(Array.isArray(data) ? data : []))
        .catch(() => setMySignatures([]))
    );

    // Manager: team signatures
    if (isManager || isAdmin) {
      promises.push(
        api.signatures.team(token)
          .then((data: any) => setTeamSignatures(Array.isArray(data) ? data : []))
          .catch(() => setTeamSignatures([]))
      );
    }

    // Admin: all signatures
    if (isAdmin) {
      promises.push(
        api.signatures.listAll(token)
          .then((data: any) => setAllSignatures(Array.isArray(data) ? data : []))
          .catch(() => setAllSignatures([]))
      );
    }

    // Admin: pending contracts to sign
    if (isAdmin) {
      promises.push(
        api.contracts.list(token)
          .then((data: any) => {
            const all = Array.isArray(data) ? data : [];
            setPendingContracts(all.filter((c: any) => c.status === 'pending_signature'));
          })
          .catch(() => setPendingContracts([]))
      );
    }

    Promise.all(promises).finally(() => setLoading(false));
  }, [token, role]);

  if (loading) return <PageSkeleton cards={3} tableRows={8} />;

  // Determine tabs
  const tabs: { key: 'mine' | 'team' | 'all'; label: string }[] = [
    { key: 'mine', label: t('firmas.tabMine') },
  ];
  if (isManager || isAdmin) {
    tabs.push({ key: 'team', label: t('firmas.tabTeam') });
  }
  if (isAdmin) {
    tabs.push({ key: 'all', label: t('firmas.tabAll') });
  }

  // Current data
  const currentData = activeTab === 'all' ? allSignatures : activeTab === 'team' ? teamSignatures : mySignatures;

  // Subtitle per role
  const subtitle = isAdmin
    ? t('firmas.subtitleAdmin')
    : isManager
    ? t('firmas.subtitleManager')
    : t('firmas.subtitleEmployee');

  // Stats for current view
  const totalSigs = currentData.length;
  const validSigs = currentData.filter((s: any) => s.status === 'valid').length;
  const docTypes = Array.from(new Set(currentData.map((s: any) => s.documentType).filter(Boolean)));

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('firmas.pageTitle')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{subtitle}</p>
      </div>

      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>{t('firmas.guideTitle')}</h3>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <p><strong>{t('firmas.guideProcess')}</strong> {t('firmas.guideProcessText')}</p>
            <p><strong>{t('firmas.guideValidity')}</strong> {t('firmas.guideValidityText')}</p>
            <p><strong>{t('firmas.guideStates')}</strong> {t('firmas.guideStatesText')}</p>
          </div>
          <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
            <strong style={{ color: 'var(--accent)' }}>{t('firmas.guidePermissions')}</strong>
            {isAdmin
              ? ` ${t('firmas.guidePermAdmin')}`
              : isManager
              ? ` ${t('firmas.guidePermManager')}`
              : ` ${t('firmas.guidePermEmployee')}`}
          </div>
        </div>
      )}

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)', paddingBottom: '0' }}>
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: '0.6rem 1.25rem',
                fontSize: '0.82rem',
                fontWeight: activeTab === tab.key ? 700 : 400,
                color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                background: 'none',
                border: 'none',
                borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: '-2px',
                transition: 'all 0.2s ease',
              }}
            >
              {tab.label}
              <span style={{
                marginLeft: '0.4rem',
                fontSize: '0.7rem',
                background: activeTab === tab.key ? 'var(--accent)' : 'var(--bg-hover)',
                color: activeTab === tab.key ? '#fff' : 'var(--text-muted)',
                padding: '0.1rem 0.4rem',
                borderRadius: '10px',
              }}>
                {tab.key === 'mine' ? mySignatures.length : tab.key === 'team' ? teamSignatures.length : allSignatures.length}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* KPIs */}
      <div className="animate-fade-up-delay-1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('firmas.kpiTotal')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)' }}>{totalSigs}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('firmas.kpiValid')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--success)' }}>{validSigs}</div>
        </div>
        <div className="card" style={{ padding: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('firmas.kpiDocTypes')}</div>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: '#6366f1' }}>{docTypes.length}</div>
        </div>
        {pendingContracts.length > 0 && (
          <div className="card" style={{ padding: '1.25rem', textAlign: 'center', borderLeft: '3px solid var(--warning, #f59e0b)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.35rem' }}>{t('firmas.kpiPending')}</div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--warning, #f59e0b)' }}>{pendingContracts.length}</div>
          </div>
        )}
      </div>

      {/* Pending Contracts Section */}
      {pendingContracts.length > 0 && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--warning, #f59e0b)' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--warning, #f59e0b)' }}>
            {t('firmas.pendingTitle', { count: pendingContracts.length })}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {pendingContracts.map((c: any) => {
              return (
                <div key={c.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '0.6rem 0.85rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm, 6px)',
                  border: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{c.title}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {t(`firmas.contractTypeLabel.${c.type}`, c.type)} · v{c.version || 1} · {t('firmas.contractSince')} {c.effectiveDate ? new Date(c.effectiveDate).toLocaleDateString('es-CL') : '—'}
                    </div>
                  </div>
                  <button
                    className="btn-primary"
                    style={{ fontSize: '0.78rem', padding: '0.35rem 0.85rem' }}
                    onClick={() => setSigningContract(c)}
                  >
                    {t('firmas.signAction')}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Signature Table */}
      <SignatureTable
        signatures={currentData}
        canVerify={isAdmin || isManager}
        token={token}
      />

      {/* Signature Modal */}
      {signingContract && (
        <SignatureModal
          documentType="contract"
          documentId={signingContract.id}
          documentName={signingContract.title}
          onSigned={() => {
            setSigningContract(null);
            // Refresh all data
            if (token) {
              api.signatures.mine(token).then((d: any) => setMySignatures(Array.isArray(d) ? d : [])).catch(() => {});
              if (isManager || isAdmin) {
                api.signatures.team(token).then((d: any) => setTeamSignatures(Array.isArray(d) ? d : [])).catch(() => {});
              }
              if (isAdmin) {
                api.signatures.listAll(token).then((d: any) => setAllSignatures(Array.isArray(d) ? d : [])).catch(() => {});
                api.contracts.list(token).then((d: any) => {
                  const all = Array.isArray(d) ? d : [];
                  setPendingContracts(all.filter((c: any) => c.status === 'pending_signature'));
                }).catch(() => {});
              }
            }
          }}
          onCancel={() => setSigningContract(null)}
        />
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
