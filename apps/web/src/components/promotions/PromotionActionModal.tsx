'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import useFocusTrap from '@/hooks/useFocusTrap';

const COMMENT_MIN = 10;
const COMMENT_MAX = 2000;

interface Props {
  mode: 'endorse' | 'reject' | 'decide';
  candidate?: any;        // { userId, user, ... } cuando mode = endorse | reject
  decision?: any;          // { id, userId, user, endorser, ... } cuando mode = decide
  onClose: () => void;
  onSuccess: () => void;
}

export default function PromotionActionModal({ mode, candidate, decision, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const dialogRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  useFocusTrap(dialogRef, true);

  const [comment, setComment] = useState('');
  const [decideAction, setDecideAction] = useState<'approve' | 'reject' | 'return'>('approve');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [loading, onClose]);

  const u = (candidate?.user || decision?.user) || {};
  const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || '';
  const trimmed = comment.trim();
  const valid = trimmed.length >= COMMENT_MIN && trimmed.length <= COMMENT_MAX;

  const titleKey =
    mode === 'endorse' ? 'promotions.endorseModalTitle'
    : mode === 'reject' ? 'promotions.rejectModalTitle'
    : 'promotions.decideModalTitle';

  const descKey =
    mode === 'endorse' ? 'promotions.endorseModalDesc'
    : mode === 'reject' ? 'promotions.rejectModalDesc'
    : null;

  const commentLabelKey =
    mode === 'endorse' ? 'promotions.endorseCommentLabel'
    : mode === 'reject' ? 'promotions.rejectCommentLabel'
    : 'promotions.decideCommentLabel';

  const commentPlaceholderKey =
    mode === 'endorse' ? 'promotions.endorseCommentPlaceholder'
    : mode === 'reject' ? 'promotions.rejectCommentPlaceholder'
    : 'promotions.decideCommentLabel';

  const handleSubmit = async () => {
    if (!token || !valid || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      if (mode === 'endorse' && candidate) {
        await api.promotions.endorse(token, candidate.userId, trimmed);
      } else if (mode === 'reject' && candidate) {
        await api.promotions.reject(token, candidate.userId, trimmed);
      } else if (mode === 'decide' && decision) {
        await api.promotions.decide(token, decision.id, decideAction, trimmed);
      }
      onSuccess();
    } catch (e: any) {
      setError(e?.message || t('promotions.actionError'));
      submittingRef.current = false;
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promotion-action-title"
      onClick={(e) => { if (e.target === e.currentTarget && !loading) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1100,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
      }}
    >
      <div
        ref={dialogRef}
        className="card animate-fade-up"
        style={{
          maxWidth: '520px', width: '100%', maxHeight: '90vh',
          overflowY: 'auto', padding: '1.75rem',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="promotion-action-title" style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
          {t(titleKey, { name })}
        </h2>
        {descKey && (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem', lineHeight: 1.6 }}>
            {t(descKey)}
          </p>
        )}

        {/* Decide-specific: action selector */}
        {mode === 'decide' && (
          <div role="radiogroup" aria-label="Acción" style={{ marginBottom: '1rem' }}>
            {(['approve', 'reject', 'return'] as const).map((act) => {
              const selected = decideAction === act;
              const colors =
                act === 'approve' ? { bg: 'rgba(16,185,129,0.06)', border: 'var(--success)' }
                : act === 'reject' ? { bg: 'rgba(239,68,68,0.06)', border: 'var(--danger)' }
                : { bg: 'rgba(99,102,241,0.06)', border: '#6366f1' };
              return (
                <label
                  key={act}
                  style={{
                    display: 'block', padding: '0.7rem 0.9rem',
                    border: `1px solid ${selected ? colors.border : 'var(--border)'}`,
                    background: selected ? colors.bg : 'transparent',
                    borderRadius: 'var(--radius-sm)', marginBottom: '0.4rem',
                    cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
                  }}
                >
                  <input
                    type="radio" name="decideAction" value={act}
                    checked={selected} onChange={() => setDecideAction(act)}
                    style={{ marginRight: '0.5rem' }}
                  />
                  {t(`promotions.decideAction.${act}`)}
                </label>
              );
            })}
          </div>
        )}

        {/* Comment textarea */}
        <label htmlFor="actionComment" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.3rem' }}>
          {t(commentLabelKey)} <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <textarea
          id="actionComment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={COMMENT_MAX}
          aria-required={true}
          aria-invalid={!valid && trimmed.length > 0}
          aria-describedby="actionCommentHelp"
          placeholder={t(commentPlaceholderKey)}
          className="input"
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', lineHeight: 1.5 }}
          autoFocus
        />
        <div
          id="actionCommentHelp"
          style={{
            display: 'flex', justifyContent: 'space-between',
            fontSize: '0.72rem',
            color: trimmed.length > 0 && trimmed.length < COMMENT_MIN ? 'var(--danger)' : 'var(--text-muted)',
            marginTop: '0.25rem',
          }}
        >
          <span>
            {trimmed.length > 0 && trimmed.length < COMMENT_MIN
              ? t('promotions.needsCommentMin')
              : ' '}
          </span>
          <span>{trimmed.length} / {COMMENT_MAX}</span>
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button className="btn-ghost" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </button>
          <button
            className="btn-primary"
            onClick={handleSubmit}
            disabled={!valid || loading}
          >
            {loading ? '...' : t(
              mode === 'endorse' ? 'promotions.endorseBtn'
              : mode === 'reject' ? 'promotions.rejectBtn'
              : 'promotions.decideBtn',
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
