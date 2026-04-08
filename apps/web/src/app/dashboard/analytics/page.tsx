'use client';
import { PlanGate } from '@/components/PlanGate';
import { AiQuotaBar, useAiQuota } from '@/components/AiQuotaBar';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAnalytics } from '@/hooks/usePerformanceHistory';
import { useCycles } from '@/hooks/useCycles';
import { useCompetencyHeatmap, useBellCurve } from '@/hooks/useReports';
import { useDepartments } from '@/hooks/useDepartments';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { useAiBias, useAnalyzeBias } from '@/hooks/useAiInsights';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area,
  Cell,
} from 'recharts';

type AnalyticsTab = 'scores' | 'departments' | 'competencies' | 'teams' | 'bias';

const TAB_CONFIG: Array<{ key: AnalyticsTab; labelKey: string; adminOnly?: boolean }> = [
  { key: 'scores', labelKey: 'analytics.tabs.scores' },
  { key: 'departments', labelKey: 'analytics.tabs.departments' },
  { key: 'competencies', labelKey: 'analytics.tabs.competencies' },
  { key: 'teams', labelKey: 'analytics.tabs.teams' },
  { key: 'bias', labelKey: 'analytics.tabs.bias', adminOnly: true },
];

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function heatColor(avg: number | null, maxScale: number): string {
  if (avg === null) return 'var(--bg-surface)';
  const ratio = avg / maxScale;
  if (ratio >= 0.75) return 'rgba(16,185,129,0.25)';
  if (ratio >= 0.55) return 'rgba(245,158,11,0.20)';
  return 'rgba(239,68,68,0.22)';
}

function CompetencyHeatmapSection({ cycleId }: { cycleId: string }) {
  const { t } = useTranslation();
  const [deptFilter, setDeptFilter] = useState('');
  const [sortByAvg, setSortByAvg] = useState(false);

  // Reset filters when cycle changes to avoid stale dept selection
  useEffect(() => {
    setDeptFilter('');
    setSortByAvg(false);
  }, [cycleId]);

  // Unfiltered query — used to populate department dropdown and as base data
  const { data: unfilteredData } = useCompetencyHeatmap(cycleId);

  // Filtered query — only different from above when a filter is active
  const activeFilters = deptFilter ? { department: deptFilter } : undefined;
  const { data, isLoading } = useCompetencyHeatmap(cycleId, activeFilters);

  // Use configured departments from Mantenedores for the filter dropdown
  const { departments: availableDepts } = useDepartments();

  // Helper: compute org-wide average for a row (across all depts, excludes null + privacy-restricted)
  const orgAvg = (row: any): number | null => {
    const vals = (row.values as any[])
      .filter((v) => v.avg !== null && !v.privacyRestricted)
      .map((v) => v.avg as number);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  if (isLoading && !data) return <Spinner />;

  const isEmpty = !data || !data.grid || data.grid.length === 0;
  const { departments, grid, privacyThreshold } = isEmpty ? { departments: [], grid: [], privacyThreshold: 3 } : data;

  // Sort rows: most-needs-improvement (lowest org avg) first when enabled
  const displayGrid = sortByAvg
    ? [...(grid as any[])].sort((a, b) => (orgAvg(a) ?? 999) - (orgAvg(b) ?? 999))
    : (grid as any[]);

  const hasPrivacyRows = (departments as string[]).some((d) =>
    (grid as any[]).some((r: any) => r.values.find((v: any) => v.department === d && v.privacyRestricted)),
  );

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            {t('analytics.heatmap.title')}
          </h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {t('analytics.heatmap.subtitle')}
          </p>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.72rem', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(16,185,129,0.25)', borderRadius: '2px', border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>{t('analytics.heatmap.legendHigh')}</span>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(245,158,11,0.20)', borderRadius: '2px', border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}>{t('analytics.heatmap.legendMid')}</span>
          <span style={{ display: 'inline-block', width: '12px', height: '12px', background: 'rgba(239,68,68,0.22)', borderRadius: '2px', border: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text-muted)' }}>{t('analytics.heatmap.legendLow')}</span>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1.25rem', padding: '0.75rem 1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {t('analytics.heatmap.departmentLabel')}
          </label>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            style={{ padding: '0.35rem 0.6rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
          >
            <option value="">{t('analytics.heatmap.allDepartments')}</option>
            {availableDepts.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.78rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={sortByAvg}
            onChange={(e) => setSortByAvg(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          {t('analytics.heatmap.sortByLowest')}
        </label>

        {(deptFilter || sortByAvg) && (
          <button
            className="btn-ghost"
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', marginLeft: 'auto' }}
            onClick={() => { setDeptFilter(''); setSortByAvg(false); }}
          >
            {t('analytics.heatmap.clearFilters')}
          </button>
        )}
      </div>

      {/* Empty state — shown after filters so user can change selection */}
      {isEmpty && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {(data as any)?.message || t('analytics.heatmap.emptyState')}
        </div>
      )}

      {/* Heatmap table */}
      {!isEmpty && <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '600px' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', minWidth: '160px' }}>
              {t('analytics.heatmap.sectionHeader')}
            </th>
            {(departments as string[]).map((dept) => (
              <th key={dept} style={{ padding: '0.5rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.72rem', textAlign: 'center', maxWidth: '110px' }} title={dept}>
                {dept.length > 14 ? dept.slice(0, 13) + '\u2026' : dept}
              </th>
            ))}
            {/* Org average column — only shown when no dept filter active */}
            {!deptFilter && (
              <th style={{ padding: '0.5rem 0.5rem', color: 'var(--accent)', fontWeight: 700, fontSize: '0.72rem', textAlign: 'center', borderLeft: '2px solid var(--border)', whiteSpace: 'nowrap' }}>
                {t('analytics.orgAvg')}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {displayGrid.map((row: any) => {
            const avg = orgAvg(row);
            return (
              <tr key={row.section} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.55rem 0.75rem', fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                  {row.section}
                </td>
                {row.values.map((cell: any) => (
                  <td
                    key={cell.department}
                    style={{
                      padding: '0.55rem 0.5rem',
                      textAlign: 'center',
                      background: cell.privacyRestricted ? 'transparent' : heatColor(cell.avg, row.maxScale ?? 10),
                      fontWeight: cell.avg !== null ? 700 : 400,
                      color: cell.privacyRestricted ? 'var(--text-muted)' : cell.avg !== null ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontSize: '0.82rem',
                    }}
                    title={cell.privacyRestricted ? t('analytics.heatmap.privacyTitle', { threshold: privacyThreshold }) : cell.avg !== null ? t('analytics.heatmap.cellTooltip', { count: cell.count, max: row.maxScale ?? 10 }) : t('analytics.heatmap.cellNoData')}
                  >
                    {cell.privacyRestricted ? '\uD83D\uDD12' : cell.avg !== null ? cell.avg.toFixed(1) : '\u2014'}
                  </td>
                ))}
                {/* Org average cell */}
                {!deptFilter && (
                  <td
                    style={{
                      padding: '0.55rem 0.5rem',
                      textAlign: 'center',
                      borderLeft: '2px solid var(--border)',
                      background: avg !== null ? heatColor(avg, row.maxScale ?? 10) : 'transparent',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      color: avg !== null ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                    title={avg !== null ? t('analytics.heatmap.orgAvgTitle', { avg: avg.toFixed(2), max: row.maxScale ?? 10 }) : t('analytics.heatmap.noDataTitle')}
                  >
                    {avg !== null ? avg.toFixed(1) : '\u2014'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>}

      {!isEmpty && hasPrivacyRows && (
        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
          {'\uD83D\uDD12 '}{t('analytics.heatmap.privacyFooter', { threshold: privacyThreshold })}
        </p>
      )}
    </div>
  );
}

/* ─── Bell Curve Section ──────────────────────────────────────────── */

function BellCurveSection({ cycleId }: { cycleId: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useBellCurve(cycleId);

  if (isLoading) return <Spinner />;
  if (!data || !data.histogram || data.count === 0) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('analytics.noDataCurve')}</p>
      </div>
    );
  }

  if (data.privacyRestricted) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--warning)', fontSize: '0.85rem', fontWeight: 600 }}>
          {data.message || t('analytics.minDataRequired')}
        </p>
      </div>
    );
  }

  const total = data.count || 1;
  let cntLow = 0, cntMid = 0, cntHigh = 0;
  for (const bucket of (data.histogram as any[])) {
    const start = parseFloat((bucket.range as string).split('-')[0]);
    if (!isNaN(start)) {
      if (start < 4) cntLow += bucket.count;
      else if (start < 7) cntMid += bucket.count;
      else cntHigh += bucket.count;
    }
  }
  const pctLow = Math.round((cntLow / total) * 100);
  const pctMid = Math.round((cntMid / total) * 100);
  const pctHigh = Math.round((cntHigh / total) * 100);

  const mean = Number(data.mean);
  const stddev = Number(data.stddev);

  const meanMsg =
    mean >= 7.5 ? { text: t('analytics.alertLeniency'), color: 'var(--success)' }
    : mean >= 6.0 ? { text: t('analytics.alertLeniency'), color: 'var(--success)' }
    : mean >= 4.5 ? { text: t('analytics.alertCentral'), color: 'var(--warning)' }
    : { text: t('analytics.alertHarshness'), color: 'var(--danger)' };

  const dispMsg =
    stddev < 1.0 ? { text: t('analytics.dispersionLow', { stddev: data.stddev }), icon: '⚠️' }
    : stddev > 2.5 ? { text: t('analytics.dispersionHigh', { stddev: data.stddev }), icon: '⚠️' }
    : { text: t('analytics.dispersionNormal', { stddev: data.stddev }), icon: '✅' };

  const biasMsg =
    pctHigh > 60 ? t('analytics.alertLeniency')
    : pctLow > 60 ? t('analytics.alertHarshness')
    : pctMid > 65 ? t('analytics.alertCentral')
    : null;

  return (
    <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem' }}>
        {t('analytics.distributionTitle')}
      </h2>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        {t('analytics.bell.subtitle')}
      </p>

      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.85rem', fontSize: '0.8rem', flexWrap: 'wrap' }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>{t('analytics.bell.avgLabel')} </span>
          <span style={{ fontWeight: 700, color: 'var(--accent)' }}>{data.mean}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>{t('analytics.stdDev')} </span>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{data.stddev}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>{t('analytics.bell.totalEvals')} </span>
          <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{data.count}</span>
        </div>
      </div>

      <div style={{ padding: '0.55rem 0.85rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem', fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>{t('analytics.howToRead')}</strong>
        {' '}{t('analytics.howToReadDesc')}
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data.histogram} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="range" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} interval={1} />
          <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <Tooltip
            content={({ active, payload }: any) => {
              if (!active || !payload?.length) return null;
              const d = payload[0]?.payload;
              return (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.85rem', fontSize: '0.78rem' }}>
                  <p style={{ fontWeight: 700 }}>{t('analytics.bell.tooltipRange')} {d?.rangeLabel}</p>
                  <p style={{ color: '#6366f1' }}>{t('analytics.bell.tooltipCount')} {d?.count}</p>
                  <p style={{ color: '#f59e0b' }}>{t('analytics.bell.tooltipNormal')} {d?.normalY?.toFixed(1)}</p>
                </div>
              );
            }}
          />
          <Bar dataKey="count" fill="#6366f1" fillOpacity={0.7} radius={[2, 2, 0, 0]} name={t('analytics.bell.barName')} />
          <Area type="monotone" dataKey="normalY" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.1} strokeWidth={2} name={t('analytics.bell.areaName')} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Análisis de resultados */}
      <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
        <p style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.85rem', color: 'var(--text-primary)' }}>
          {t('analytics.analysisTitle')}
        </p>

        <div style={{ marginBottom: '1rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('analytics.distributionZone')}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {[
              { label: t('analytics.zoneLow'), pct: pctLow, cnt: cntLow, color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
              { label: t('analytics.zoneMid'), pct: pctMid, cnt: cntMid, color: 'var(--warning)', bg: 'rgba(245,158,11,0.08)' },
              { label: t('analytics.zoneHigh'), pct: pctHigh, cnt: cntHigh, color: 'var(--success)', bg: 'rgba(16,185,129,0.08)' },
            ].map((z) => (
              <div key={z.label} style={{ flex: '1 1 120px', padding: '0.6rem 0.85rem', background: z.bg, borderRadius: 'var(--radius-sm)', border: `1px solid ${z.color}33` }}>
                <p style={{ fontSize: '1.3rem', fontWeight: 800, color: z.color, margin: 0 }}>{z.pct}%</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.1rem 0 0' }}>{z.label}</p>
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: 0 }}>{z.cnt} {z.cnt !== 1 ? t('analytics.bell.personsPlural') : t('analytics.bell.persons')}</p>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <span style={{ color: meanMsg.color, fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>
              {mean >= 6.0 ? '✅' : mean >= 4.5 ? '⚠️' : '🔴'}
            </span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <strong>{t('analytics.bell.centralTrend')}</strong> {meanMsg.text}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
            <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>{dispMsg.icon}</span>
            <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <strong>{t('analytics.dispersion')}</strong> {dispMsg.text}
            </span>
          </div>

          {biasMsg && (
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.82rem' }}>
              <span style={{ fontSize: '1rem', flexShrink: 0, marginTop: '0.05rem' }}>🔔</span>
              <span style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                <strong>{t('analytics.distributionAlert')}</strong> {biasMsg.replace(/^⚠️\s*/, '')}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


const selectStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm, 6px)',
  color: 'var(--text-primary)',
  fontSize: '0.85rem',
  outline: 'none',
  minWidth: '250px',
};

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://evaluacion-desempeno-api.onrender.com';

/* ─── Bias constants ─────────────────────────────────────────────── */
const BIAS_TYPE_KEYS: Record<string, string> = {
  leniency: 'analytics.bias.typeLeniency',
  severity: 'analytics.bias.typeSeverity',
  halo: 'analytics.bias.typeHalo',
  central_tendency: 'analytics.bias.typeCentral',
  contrast: 'analytics.bias.typeContrast',
};
const severityBadge: Record<string, string> = {
  high: 'badge-danger', medium: 'badge-warning', low: 'badge-success',
};

/* ─── Bias Analysis Section (moved from analytics-ciclos) ────────── */
function BiasAnalysisSection({ cycleId, aiBlocked }: { cycleId: string; aiBlocked: boolean }) {
  const { t } = useTranslation();
  const { data: cached, isLoading } = useAiBias(cycleId);
  const analyze = useAnalyzeBias();
  const data = cached?.content; // AiInsight.content holds the actual bias analysis

  if (isLoading) return <Spinner />;

  if (!data) {
    return (
      <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'🔍'}</p>
        <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{t('analytics.bias.noAnalysis')}</p>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('analytics.bias.creditNote')}</p>
        <button className="btn-primary" style={{ fontSize: '0.85rem' }}
          disabled={analyze.isPending || aiBlocked}
          onClick={() => analyze.mutate(cycleId)}>
          {analyze.isPending ? t('analytics.bias.analyzing') : t('analytics.bias.analyzeBtn')}
        </button>
        {analyze.isError && <p style={{ color: 'var(--danger)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{(analyze.error as any)?.message || 'Error'}</p>}
      </div>
    );
  }

  const biases = data.biasesDetected || [];

  const handleExportBias = () => {
    let txt = `${t('analytics.bias.exportTitle', { cycleId: cycleId.slice(0, 8) })}\n${t('analytics.bias.exportDate')} ${new Date().toLocaleDateString()}\n`;
    txt += `${t('analytics.bias.exportConfidence')} ${((data.confidenceLevel || 0) * 100).toFixed(0)}%\n\n`;
    txt += `${t('analytics.bias.exportOverall')}\n${data.overallAssessment}\n\n${t('analytics.bias.exportDataQuality')} ${data.dataQuality}\n\n`;
    if (biases.length > 0) {
      txt += `${t('analytics.bias.exportDetected', { count: biases.length })}:\n`;
      biases.forEach((b: any, i: number) => {
        txt += `\n${i + 1}. ${BIAS_TYPE_KEYS[b.type] ? t(BIAS_TYPE_KEYS[b.type]) : b.type} (${b.severity})\n`;
        txt += `   ${t('analytics.bias.exportEvaluator')} ${b.evaluatorName}\n   ${t('analytics.bias.exportEvidence')} ${b.evidence}\n`;
        if (b.affectedEvaluatees?.length) txt += `   ${t('analytics.bias.exportAffected')} ${b.affectedEvaluatees.join(', ')}\n`;
        txt += `   ${t('analytics.bias.exportRecommendation')} ${b.recommendation}\n`;
      });
    }
    const blob = new Blob([txt], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `informe-sesgos-${cycleId.slice(0, 8)}.txt`;
    a.click();
  };

  return (
    <div>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.bias.detected')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: biases.length > 0 ? 'var(--danger)' : 'var(--success)' }}>{biases.length}</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.bias.confidence')}</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--accent)' }}>{((data.confidenceLevel || 0) * 100).toFixed(0)}%</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.bias.dataQuality')}</div>
          <div title={data.dataQuality || ''} style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }}>
            {(data.dataQuality || '—').split('.')[0] || '—'}
          </div>
        </div>
      </div>

      {/* Overall assessment */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{data.overallAssessment}</p>
      </div>

      {/* Bias cards */}
      {biases.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1rem' }}>
          {biases.map((b: any, i: number) => (
            <div key={i} className="card" style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{BIAS_TYPE_KEYS[b.type] ? t(BIAS_TYPE_KEYS[b.type]) : b.type}</span>
                <span className={`badge ${severityBadge[b.severity] || 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>{b.severity}</span>
              </div>
              <p style={{ fontSize: '0.82rem', marginBottom: '0.3rem' }}><strong>{t('analytics.bias.evaluator')}</strong> {b.evaluatorName}</p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{b.evidence}</p>
              {b.affectedEvaluatees?.length > 0 && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('analytics.bias.affected')} {b.affectedEvaluatees.join(', ')}</p>}
              <p style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600 }}>{b.recommendation}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--success)', fontWeight: 600 }}>
          {'✅'} {t('analytics.bias.noBiasDetected')}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={handleExportBias}>{t('analytics.bias.exportTxt')}</button>
      </div>
      <p style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{t('analytics.bias.footer')}</p>
    </div>
  );
}

function AnalyticsPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const userId = useAuthStore((s) => s.user?.userId);
  const isManager = role === 'manager';
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';
  const toast = useToastStore();
  const { isBlocked: aiBlocked } = useAiQuota();
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const { data: analytics, isLoading: loadingAnalytics } = useAnalytics(selectedCycleId);
  const [showGuide, setShowGuide] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('scores');

  // Manager: org-wide analytics for comparative sections
  const [orgAnalytics, setOrgAnalytics] = useState<any>(null);
  const [myDepartment, setMyDepartment] = useState<string>('');
  const [compareDept, setCompareDept] = useState('');

  // Load manager's department (only once, not per cycle)
  useEffect(() => {
    if (!isManager || !token || !userId) return;
    fetch(`${BASE_URL}/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((u: any) => { if (u?.department) setMyDepartment(u.department); })
      .catch(() => {});
  }, [isManager, token, userId]);

  // Load org-wide analytics for comparative sections (resets on cycle change)
  useEffect(() => {
    if (!isManager || !token || !selectedCycleId) return;
    setOrgAnalytics(null);
    setCompareDept('');
    fetch(`${BASE_URL}/reports/analytics?cycleId=${selectedCycleId}&scope=org`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.ok ? r.json() : null).then(setOrgAnalytics).catch(() => {});
  }, [isManager, token, selectedCycleId]);

  // Dept tab uses org data for managers (comparative); other tabs use team data
  const deptData = isManager && orgAnalytics ? orgAnalytics : analytics;

  const handleExport = async (format: 'xlsx' | 'pdf' | 'pptx') => {
    if (!selectedCycleId || !token) return;
    setExporting(format);
    try {
      const url = `${BASE_URL}/reports/analytics/cycle/${selectedCycleId}/export?format=${format}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(t('analytics.exportError'));
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `analisis-ciclo-${selectedCycleId}.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err: any) {
      toast.error(err.message || t('analytics.exportError'));
    } finally {
      setExporting(null);
    }
  };

  // Only show closed cycles (analysis requires completed data)
  const sortedCycles = cycles
    ? cycles.filter((c: any) => c.status === 'closed')
    : [];

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || !payload.length) return null;
    return (
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.6rem 0.85rem',
        fontSize: '0.78rem',
      }}>
        <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color || 'var(--text-secondary)' }}>
            {entry.name || entry.dataKey}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>{t('analytics.title')}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('analytics.subtitle')}
        </p>
      </div>

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ transition: 'transform 0.2s', transform: showGuide ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>▶</span>
          {showGuide ? t('analytics.hideGuide') : t('analytics.showGuide')}
        </button>

        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginTop: '0.75rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              {t('analytics.guide.title')}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
              {t('analytics.guide.desc')}
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('analytics.guide.chartsTitle')}</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li>{t('analytics.guide.chartBell')}</li>
                <li>{t('analytics.guide.chartDept')}</li>
                <li>{t('analytics.guide.chartHeatmap')}</li>
                <li>{t('analytics.guide.chartManagers')}</li>
              </ul>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('analytics.guide.connectionsTitle')}</div>
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <li>{t('analytics.guide.connReports')}</li>
                <li>{t('analytics.guide.connCalibration')}</li>
                <li>{t('analytics.guide.connTalent')}</li>
              </ul>
            </div>

            <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <strong style={{ color: 'var(--accent)' }}>{t('analytics.guide.permissions')}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Cycle selector */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        {loadingCycles ? (
          <Spinner />
        ) : !sortedCycles.length ? (
          <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('analytics.noCycles')}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {t('analytics.cycleLabel')}
            </label>
            <select
              style={selectStyle}
              value={selectedCycleId || ''}
              onChange={(e) => setSelectedCycleId(e.target.value || null)}
            >
              <option value="">{t('analytics.selectCycle')}</option>
              {sortedCycles.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
              {t('analytics.closedCyclesOnly')}
            </span>

            {/* Export buttons */}
            {selectedCycleId && (
              <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                {(['xlsx', 'pdf', 'pptx'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    className="btn-ghost"
                    onClick={() => handleExport(fmt)}
                    disabled={!!exporting}
                    style={{
                      fontSize: '0.82rem',
                      padding: '0.4rem 0.85rem',
                      opacity: exporting ? 0.5 : 1,
                      cursor: exporting ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {exporting === fmt
                      ? t('common.exporting')
                      : fmt === 'xlsx' ? t('common.exportExcel')
                      : fmt === 'pdf' ? t('common.exportPdf')
                      : t('common.exportPptx')}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* No cycle selected */}
      {!selectedCycleId && !loadingCycles && sortedCycles.length > 0 && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {t('analytics.selectCyclePrompt')}
          </p>
        </div>
      )}

      {/* Analytics content — Tab system */}
      {selectedCycleId && (
        <>
          {loadingAnalytics ? (
            <Spinner />
          ) : !analytics ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('analytics.noAnalysisData')}</p>
            </div>
          ) : (
            <>
              {/* Manager KPIs (always visible above tabs) */}
              {isManager && analytics?.teamBenchmarks && (() => {
                const myTeam = analytics?.teamBenchmarks.find((tb: any) => tb.managerId === userId);
                return myTeam ? (
                  <div className="animate-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
                    <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analytics.manager.myTeam')}</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{myTeam.teamSize}</div>
                    </div>
                    <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analytics.manager.teamAvg')}</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: Number(myTeam.avgScore) >= 7 ? 'var(--success)' : Number(myTeam.avgScore) >= 5 ? 'var(--warning)' : 'var(--danger)' }}>{Number(myTeam.avgScore).toFixed(1)}/10</div>
                    </div>
                    {myDepartment && <div className="card" style={{ padding: '0.85rem', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>{t('analytics.manager.department')}</div>
                      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)' }}>{myDepartment}</div>
                    </div>}
                  </div>
                ) : null;
              })()}

              {/* Tab Bar */}
              <div className="animate-fade-up" style={{ display: 'flex', gap: '0.15rem', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)', overflowX: 'auto' }}>
                {TAB_CONFIG.filter(tab => !tab.adminOnly || isAdmin).map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                    style={{
                      padding: '0.55rem 1rem', fontSize: '0.78rem', whiteSpace: 'nowrap',
                      fontWeight: activeTab === tab.key ? 700 : 400,
                      color: activeTab === tab.key ? 'var(--accent)' : 'var(--text-muted)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      borderBottom: activeTab === tab.key ? '2px solid var(--accent)' : '2px solid transparent',
                      marginBottom: '-2px', transition: 'all 0.2s ease',
                    }}>
                    {t(tab.labelKey)}
                  </button>
                ))}
              </div>

              {/* ── Tab 1: Distribución de Puntajes ──────────────────── */}
              {activeTab === 'scores' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <BellCurveSection cycleId={selectedCycleId} />
                </div>
              )}

              {/* ── Tab 2: Comparación por Departamento ──────────────── */}
              {activeTab === 'departments' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* KPIs */}
                  {(() => {
                    const deptComps = (deptData?.departmentComparison || []);
                    const sorted = [...deptComps].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
                    const orgAvgScore = sorted.length > 0 ? sorted.reduce((s: number, d: any) => s + Number(d.avgScore || 0), 0) / sorted.length : 0;
                    const best = sorted[0];
                    const worst = sorted[sorted.length - 1];
                    return sorted.length > 0 ? (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.dept.bestDept')}</div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--success)' }}>{best?.department}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Number(best?.avgScore).toFixed(1)}/10</div>
                        </div>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.dept.worstScore')}</div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--danger)' }}>{worst?.department}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Number(worst?.avgScore).toFixed(1)}/10</div>
                        </div>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.dept.orgAvg')}</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{orgAvgScore.toFixed(1)}</div>
                        </div>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.dept.deptCount')}</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#6366f1' }}>{sorted.length}</div>
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Manager comparative header */}
                  {isManager && orgAnalytics && (
                    <div style={{ borderTop: '3px solid var(--accent)', paddingTop: '1rem' }}>
                      <h2 style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>{t('analytics.dept.comparativeTitle', { dept: myDepartment || t('analytics.manager.department') })}</h2>
                      <select className="input" value={compareDept} onChange={(e) => setCompareDept(e.target.value)} style={{ fontSize: '0.82rem', maxWidth: '300px', marginBottom: '1rem' }}>
                        <option value="">{t('analytics.dept.allDepts')}</option>
                        {(orgAnalytics.departmentComparison || []).filter((d: any) => d.department !== myDepartment).map((d: any) => (
                          <option key={d.department} value={d.department}>{d.department}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Chart */}
                  {(deptData?.departmentComparison)?.length > 0 && (
                    <div className="card" style={{ padding: '1.5rem' }}>
                      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1.25rem' }}>{t('analytics.dept.chartTitle')}</h2>
                      {(() => {
                        const rawData = (deptData?.departmentComparison || []);
                        const chartData = rawData
                          .filter((d: any) => !isManager || !compareDept || d.department === myDepartment || d.department === compareDept)
                          .map((d: any) => ({ department: d.department || t('analytics.dept.noDept'), avgScore: Number(d.avgScore) || 0, count: d.count, isMyDept: d.department === myDepartment }));
                        return (
                          <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 45)}>
                            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                              <XAxis type="number" domain={[0, 10]} tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                              <YAxis type="category" dataKey="department" width={120} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                              <Tooltip content={customTooltip} />
                              <Bar dataKey="avgScore" name={t('analytics.dept.avgScoreName')} radius={[0, 4, 4, 0]}>
                                {chartData.map((d: any, idx: number) => (
                                  <Cell key={idx} fill={isManager && d.isMyDept ? '#C9933A' : '#6366f1'} />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  )}

                  {/* Manager detailed analysis */}
                  {isManager && deptData?.departmentComparison && myDepartment && (() => {
                    const allDepts = [...(deptData?.departmentComparison || [])].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
                    const myRank = allDepts.findIndex((d: any) => d.department === myDepartment) + 1;
                    const orgAvgVal = allDepts.length > 0 ? allDepts.reduce((s: number, d: any) => s + Number(d.avgScore || 0), 0) / allDepts.length : 0;
                    const myScore = Number(allDepts.find((d: any) => d.department === myDepartment)?.avgScore || 0);
                    const above = myScore >= orgAvgVal;
                    return (
                      <div className="card" style={{ padding: '1.25rem', borderLeft: `4px solid ${above ? 'var(--success)' : 'var(--warning)'}` }}>
                        <h3 style={{ fontWeight: 700, fontSize: '0.9rem', color: above ? 'var(--success)' : 'var(--warning)', marginBottom: '0.5rem' }}>{t('analytics.dept.detailedTitle')}</h3>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                          <p style={{ margin: '0 0 0.3rem' }}><strong>{t('analytics.dept.position')}</strong> {t('analytics.dept.positionText', { rank: myRank, total: allDepts.length })} <strong>{myScore.toFixed(1)}/10</strong>.</p>
                          <p style={{ margin: '0 0 0.3rem' }}><strong>{t('analytics.dept.vsOrg')}</strong> {t('analytics.dept.orgAvgText', { avg: orgAvgVal.toFixed(1) })} <strong style={{ color: above ? 'var(--success)' : 'var(--danger)' }}>{above ? t('analytics.dept.above') : t('analytics.dept.below')}</strong> {t('analytics.dept.byPts', { pts: Math.abs(myScore - orgAvgVal).toFixed(1) })}</p>
                          {myRank === 1 && <p style={{ margin: 0 }}>{'🏆'} <strong>{t('analytics.dept.leadsRanking')}</strong></p>}
                          {myRank === allDepts.length && <p style={{ margin: 0 }}>{'⚠️'} {t('analytics.dept.lastPosition')}</p>}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Tab 3: Mapa de Competencias ──────────────────────── */}
              {activeTab === 'competencies' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <CompetencyHeatmapSection cycleId={selectedCycleId} />
                </div>
              )}

              {/* ── Tab 4: Rendimiento por Equipos ───────────────────── */}
              {activeTab === 'teams' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* KPIs */}
                  {analytics?.teamBenchmarks && analytics?.teamBenchmarks.length > 0 && (() => {
                    const sorted = [...analytics?.teamBenchmarks].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore));
                    const best = sorted[0];
                    const worst = sorted[sorted.length - 1];
                    const avgAll = sorted.reduce((s: number, t: any) => s + Number(t.avgScore || 0), 0) / sorted.length;
                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.teams.bestTeam')}</div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--success)' }}>{best?.managerName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Number(best?.avgScore).toFixed(1)}/10</div>
                        </div>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.teams.atRisk')}</div>
                          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--danger)' }}>{worst?.managerName}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{Number(worst?.avgScore).toFixed(1)}/10</div>
                        </div>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.teams.teamsAvg')}</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{avgAll.toFixed(1)}</div>
                        </div>
                        <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '0.2rem' }}>{t('analytics.teams.totalTeams')}</div>
                          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#6366f1' }}>{sorted.length}</div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Table */}
                  {analytics?.teamBenchmarks && analytics?.teamBenchmarks.length > 0 && (
                    <div className="card" style={{ padding: '1.5rem' }}>
                      <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>
                        {isManager ? t('analytics.teams.titleManager') : t('analytics.teams.titleAdmin')}
                      </h2>
                      <div className="table-wrapper">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                          <thead><tr>{[t('analytics.teams.tableHeaderManager'), t('analytics.teams.tableHeaderDept'), t('analytics.teams.tableHeaderAvg'), t('analytics.teams.tableHeaderTeam')].map(h => <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>{h}</th>)}</tr></thead>
                          <tbody>
                            {[...analytics?.teamBenchmarks].sort((a: any, b: any) => Number(b.avgScore) - Number(a.avgScore)).map((tb: any, i: number) => {
                              const isMe = tb.managerId === userId;
                              const score = Number(tb.avgScore) || 0;
                              return (
                                <tr key={i} style={{ background: isMe ? 'rgba(201,147,58,0.08)' : 'transparent' }}>
                                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: isMe ? 700 : 500, fontSize: '0.85rem', borderBottom: '1px solid var(--border)', color: isMe ? 'var(--accent)' : 'var(--text-primary)' }}>{tb.managerName}{isMe ? ` ${t('analytics.teams.youMarker')}` : ''}</td>
                                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.82rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{tb.department || '—'}</td>
                                  <td style={{ padding: '0.5rem 0.75rem', fontWeight: 700, color: score >= 7 ? 'var(--success)' : score >= 5 ? 'var(--warning)' : 'var(--danger)', borderBottom: '1px solid var(--border)' }}>{score.toFixed(1)}</td>
                                  <td style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)' }}>{tb.teamSize}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {(!analytics?.teamBenchmarks || analytics?.teamBenchmarks.length === 0) && (
                    <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>{t('analytics.teams.noData')}</div>
                  )}
                </div>
              )}

              {/* ── Tab 5: Detección de Sesgos (admin only) ──────────── */}
              {activeTab === 'bias' && isAdmin && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <AiQuotaBar />
                  <BiasAnalysisSection cycleId={selectedCycleId} aiBlocked={aiBlocked} />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <PlanGate feature="ADVANCED_REPORTS">
      <AnalyticsPageContent />
    </PlanGate>
  );
}
