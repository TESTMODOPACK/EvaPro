'use client';

/**
 * Reusable loading skeleton components.
 * Replace spinners with content-shaped placeholders for better perceived performance.
 */

const pulseStyle: React.CSSProperties = {
  background: 'linear-gradient(90deg, var(--bg-surface) 25%, var(--bg-hover, rgba(201,147,58,0.06)) 50%, var(--bg-surface) 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeleton-pulse 1.5s ease-in-out infinite',
  borderRadius: 'var(--radius-sm, 6px)',
};

function Bone({ width, height = '0.85rem', style }: { width?: string; height?: string; style?: React.CSSProperties }) {
  return <div style={{ ...pulseStyle, width: width || '100%', height, ...style }} />;
}

/** Cards row — mimics KPI summary cards */
export function CardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(155px, 1fr))`, gap: '1rem', marginBottom: '1.5rem' }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
          <Bone width="60%" height="0.65rem" />
          <Bone width="40%" height="2rem" />
        </div>
      ))}
    </div>
  );
}

/** Table skeleton — mimics a data table */
export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="card" style={{ padding: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '2px solid var(--border)' }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Bone key={i} width={i === 0 ? '25%' : '15%'} height="0.7rem" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} style={{ display: 'flex', gap: '1rem', padding: '0.6rem 0', borderBottom: '1px solid var(--border)' }}>
          {Array.from({ length: cols }).map((_, ci) => (
            <Bone key={ci} width={ci === 0 ? '25%' : '15%'} height="0.8rem" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** List skeleton — mimics card list items */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Bone width="45%" height="0.9rem" />
            <Bone width="15%" height="0.75rem" />
          </div>
          <Bone width="70%" height="0.75rem" />
          <Bone width="100%" height="6px" style={{ borderRadius: '999px', marginTop: '0.25rem' }} />
        </div>
      ))}
    </div>
  );
}

/** Page skeleton — full page layout with header, cards and table */
export function PageSkeleton({ cards = 4, tableRows = 5 }: { cards?: number; tableRows?: number }) {
  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Title */}
      <div style={{ marginBottom: '2rem' }}>
        <Bone width="250px" height="1.5rem" style={{ marginBottom: '0.5rem' }} />
        <Bone width="350px" height="0.85rem" />
      </div>
      {/* Cards */}
      <CardsSkeleton count={cards} />
      {/* Table */}
      <TableSkeleton rows={tableRows} />
      {/* CSS animation */}
      <style>{`@keyframes skeleton-pulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

/** Simple section skeleton (for tabs/sections within a page) */
export function SectionSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Bone width="200px" height="1rem" />
      <ListSkeleton rows={3} />
      <style>{`@keyframes skeleton-pulse { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}
