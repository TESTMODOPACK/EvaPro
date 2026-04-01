'use client';

import Link from 'next/link';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { FEATURE_LABELS, FEATURE_MIN_PLAN } from '@/lib/feature-routes';

interface PlanGateProps {
  feature: string;
  children: React.ReactNode;
  guideFallback?: React.ReactNode;
}

/**
 * Wraps a page's content and blocks access if the tenant's plan
 * doesn't include the required feature. Shows a friendly upgrade
 * message and optionally renders a guide section.
 */
export function PlanGate({ feature, children, guideFallback }: PlanGateProps) {
  const { hasFeature, planName, isLoading, isSuperAdmin } = useFeatureAccess();

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
        <span className="spinner" />
      </div>
    );
  }

  if (isSuperAdmin || hasFeature(feature)) {
    return <>{children}</>;
  }

  const featureLabel = FEATURE_LABELS[feature] || feature;
  const minPlan = FEATURE_MIN_PLAN[feature] || 'Superior';

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      <div className="card animate-fade-up" style={{ padding: '3rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.6 }}>&#128274;</div>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          Funcionalidad no disponible
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
          <strong>{featureLabel}</strong> no esta incluida en su plan actual <strong>({planName})</strong>.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
          Esta funcionalidad esta disponible a partir del plan <strong>{minPlan}</strong>.
          Contacte al administrador del sistema para actualizar su plan.
        </p>
        <Link
          href="/dashboard/mi-suscripcion"
          className="btn-primary"
          style={{ textDecoration: 'none' }}
        >
          Ver mi suscripcion
        </Link>
      </div>

      {guideFallback && (
        <div style={{ marginTop: '1.5rem' }}>
          {guideFallback}
        </div>
      )}
    </div>
  );
}
