'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { processStatusLabel, processStatusBadge } from '@/lib/statusMaps';
import Link from 'next/link';

const TABS = ['all', 'draft', 'in_progress', 'completed', 'closed'];
const TAB_LABEL_KEYS: Record<string, string> = {
  all: 'common.all', draft: 'status.process.draft', in_progress: 'status.process.in_progress',
  completed: 'status.process.completed', closed: 'status.process.closed',
};

export default function PostulantesPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const [processes, setProcesses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.postulants.processes.list(token, tab !== 'all' ? tab : undefined)
      .then(setProcesses)
      .catch(() => setProcesses([]))
      .finally(() => setLoading(false));
  }, [token, tab]);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('postulantes.title')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('postulantes.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className="btn-ghost"
            onClick={() => setShowGuide(!showGuide)}
            style={{ fontSize: '0.82rem' }}
          >
            {showGuide ? t('postulantes.hideGuide') : t('postulantes.howItWorks')}
          </button>
          {role === 'tenant_admin' && (
            <Link href="/dashboard/postulantes/nuevo" className="btn-primary" style={{ fontSize: '0.85rem' }}>
              {t('postulantes.newProcess')}
            </Link>
          )}
        </div>
      </div>

      {/* Usage Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {t('postulantes.guide.title')}
          </h3>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('postulantes.guide.whatIs')}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
              {t('postulantes.guide.whatIsDesc')}
            </p>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('postulantes.guide.flow')}
            </div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('postulantes.guide.flowStep1')}</li>
              <li>{t('postulantes.guide.flowStep2')}</li>
              <li>{t('postulantes.guide.flowStep3')}</li>
              <li>{t('postulantes.guide.flowStep4')}</li>
              <li>{t('postulantes.guide.flowStep5')}</li>
              <li>{t('postulantes.guide.flowStep6')}</li>
            </ol>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('postulantes.guide.rules')}
            </div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('postulantes.guide.rule1')}</li>
              <li>{t('postulantes.guide.rule2')}</li>
              <li>{t('postulantes.guide.rule3')}</li>
              <li>{t('postulantes.guide.rule4')}</li>
              <li>{t('postulantes.guide.rule5')}</li>
            </ul>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('postulantes.guide.statuses')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {[
                { label: t('postulantes.guide.statusApplied'), desc: t('postulantes.guide.statusAppliedDesc'), cls: 'badge-ghost' },
                { label: t('postulantes.guide.statusEvaluating'), desc: t('postulantes.guide.statusEvaluatingDesc'), cls: 'badge-accent' },
                { label: t('postulantes.guide.statusApproved'), desc: t('postulantes.guide.statusApprovedDesc'), cls: 'badge-success' },
                { label: t('postulantes.guide.statusRejected'), desc: t('postulantes.guide.statusRejectedDesc'), cls: 'badge-danger' },
                { label: t('postulantes.guide.statusHired'), desc: t('postulantes.guide.statusHiredDesc'), cls: 'badge-success' },
              ].map((s) => (
                <div key={s.label} style={{ padding: '0.5rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.4, flex: '1 1 180px' }}>
                  <span className={`badge ${s.cls}`} style={{ marginRight: '0.4rem' }}>{s.label}</span>
                  {s.desc}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('postulantes.guide.connections')}
            </div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('postulantes.guide.connCompetencies')}</li>
              <li>{t('postulantes.guide.connTalent')}</li>
              <li>{t('postulantes.guide.connUsers')}</li>
            </ul>
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('postulantes.guide.permissions')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('postulantes.guide.permAdmin')}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('postulantes.guide.permManager')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0' }}>
        {TABS.map((tab_key) => (
          <button
            key={tab_key}
            onClick={() => setTab(tab_key)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.82rem',
              fontWeight: tab === tab_key ? 700 : 500,
              color: tab === tab_key ? 'var(--accent)' : 'var(--text-muted)',
              background: 'none',
              border: 'none',
              borderBottom: tab === tab_key ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: '-1px',
            }}
          >
            {t(TAB_LABEL_KEYS[tab_key])}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <span className="spinner" />
        </div>
      ) : processes.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>{t('postulantes.noProcesses')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {processes.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/postulantes/${p.id}`}
              className="card animate-fade-up"
              style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', textDecoration: 'none', color: 'inherit', transition: 'box-shadow 0.15s' }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: '0.2rem' }}>{p.title}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {p.position}{p.department ? ` — ${p.department}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{p.candidateCount || 0}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{t('postulantes.candidates')}</div>
                </div>
                <span className={`badge ${processStatusBadge[p.status] || 'badge-ghost'}`}>
                  {processStatusLabel[p.status] || p.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
