'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import useFocusTrap from '@/hooks/useFocusTrap';

/**
 * Mejora #1 (G5): tipo de acknowledgment al firmar.
 *  - agree: firma plena (default).
 *  - agree_with_comments: firma con comentario informativo.
 *  - decline: firma de rechazo formal con motivo. NO transiciona estado
 *    del documento; queda registrado como evidencia.
 */
export type AcknowledgmentType = 'agree' | 'agree_with_comments' | 'decline';

/**
 * Mejora #2 (G2/G3): rol de firma. Default 'recipient' (compat histórica).
 *  - recipient: el evaluado firma de recepción.
 *  - author: el manager/external firma como autor del feedback.
 *  - employer_witness: el tenant_admin co-firma como representante del empleador.
 */
export type SignatureRole = 'recipient' | 'author' | 'employer_witness';

interface SignatureModalProps {
  documentType: string;
  documentId: string;
  documentName: string;
  /**
   * Mejora #2: rol con el que se firmará. Si no se envía → 'recipient' (compat).
   * El backend valida que el usuario tenga derecho a firmar con este rol.
   */
  signatureRole?: SignatureRole;
  /**
   * Mejora #1: si false, el modal omite la elección de acknowledgment y
   * fuerza 'agree' (útil para flujos donde rechazar no aplica, ej. firma
   * del autor o testigo, donde el rechazo no tiene sentido semántico).
   * Default true (empleado puede elegir).
   */
  allowAcknowledgmentChoice?: boolean;
  onSigned: () => void;
  onCancel: () => void;
}

// Validación alineada con el backend: acknowledgmentComment min 10 / max 2000
// cuando type !== 'agree' (signatures.service.ts).
const COMMENT_MIN_LENGTH = 10;
const COMMENT_MAX_LENGTH = 2000;

export default function SignatureModal({
  documentType,
  documentId,
  documentName,
  signatureRole,
  allowAcknowledgmentChoice = true,
  onSigned,
  onCancel,
}: SignatureModalProps) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [step, setStep] = useState<'request' | 'choice' | 'verify' | 'done'>('request');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Mejora #1: estado del acknowledgment
  const [ackType, setAckType] = useState<AcknowledgmentType>('agree');
  const [comment, setComment] = useState('');

  const submittingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // P8-D: focus trap dentro del dialog.
  useFocusTrap(dialogRef, true);

  // P8-A: escape key para cerrar. No cerrar en step 'done' (feedback
  // visual corto de 1.5s) ni mid-submission para no cancelar requests.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading && step !== 'done') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [loading, step, onCancel]);

  // Validaciones del comment: min length cuando ackType !== 'agree'
  const commentRequired = ackType !== 'agree';
  const trimmedComment = comment.trim();
  const commentTooShort = commentRequired && trimmedComment.length < COMMENT_MIN_LENGTH;
  const commentTooLong = trimmedComment.length > COMMENT_MAX_LENGTH;
  const choiceValid = !commentRequired || (!commentTooShort && !commentTooLong);

  const handleRequest = async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      await api.signatures.request(token, documentType, documentId, signatureRole);
      // Si el flujo permite elección, mostrar paso de choice antes de verify.
      // Si no, saltamos directo a verify (acknowledgmentType queda en default 'agree').
      setStep(allowAcknowledgmentChoice ? 'choice' : 'verify');
    } catch (e: any) {
      setError(e.message || t('firmas.errorRequest'));
    }
    setLoading(false);
  };

  const handleVerify = async () => {
    if (!token || !code.trim() || submittingRef.current) return;
    if (!choiceValid) {
      setError(t('firmas.commentRequired'));
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError('');
    try {
      await api.signatures.verify(token, documentType, documentId, code.trim(), {
        acknowledgmentType: ackType,
        // Solo enviar comment si fue ingresado (backend lo trimea de nuevo).
        acknowledgmentComment: trimmedComment || undefined,
        signatureRole,
      });
      setStep('done');
      setTimeout(() => onSigned(), 1500);
    } catch (e: any) {
      setError(e.message || t('firmas.invalidCode'));
      submittingRef.current = false;
    }
    setLoading(false);
  };

  // Helper: estilo radio seleccionado vs no
  const radioCardStyle = (selected: boolean): React.CSSProperties => ({
    display: 'block',
    padding: '0.75rem 1rem',
    border: `1px solid ${selected ? 'var(--primary)' : 'rgba(0,0,0,0.1)'}`,
    background: selected ? 'rgba(201,147,58,0.06)' : 'transparent',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    marginBottom: '0.5rem',
    transition: 'all 0.15s ease',
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signature-modal-title"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading && step !== 'done') onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="card"
        style={{ padding: '2rem', maxWidth: '520px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {step === 'request' && (
          <>
            <h3 id="signature-modal-title" style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
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

        {step === 'choice' && (
          <>
            <h3 id="signature-modal-title" style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.75rem' }}>
              {t('firmas.choiceTitle')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {t('firmas.choiceDesc')}
            </p>

            <div role="radiogroup" aria-label={t('firmas.choiceTitle')}>
              <label style={radioCardStyle(ackType === 'agree')}>
                <input
                  type="radio" name="ackType" value="agree"
                  checked={ackType === 'agree'} onChange={() => setAckType('agree')}
                  style={{ marginRight: '0.5rem' }}
                />
                <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                  {'🟢'} {t('firmas.ack.agree.label')}
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '1.5rem', marginTop: '0.15rem' }}>
                  {t('firmas.ack.agree.desc')}
                </div>
              </label>

              <label style={radioCardStyle(ackType === 'agree_with_comments')}>
                <input
                  type="radio" name="ackType" value="agree_with_comments"
                  checked={ackType === 'agree_with_comments'} onChange={() => setAckType('agree_with_comments')}
                  style={{ marginRight: '0.5rem' }}
                />
                <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                  {'🟡'} {t('firmas.ack.agreeWithComments.label')}
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '1.5rem', marginTop: '0.15rem' }}>
                  {t('firmas.ack.agreeWithComments.desc')}
                </div>
              </label>

              <label style={radioCardStyle(ackType === 'decline')}>
                <input
                  type="radio" name="ackType" value="decline"
                  checked={ackType === 'decline'} onChange={() => setAckType('decline')}
                  style={{ marginRight: '0.5rem' }}
                />
                <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                  {'🔴'} {t('firmas.ack.decline.label')}
                </span>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: '1.5rem', marginTop: '0.15rem' }}>
                  {t('firmas.ack.decline.desc')}
                </div>
              </label>
            </div>

            {commentRequired && (
              <div style={{ marginTop: '0.75rem' }}>
                <label htmlFor="ackComment" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  {ackType === 'decline' ? t('firmas.commentDeclineLabel') : t('firmas.commentLabel')}
                  {' '}<span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <textarea
                  id="ackComment"
                  className="input"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  maxLength={COMMENT_MAX_LENGTH}
                  aria-required={commentRequired}
                  aria-invalid={commentTooShort || commentTooLong}
                  aria-describedby="ackCommentHelp"
                  placeholder={
                    ackType === 'decline'
                      ? t('firmas.commentDeclinePlaceholder')
                      : t('firmas.commentPlaceholder')
                  }
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5 }}
                  autoFocus
                />
                <div id="ackCommentHelp" style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  fontSize: '0.72rem', color: commentTooShort ? 'var(--danger)' : 'var(--text-muted)',
                  marginTop: '0.25rem',
                }}>
                  <span>
                    {commentTooShort
                      ? t('firmas.commentMinChars', { min: COMMENT_MIN_LENGTH })
                      : ' '}
                  </span>
                  <span>{trimmedComment.length} / {COMMENT_MAX_LENGTH}</span>
                </div>
              </div>
            )}

            {error && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-ghost" onClick={onCancel}>{t('common.cancel')}</button>
              <button
                className="btn-primary"
                onClick={() => setStep('verify')}
                disabled={!choiceValid || loading}
              >
                {t('common.next')}
              </button>
            </div>
          </>
        )}

        {step === 'verify' && (
          <>
            <h3 id="signature-modal-title" style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
              {t('firmas.enterCode')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              {t('firmas.enterCodeDesc')}
            </p>
            {/* Mejora #1: mostrar el tipo de acknowledgment elegido como recordatorio */}
            {allowAcknowledgmentChoice && (
              <div style={{
                fontSize: '0.78rem', color: 'var(--text-muted)',
                marginBottom: '0.75rem', padding: '0.5rem 0.75rem',
                background: 'rgba(0,0,0,0.03)', borderRadius: 'var(--radius-sm)',
              }}>
                {t('firmas.willSignAs')}: <strong>{t(`firmas.ack.${ackTypeKey(ackType)}.label`)}</strong>
              </div>
            )}
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
              <button
                className="btn-ghost"
                onClick={() => {
                  // Volver al paso anterior preservando elección
                  setStep(allowAcknowledgmentChoice ? 'choice' : 'request');
                  setCode('');
                  setError('');
                }}
              >
                {t('common.back')}
              </button>
              <button className="btn-primary" onClick={handleVerify} disabled={loading || code.length < 6}>
                {loading ? t('firmas.verifying') : t('firmas.signBtn')}
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
              {ackType === 'decline' ? '📝' : '✅'}
            </p>
            <h3
              id="signature-modal-title"
              style={{
                fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem',
                color: ackType === 'decline' ? 'var(--warning)' : 'var(--success)',
              }}
            >
              {ackType === 'decline' ? t('firmas.declineRecorded') : t('firmas.signed')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              {ackType === 'decline' ? t('firmas.declineRecordedDesc') : t('firmas.signedDesc')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Helper para mapear el ackType al fragment de la i18n key */
function ackTypeKey(t: AcknowledgmentType): 'agree' | 'agreeWithComments' | 'decline' {
  if (t === 'agree_with_comments') return 'agreeWithComments';
  if (t === 'decline') return 'decline';
  return 'agree';
}

/**
 * Mejora #4: estados visuales de firma con badges de color.
 *
 * Estados:
 *  🟢 verde   — firmada (status='valid', acknowledgmentType='agree' o legacy NULL)
 *  🟡 amarillo — firmada con comentario (acknowledgmentType='agree_with_comments')
 *  🔴 rojo    — rechazada formalmente (acknowledgmentType='decline')
 *  ⚫ gris    — revocada (status='revoked')
 *
 * También indica el signatureRole (recipient / author / employer_witness).
 */
interface SignatureBadgeStyle {
  bg: string;
  border: string;
  color: string;
  emoji: string;
  labelKey: string;
}

function styleFromSignature(sig: any): SignatureBadgeStyle {
  if (sig?.status === 'revoked') {
    return {
      bg: 'rgba(107,114,128,0.10)',
      border: 'rgba(107,114,128,0.25)',
      color: 'var(--text-muted)',
      emoji: '⚫',
      labelKey: 'firmas.statusRevoked',
    };
  }
  const ack: AcknowledgmentType | null = sig?.acknowledgmentType ?? null;
  if (ack === 'decline') {
    return {
      bg: 'rgba(239,68,68,0.08)',
      border: 'rgba(239,68,68,0.25)',
      color: 'var(--danger)',
      emoji: '🔴',
      labelKey: 'firmas.badgeDecline',
    };
  }
  if (ack === 'agree_with_comments') {
    return {
      bg: 'rgba(245,158,11,0.10)',
      border: 'rgba(245,158,11,0.25)',
      color: '#b45309',
      emoji: '🟡',
      labelKey: 'firmas.badgeAgreeWithComments',
    };
  }
  // Default: agree (incluye firmas legacy con acknowledgmentType=null)
  return {
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.2)',
    color: 'var(--success)',
    emoji: '🟢',
    labelKey: 'firmas.badgeAgree',
  };
}

function roleEmoji(role: string | null | undefined): string {
  if (role === 'author') return '✍️';
  if (role === 'employer_witness') return '🏛️';
  return '👤'; // recipient default
}

/** Badge component showing signature status (multi-estado + popover de comentario). */
export function SignatureBadge({ signatures }: { signatures: any[] }) {
  const { t } = useTranslation();
  if (!signatures || signatures.length === 0) return null;
  // Mostrar la firma más reciente (por compat con uso histórico)
  const latest = signatures[0];
  return <SignatureStatusBadge sig={latest} compact />;
}

/**
 * Badge enriquecido con popover/title que muestra:
 *  - signatureRole (icono)
 *  - estado (color + label)
 *  - firmante + fecha + IP
 *  - comentario (si hay) en tooltip
 */
export function SignatureStatusBadge({
  sig,
  compact = false,
}: {
  sig: any;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const [showComment, setShowComment] = useState(false);
  if (!sig) return null;

  const style = styleFromSignature(sig);
  const role = sig.signatureRole || 'recipient';
  const signerName = sig.signer
    ? `${sig.signer.firstName || ''} ${sig.signer.lastName || ''}`.trim()
    : sig.signedBy?.substring(0, 8) || '—';
  const dateStr = sig.signedAt ? new Date(sig.signedAt).toLocaleString('es-CL') : '';
  const hasComment = !!sig.acknowledgmentComment;

  // Tooltip text combinado para hover (a11y nativo, sin JS):
  const tooltipParts = [
    `${t('firmas.signedBy')}: ${signerName}`,
    dateStr && `${dateStr}`,
    sig.signerIp && `IP: ${sig.signerIp}`,
    sig.signatureRole && `${t('firmas.signatureRole')}: ${t(`firmas.role.${role}`)}`,
    sig.status === 'revoked' && sig.revocationReason && `${t('firmas.revocationReason')}: ${sig.revocationReason}`,
  ].filter(Boolean).join('\n');

  return (
    <span style={{ position: 'relative', display: 'inline-block' }}>
      <span
        title={tooltipParts}
        aria-label={tooltipParts}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
          background: style.bg, border: `1px solid ${style.border}`,
          borderRadius: 20, padding: compact ? '2px 10px' : '4px 12px',
          fontSize: compact ? '0.72rem' : '0.78rem',
          color: style.color, fontWeight: 600,
          cursor: hasComment ? 'pointer' : 'default',
        }}
        onClick={() => hasComment && setShowComment((v) => !v)}
        onKeyDown={(e) => {
          if (hasComment && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            setShowComment((v) => !v);
          }
        }}
        tabIndex={hasComment ? 0 : undefined}
        role={hasComment ? 'button' : undefined}
      >
        <span aria-hidden="true">{roleEmoji(role)}</span>
        <span aria-hidden="true">{style.emoji}</span>
        <span>{t(style.labelKey)}</span>
        {hasComment && (
          <span aria-hidden="true" style={{ fontSize: '0.85em', opacity: 0.7 }}>💬</span>
        )}
      </span>

      {/* Popover con el comentario (si lo hay y el usuario click) */}
      {showComment && hasComment && (
        <div
          role="tooltip"
          style={{
            position: 'absolute', top: '110%', left: 0, zIndex: 50,
            minWidth: '260px', maxWidth: '380px',
            padding: '0.6rem 0.75rem',
            background: 'var(--bg-surface, #fff)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${style.color}`,
            borderRadius: 'var(--radius-sm, 6px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            fontSize: '0.78rem', lineHeight: 1.5,
            color: 'var(--text-primary)',
            whiteSpace: 'pre-wrap',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{
            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
            color: style.color, marginBottom: '0.25rem',
          }}>
            {t(style.labelKey)}
          </div>
          <div>{sig.acknowledgmentComment}</div>
          <button
            className="btn-ghost"
            onClick={() => setShowComment(false)}
            style={{ marginTop: '0.5rem', fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}
          >
            {t('common.close')}
          </button>
        </div>
      )}
    </span>
  );
}
