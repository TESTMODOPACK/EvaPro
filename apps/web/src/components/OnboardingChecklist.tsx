'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const HIDE_KEY = 'evapro_hide_onboarding_checklist';

interface Step {
  key: string;
  label: string;
  done: boolean;
  href: string;
}

interface ProgressData {
  role: string;
  steps: Step[];
  completedCount: number;
  totalSteps: number;
  allDone: boolean;
}

export function OnboardingChecklist() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem(HIDE_KEY) === '1') {
      setHidden(true);
    }
  }, []);

  useEffect(() => {
    if (!token || hidden) return;
    api.tenants.getOnboardingProgress(token)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [token, hidden]);

  if (hidden || loading || !data || data.allDone) return null;
  if (role === 'super_admin' || role === 'tenant_admin') return null;

  const pct = data.totalSteps > 0 ? Math.round((data.completedCount / data.totalSteps) * 100) : 0;

  const handleHide = () => {
    setHidden(true);
    if (typeof window !== 'undefined') localStorage.setItem(HIDE_KEY, '1');
  };

  const titles: Record<string, string> = {
    tenant_admin: 'Configura tu organización',
    manager: 'Primeros pasos como encargado',
    employee: 'Primeros pasos en Eva360',
  };

  return (
    <div className="card animate-fade-up" style={{ padding: 0, overflow: 'hidden', marginBottom: '1.25rem', border: '1px solid rgba(201,147,58,0.2)' }}>
      {/* Header */}
      <div
        style={{
          padding: '0.85rem 1.25rem',
          background: 'linear-gradient(135deg, rgba(201,147,58,0.08) 0%, rgba(201,147,58,0.02) 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🚀</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{titles[role || ''] || 'Primeros pasos'}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {data.completedCount}/{data.totalSteps} completados — {pct}%
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Progress mini bar */}
          <div style={{ width: '80px', height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: '3px', transition: 'width 0.5s ease' }} />
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); handleHide(); }}
            title="Ocultar checklist"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', padding: '0.2rem' }}
          >
            ✕
          </button>
          <span style={{ fontSize: '0.7rem', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block', color: 'var(--text-muted)' }}>
            ▼
          </span>
        </div>
      </div>

      {/* Steps */}
      {!collapsed && (
        <div style={{ padding: '0.75rem 1.25rem 1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {data.steps.map((step, i) => (
              <Link
                key={step.key}
                href={step.href}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.6rem',
                  padding: '0.5rem 0.65rem', borderRadius: 'var(--radius-sm)',
                  background: step.done ? 'rgba(16,185,129,0.04)' : 'var(--bg-surface)',
                  border: `1px solid ${step.done ? 'rgba(16,185,129,0.15)' : 'var(--border)'}`,
                  textDecoration: 'none', color: 'inherit',
                  transition: 'background 0.15s',
                }}
              >
                <span style={{
                  width: '22px', height: '22px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
                  background: step.done ? '#10b981' : 'var(--bg-surface)',
                  color: step.done ? '#fff' : 'var(--text-muted)',
                  border: step.done ? 'none' : '1.5px solid var(--border)',
                }}>
                  {step.done ? '✓' : i + 1}
                </span>
                <span style={{
                  fontSize: '0.84rem', fontWeight: step.done ? 500 : 600,
                  color: step.done ? 'var(--text-muted)' : 'var(--text-primary)',
                  textDecoration: step.done ? 'line-through' : 'none',
                  flex: 1,
                }}>
                  {step.label}
                </span>
                {!step.done && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--accent)', fontWeight: 600 }}>Ir →</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
