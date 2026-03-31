'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

interface SignatureModalProps {
  documentType: string;
  documentId: string;
  documentName: string;
  onSigned: () => void;
  onCancel: () => void;
}

export default function SignatureModal({ documentType, documentId, documentName, onSigned, onCancel }: SignatureModalProps) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [step, setStep] = useState<'request' | 'verify' | 'done'>('request');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRequest = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      await api.signatures.request(token, documentType, documentId);
      setStep('verify');
    } catch (e: any) {
      setError(e.message || 'Error al solicitar firma');
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    if (!token || !code.trim()) return;
    setLoading(true);
    setError('');
    try {
      await api.signatures.verify(token, documentType, documentId, code.trim());
      setStep('done');
      setTimeout(() => onSigned(), 1500);
    } catch (e: any) {
      setError(e.message || 'Código inválido');
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div className="card" style={{ padding: '2rem', maxWidth: '440px', width: '90%' }}>
        {step === 'request' && (
          <>
            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
              {'✍️'} {t('firmas.signTitle')}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {t('firmas.signDesc')}
            </p>
            <div style={{ padding: '0.75rem 1rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>{documentName}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{t(`firmas.docType.${documentType}`)}</div>
            </div>
            {error && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleRequest} disabled={loading}>
                {loading ? t('firmas.sending') : t('firmas.sendCode')}
              </button>
            </div>
          </>
        )}

        {step === 'verify' && (
          <>
            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
              {t('firmas.enterCode')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {t('firmas.enterCodeDesc')}
            </p>
            <input
              className="input"
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.3em', fontWeight: 700, marginBottom: '1rem' }}
              autoFocus
            />
            {error && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => { setStep('request'); setCode(''); setError(''); }}>
                {t('firmas.resend')}
              </button>
              <button className="btn-primary" onClick={handleVerify} disabled={loading || code.length < 6}>
                {loading ? t('firmas.verifying') : t('firmas.signBtn')}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>{'✅'}</p>
            <h3 style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem', color: 'var(--success)' }}>
              {t('firmas.signed')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {t('firmas.signedDesc')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Badge component showing signature status */
export function SignatureBadge({ signatures }: { signatures: any[] }) {
  const { t } = useTranslation();
  if (!signatures || signatures.length === 0) return null;
  const latest = signatures[0];
  return (
    <span title={`${t('firmas.signedBy')}: ${latest.signer?.firstName || ''} ${latest.signer?.lastName || ''} — ${new Date(latest.signedAt).toLocaleString('es-CL')}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
        background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
        borderRadius: 20, padding: '2px 10px', fontSize: '0.72rem', color: 'var(--success)', fontWeight: 600,
      }}>
      {'✍️'} {t('firmas.signedBadge')}
    </span>
  );
}
