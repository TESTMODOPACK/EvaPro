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
        {role === 'tenant_admin' && (
          <Link href="/dashboard/postulantes/nuevo" className="btn-primary" style={{ fontSize: '0.85rem' }}>
            {t('postulantes.newProcess')}
          </Link>
        )}
      </div>

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
