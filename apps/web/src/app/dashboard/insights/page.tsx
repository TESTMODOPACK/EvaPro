'use client';
import { PlanGate } from '@/components/PlanGate';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useCycles } from '@/hooks/useCycles';
import { useUsers } from '@/hooks/useUsers';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import {
  useAiSummary, useGenerateSummary,
  useAiBias, useAnalyzeBias,
  useAiSuggestions, useGenerateSuggestions,
  useFlightRisk,
  usePerformancePrediction, useRetentionRecommendations, useExplainability,
} from '@/hooks/useAiInsights';

type Tab = 'summary' | 'bias' | 'suggestions' | 'flight-risk' | 'prediction' | 'retention';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const priorityColor: Record<string, string> = {
  alta: 'var(--danger)',
  media: '#f59e0b',
  baja: 'var(--success)',
};

const typeLabel: Record<string, string> = {
  curso: 'Curso',
  mentoria: 'Mentor\u00eda',
  proyecto: 'Proyecto',
  taller: 'Taller',
  lectura: 'Lectura',
  rotacion: 'Rotaci\u00f3n',
  certificacion: 'Certificaci\u00f3n',
  coaching: 'Coaching',
};

const biasTypeLabel: Record<string, string> = {
  leniency: 'Lenidad',
  severity: 'Severidad',
  halo: 'Efecto Halo',
  central_tendency: 'Tendencia Central',
  contrast: 'Contraste',
};

const severityBadge: Record<string, string> = {
  high: 'badge-danger',
  medium: 'badge-warning',
  low: 'badge-success',
};

/* ─── Summary Tab ──────────────────────────────────────────────────── */

function SummarySection({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const { data: cached, isLoading } = useAiSummary(cycleId, userId);
  const generate = useGenerateSummary();

  const handleDownloadPdf = async () => {
    if (!token) return;
    try {
      const url = api.ai.exportSummaryPdf(token, cycleId, userId);
      const res = await fetch(url as unknown as string, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Error');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `informe-ia-${userId}.pdf`;
      a.click();
    } catch {}
  };

  if (isLoading) return <Spinner />;

  const data = cached?.content;

  if (!data) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{'🤖'}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
          {t('insights.noSummary')}
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '1rem' }}>
          Cada generación consume 1 crédito de la cuota mensual de tu organización.
        </p>
        <button
          className="btn-primary"
          onClick={() => generate.mutate({ cycleId, userId })}
          disabled={generate.isPending}
        >
          {generate.isPending ? t('insights.generating') : t('insights.generateBtn')}
        </button>
        {generate.isPending && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {t('insights.generatingHint')} Este proceso puede tardar hasta 30 segundos.
          </p>
        )}
        {generate.isError && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--danger)' }}>
            Error al generar. El proceso puede haber tardado más de lo esperado. Recarga la página para verificar si el informe fue generado.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Download PDF button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={handleDownloadPdf}>
          {'📄'} {t('insights.downloadPdf')}
        </button>
      </div>
      {/* Executive Summary */}
      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>{t('insights.execSummary')}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.executiveSummary}</p>
      </div>

      {/* Strengths & Areas */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--success)', marginBottom: '0.5rem' }}>{'\u2705 Fortalezas'}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {(data.strengths || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: '#f59e0b', marginBottom: '0.5rem' }}>{'\u26A0\uFE0F \u00c1reas de Mejora'}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {(data.areasForImprovement || []).map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      </div>

      {/* Perception Gap & Trend */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {data.perceptionGap && (
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem' }}>{'Brecha de Percepci\u00f3n'}</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.perceptionGap}</p>
          </div>
        )}
        {data.trend && (
          <div className="card" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem' }}>{'Tendencia'}</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.trend}</p>
          </div>
        )}
      </div>

      {/* Recommendations */}
      {data.recommendations && data.recommendations.length > 0 && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.5rem' }}>{'Recomendaciones'}</h3>
          <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {data.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
          </ol>
        </div>
      )}

      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {'Generado por IA (Claude) \u2022 Los resultados son orientativos y deben ser validados por el encargado'}
      </p>
    </div>
  );
}

/* ─── Bias Tab ──────────────────────────────────────────────────────── */

function BiasSection({ cycleId }: { cycleId: string }) {
  const { data: cached, isLoading } = useAiBias(cycleId);
  const analyze = useAnalyzeBias();

  if (isLoading) return <Spinner />;

  const data = cached?.content;

  if (!data) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{'\uD83D\uDD0D'}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          {'No hay an\u00e1lisis de sesgos para este ciclo'}
        </p>
        <button
          className="btn-primary"
          onClick={() => analyze.mutate(cycleId)}
          disabled={analyze.isPending}
        >
          {analyze.isPending ? 'Analizando sesgos...' : 'Analizar Sesgos con IA'}
        </button>
        {analyze.isPending && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {'Analizando patrones estad\u00edsticos del ciclo...'}
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Overall Assessment */}
      <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{'Evaluaci\u00f3n General'}</h3>
          {data.confidenceLevel != null && (
            <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>
              {'Confianza: '}{Math.round(data.confidenceLevel * 100)}{'%'}
            </span>
          )}
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.overallAssessment}</p>
        {data.dataQuality && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>{data.dataQuality}</p>
        )}
      </div>

      {/* Biases */}
      {data.biasesDetected && data.biasesDetected.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{'Sesgos Detectados ('}{data.biasesDetected.length}{')'}</h3>
          {data.biasesDetected.map((b: any, i: number) => (
            <div key={i} className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{biasTypeLabel[b.type] || b.type}</span>
                <span className={`badge ${severityBadge[b.severity] || 'badge-accent'}`} style={{ fontSize: '0.65rem' }}>
                  {b.severity === 'high' ? 'Alta' : b.severity === 'medium' ? 'Media' : 'Baja'}
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                <strong>{'Evaluador:'}</strong> {b.evaluatorName}
              </p>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                <strong>{'Evidencia:'}</strong> {b.evidence}
              </p>
              {b.affectedEvaluatees && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {'Evaluados afectados: '}{b.affectedEvaluatees.join(', ')}
                </p>
              )}
              {b.recommendation && (
                <p style={{ fontSize: '0.78rem', color: 'var(--accent)', marginTop: '0.3rem', fontWeight: 600 }}>
                  {'\u2192 '}{b.recommendation}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--success)', fontSize: '1.2rem', marginBottom: '0.25rem' }}>{'\u2705'}</p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{'No se detectaron sesgos significativos en este ciclo'}</p>
        </div>
      )}

      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {'Generado por IA (Claude) \u2022 Solo visible para administradores'}
      </p>
    </div>
  );
}

/* ─── Suggestions Tab ────────────────────────────────────────────────── */

function SuggestionsSection({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data: cached, isLoading } = useAiSuggestions(cycleId, userId);
  const generate = useGenerateSuggestions();

  if (isLoading) return <Spinner />;

  const data = cached?.content;

  if (!data) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{'\uD83D\uDCA1'}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          {'No hay sugerencias de desarrollo generadas para este colaborador'}
        </p>
        <button
          className="btn-primary"
          onClick={() => generate.mutate({ cycleId, userId })}
          disabled={generate.isPending}
        >
          {generate.isPending ? 'Generando sugerencias...' : 'Generar Sugerencias con IA'}
        </button>
        {generate.isPending && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Este proceso puede tardar hasta 30 segundos. No cierres esta página.
          </p>
        )}
        {generate.isError && (
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--danger)' }}>
            Error al generar. El proceso puede haber tardado más de lo esperado. Recarga la página para verificar.
          </p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Focus & Career */}
      {data.developmentFocus && (
        <div className="card" style={{ padding: '1.25rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.5rem' }}>{'Foco de Desarrollo'}</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.developmentFocus}</p>
        </div>
      )}

      {data.careerPath && (
        <div className="card" style={{ padding: '1.25rem' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: '0.5rem' }}>{'Trayectoria Profesional Sugerida'}</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.careerPath}</p>
        </div>
      )}

      {/* Quick Wins */}
      {data.quickWins && data.quickWins.length > 0 && (
        <div className="card" style={{ padding: '1.25rem', background: 'rgba(16,185,129,0.05)' }}>
          <h3 style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--success)', marginBottom: '0.5rem' }}>{'\u26A1 Acciones R\u00e1pidas (esta semana)'}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {data.quickWins.map((w: string, i: number) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Suggested Actions */}
      {data.suggestedActions && data.suggestedActions.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700 }}>{'Acciones de Desarrollo Sugeridas ('}{data.suggestedActions.length}{')'}</h3>
          {data.suggestedActions.map((a: any, i: number) => (
            <div key={i} className="card" style={{ padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{a.title}</span>
                <span className="badge badge-accent" style={{ fontSize: '0.65rem' }}>{typeLabel[a.type] || a.type}</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: priorityColor[a.priority] || 'var(--text-muted)' }}>
                  {'Prioridad '}{a.priority}
                </span>
              </div>
              {a.competencyName && (
                <p style={{ fontSize: '0.78rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>
                  {'Competencia: '}{a.competencyName}
                </p>
              )}
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{a.justification}</p>
              {a.estimatedDuration && (
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{'Duraci\u00f3n estimada: '}{a.estimatedDuration}</p>
              )}
            </div>
          ))}
        </>
      )}

      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {'Generado por IA (Claude) \u2022 Las sugerencias deben ser validadas por el encargado antes de aplicarlas'}
      </p>
    </div>
  );
}

/* ─── Flight Risk Tab ───────────────────────────────────────────────── */

const riskBadge: Record<string, { cls: string; label: string }> = {
  low:    { cls: 'badge-success', label: 'Bajo' },
  medium: { cls: 'badge-warning', label: 'Medio' },
  high:   { cls: 'badge-danger',  label: 'Alto' },
};

function FlightRiskSection() {
  const { t } = useTranslation();
  const { data, isLoading, error } = useFlightRisk();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [searchFR, setSearchFR] = useState('');
  const [deptFilterFR, setDeptFilterFR] = useState('');
  const [riskFilterFR, setRiskFilterFR] = useState('');
  const [pageFR, setPageFR] = useState(1);
  const PAGE_SIZE = 20;

  if (isLoading) return <Spinner />;

  if (error || !data) {
    return (
      <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{'📊'}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {t('insights.flightRiskError')}
        </p>
      </div>
    );
  }

  const { summary, scores, generatedAt, totalEmployees } = data;
  const allScores = [...(scores as any[])].sort((a: any, b: any) => b.riskScore - a.riskScore);
  const departments = Array.from(new Set(allScores.map((s: any) => s.department).filter(Boolean))).sort() as string[];

  // Apply filters
  let filtered = allScores;
  if (searchFR) {
    const q = searchFR.toLowerCase();
    filtered = filtered.filter((s: any) => (s.name || '').toLowerCase().includes(q));
  }
  if (deptFilterFR) filtered = filtered.filter((s: any) => s.department === deptFilterFR);
  if (riskFilterFR) filtered = filtered.filter((s: any) => s.riskLevel === riskFilterFR);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const paged = filtered.slice((pageFR - 1) * PAGE_SIZE, pageFR * PAGE_SIZE);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
        <div className="card" style={{ padding: '1rem', borderTop: '3px solid var(--success)', textAlign: 'center', cursor: 'pointer', opacity: !riskFilterFR || riskFilterFR === 'low' ? 1 : 0.5 }} onClick={() => { setRiskFilterFR(riskFilterFR === 'low' ? '' : 'low'); setPageFR(1); }}>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--success)', margin: 0 }}>{summary?.low ?? 0}</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>Riesgo Bajo</p>
        </div>
        <div className="card" style={{ padding: '1rem', borderTop: '3px solid #f59e0b', textAlign: 'center', cursor: 'pointer', opacity: !riskFilterFR || riskFilterFR === 'medium' ? 1 : 0.5 }} onClick={() => { setRiskFilterFR(riskFilterFR === 'medium' ? '' : 'medium'); setPageFR(1); }}>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f59e0b', margin: 0 }}>{summary?.medium ?? 0}</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>Riesgo Medio</p>
        </div>
        <div className="card" style={{ padding: '1rem', borderTop: '3px solid var(--danger)', textAlign: 'center', cursor: 'pointer', opacity: !riskFilterFR || riskFilterFR === 'high' ? 1 : 0.5 }} onClick={() => { setRiskFilterFR(riskFilterFR === 'high' ? '' : 'high'); setPageFR(1); }}>
          <p style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--danger)', margin: 0 }}>{summary?.high ?? 0}</p>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>Riesgo Alto</p>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '1rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)', width: '200px' }}
          placeholder="Buscar colaborador..." value={searchFR} onChange={(e) => { setSearchFR(e.target.value); setPageFR(1); }} />
        <select style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
          value={deptFilterFR} onChange={(e) => { setDeptFilterFR(e.target.value); setPageFR(1); }}>
          <option value="">Todos los departamentos</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
          value={riskFilterFR} onChange={(e) => { setRiskFilterFR(e.target.value); setPageFR(1); }}>
          <option value="">Todos los niveles</option>
          <option value="high">Alto</option>
          <option value="medium">Medio</option>
          <option value="low">Bajo</option>
        </select>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {totalFiltered} de {totalEmployees} colaboradores
        </span>
      </div>

      {/* Table */}
      <div className="card" style={{ padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 700, margin: 0 }}>
            Ranking de Riesgo
          </h3>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Actualizado: {new Date(generatedAt).toLocaleString('es-CL')}
          </span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>#</th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Colaborador</th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Departamento</th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Riesgo</th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Nivel</th>
              <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Factores</th>
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Sin resultados para los filtros seleccionados</td></tr>
            )}
            {paged.map((s: any, i: number) => {
                const badge = riskBadge[s.riskLevel] ?? riskBadge.low;
                const isOpen = expanded === s.userId;
                const globalIdx = (pageFR - 1) * PAGE_SIZE + i + 1;
                return (
                  <React.Fragment key={s.userId}>
                    <tr style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setExpanded(isOpen ? null : s.userId)}>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}>{globalIdx}</td>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{s.name}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)' }}>{s.department || '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, maxWidth: '80px', height: '6px', borderRadius: '3px', background: 'var(--border)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${s.riskScore}%`, background: s.riskLevel === 'high' ? 'var(--danger)' : s.riskLevel === 'medium' ? '#f59e0b' : 'var(--success)', borderRadius: '3px' }} />
                          </div>
                          <span style={{ fontWeight: 700, minWidth: '30px' }}>{s.riskScore}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem' }}><span className={`badge ${badge.cls}`} style={{ fontSize: '0.65rem' }}>{badge.label}</span></td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)' }}><span style={{ fontSize: '0.72rem' }}>{isOpen ? '▲' : `▼ ${(s.factors || []).length}`}</span></td>
                    </tr>
                    {isOpen && (s.factors || []).length > 0 && (
                      <tr style={{ background: 'rgba(99,102,241,0.03)' }}>
                        <td colSpan={6} style={{ padding: '0.75rem 1.5rem' }}>
                          <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                            {(s.factors || []).map((f: any, fi: number) => (
                              <li key={fi}>
                                <strong>{f.label || f}</strong>: {f.value || ''}
                                {f.impact && <span style={{ marginLeft: '0.3rem', color: f.impact === 'negative' ? 'var(--danger)' : f.impact === 'positive' ? 'var(--success)' : 'var(--text-muted)', fontSize: '0.72rem' }}>({f.impact === 'negative' ? 'riesgo' : f.impact === 'positive' ? 'favorable' : 'neutral'})</span>}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={pageFR <= 1} onClick={() => setPageFR(p => p - 1)}>Anterior</button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Página {pageFR} de {totalPages}</span>
            <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={pageFR >= totalPages} onClick={() => setPageFR(p => p + 1)}>Siguiente</button>
          </div>
        )}
      </div>

      <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right' }}>
        {t('insights.scoreNote')}
      </p>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────────── */

function InsightsPageContent() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const role = user?.role || '';
  const isAdmin = role === 'tenant_admin' || role === 'super_admin';

  const currentUserId = useAuthStore((s) => s.user?.userId);
  const { data: cycles, isLoading: loadingCycles } = useCycles();
  const { data: usersPage } = useUsers(1, 500);

  const token = useAuthStore((s) => s.token);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedDept, setSelectedDept] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('prediction');
  const [showGuide, setShowGuide] = useState(false);

  // Load usage quota via React Query (auto-refreshes when invalidated after generation)
  const { data: quota } = useQuery({
    queryKey: ['ai', 'quota'],
    queryFn: () => api.ai.getUsage(token!),
    enabled: !!token,
    staleTime: 30_000,
    retry: false,
  });

  const allUsers = usersPage?.data || [];
  // Managers only see their direct reports; admins see all
  const scopedUsers = role === 'manager'
    ? allUsers.filter((u: any) => u.managerId === currentUserId)
    : allUsers;
  // Extract unique departments
  const departments = Array.from(new Set(scopedUsers.map((u: any) => u.department).filter(Boolean))).sort() as string[];
  // Filter by department if selected
  const users = selectedDept
    ? scopedUsers.filter((u: any) => u.department === selectedDept)
    : scopedUsers;
  const sortedCycles = cycles
    ? [...cycles].sort((a: any, b: any) => {
        if (a.status === 'closed' && b.status !== 'closed') return -1;
        if (a.status !== 'closed' && b.status === 'closed') return 1;
        return 0;
      })
    : [];

  const tabBtn = (tab: Tab, label: string) => (
    <button
      key={tab}
      className={activeTab === tab ? 'btn-primary' : 'btn-ghost'}
      onClick={() => setActiveTab(tab)}
      style={{ fontSize: '0.82rem' }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('insights.title')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('insights.subtitle')}
        </p>
      </div>

      {/* Quota indicator */}
      {quota && (
        <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem',
            padding: '0.6rem 1rem', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem',
            background: quota.nearLimit ? 'rgba(239,68,68,0.06)' : 'rgba(201,147,58,0.06)',
            border: quota.nearLimit ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(201,147,58,0.15)',
          }}>
            <span style={{ color: quota.nearLimit ? 'var(--danger)' : 'var(--text-secondary)' }}>
              {quota.nearLimit ? '⚠️ ' : '📊 '}
              Informes IA: {quota.used ?? quota.monthlyUsed ?? 0} de {quota.limit ?? quota.monthlyLimit ?? 0} usados este período ({quota.remaining ?? quota.monthlyRemaining ?? 0} restantes)
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {quota.periodStart && quota.periodEnd
                ? `Período: ${new Date(quota.periodStart).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })} al ${new Date(quota.periodEnd).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })}`
                : 'Cuota mensual'}
            </span>
          </div>
        </div>
      )}

      {/* Guide toggle */}
      <div className="animate-fade-up" style={{ marginBottom: '1rem' }}>
        <button
          className="btn-ghost"
          onClick={() => setShowGuide(!showGuide)}
          style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span style={{ transition: 'transform 0.2s', transform: showGuide ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}>{'\u25B6'}</span>
          {'\u00bfC\u00f3mo funciona?'}
        </button>
      </div>

      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem', padding: '1.5rem' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>
            {'Guía: Informes con Inteligencia Artificial'}
          </h3>
          <div style={{ marginBottom: '1rem' }}>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>{'Funcionalidades disponibles:'}</p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li><strong>{'Resumen IA:'}</strong>{' Sintetiza todas las evaluaciones de un colaborador en un resumen ejecutivo con fortalezas, \u00e1reas de mejora y recomendaciones'}</li>
              <li><strong>{'Detecci\u00f3n de Sesgos:'}</strong>{' Identifica patrones de sesgo en evaluadores (lenidad, severidad, efecto halo) con evidencia estad\u00edstica. Solo para administradores'}</li>
              <li><strong>{'Sugerencias de Desarrollo:'}</strong>{' Genera acciones concretas de mejora vinculadas a competencias, basadas en evaluaci\u00f3n, feedback y Nine Box'}</li>
            </ul>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>{'Importante:'}</strong>{' Los resultados se generan con IA y se almacenan en cach\u00e9 por 7 d\u00edas. Esta funcionalidad est\u00e1 disponible solo para el plan Enterprise.'}
          </div>
        </div>
      )}

      {/* Selectors */}
      <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              {'Ciclo de Evaluaci\u00f3n'}
            </label>
            {loadingCycles ? (
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{'Cargando...'}</span>
            ) : (
              <select
                className="input"
                style={{ width: '100%' }}
                value={selectedCycleId || ''}
                onChange={(e) => { setSelectedCycleId(e.target.value || null); if (e.target.value) setActiveTab('summary'); }}
              >
                <option value="">{'Selecciona un ciclo'}</option>
                {sortedCycles.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Departamento
            </label>
            <select
              className="input"
              style={{ width: '100%' }}
              value={selectedDept}
              onChange={(e) => { setSelectedDept(e.target.value); setSelectedUserId(null); }}
            >
              <option value="">Todos los departamentos</option>
              {departments.map((d: string) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
              Colaborador
            </label>
            <select
              className="input"
              style={{ width: '100%' }}
              value={selectedUserId || ''}
              onChange={(e) => setSelectedUserId(e.target.value || null)}
            >
              <option value="">Selecciona un colaborador ({users.length})</option>
              {users.map((u: any) => (
                <option key={u.id} value={u.id}>
                  {u.firstName} {u.lastName}{u.department ? ` — ${u.department}` : ''}{u.position ? ` (${u.position})` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tabs — separated into IA (requires generation) and Algorithmic (instant) */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        {/* IA Section */}
        {selectedCycleId && (
          <div style={{ marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
              Análisis con IA (requiere generación)
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {tabBtn('summary', '🤖 Resumen IA')}
              {isAdmin && tabBtn('bias', '🔍 Detección de Sesgos')}
              {tabBtn('suggestions', '💡 Sugerencias de Desarrollo')}
            </div>
          </div>
        )}
        {/* Algorithmic Section */}
        <div>
          <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem' }}>
            Análisis algorítmico (datos en tiempo real)
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {isAdmin && tabBtn('flight-risk', '⚠️ Riesgo de Fuga')}
            {tabBtn('prediction', '📈 Predicciones')}
            {isAdmin && tabBtn('retention', '🛡️ Retención')}
          </div>
        </div>
      </div>

      {/* Content */}
      {!selectedCycleId && !['flight-risk', 'prediction', 'retention'].includes(activeTab) && (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {'Selecciona un ciclo de evaluaci\u00f3n para comenzar el an\u00e1lisis con IA'}
          </p>
        </div>
      )}

      {selectedCycleId && activeTab === 'summary' && (
        <div className="animate-fade-up">
          {selectedUserId ? (
            <SummarySection cycleId={selectedCycleId} userId={selectedUserId} />
          ) : (
            <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {'Selecciona un colaborador para generar su resumen con IA'}
              </p>
            </div>
          )}
        </div>
      )}

      {selectedCycleId && activeTab === 'bias' && isAdmin && (
        <div className="animate-fade-up">
          <BiasSection cycleId={selectedCycleId} />
        </div>
      )}

      {selectedCycleId && activeTab === 'suggestions' && (
        <div className="animate-fade-up">
          {selectedUserId ? (
            <SuggestionsSection cycleId={selectedCycleId} userId={selectedUserId} />
          ) : (
            <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {'Selecciona un colaborador para generar sugerencias de desarrollo'}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === 'flight-risk' && isAdmin && (
        <div className="animate-fade-up">
          <FlightRiskSection />
        </div>
      )}

      {/* Prediction Tab */}
      {activeTab === 'prediction' && (
        <PredictionSection userId={selectedUserId} />
      )}

      {/* Retention Tab */}
      {activeTab === 'retention' && isAdmin && (
        <RetentionSection />
      )}
    </div>
  );
}

/* ─── Prediction Section ───────────────────────────────────────────── */
function PredictionSection({ userId }: { userId: string | null }) {
  const { t } = useTranslation();
  const { data, isLoading } = usePerformancePrediction(userId);

  if (!userId) {
    return (
      <div className="card animate-fade-up" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <p>{t('insights.selectUserForPrediction')}</p>
      </div>
    );
  }

  if (isLoading) return <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>;

  if (!data) return null;

  if (!data.available) {
    return (
      <div className="card animate-fade-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.5rem' }}>{t('insights.predictionNotAvailable')}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>{data.message}</p>
        {data.history?.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem' }}>{t('insights.historyAvailable')}:</p>
            {data.history.map((h: any, i: number) => (
              <span key={i} className="badge badge-ghost" style={{ marginRight: '0.5rem', fontSize: '0.75rem' }}>
                {h.cycleName}: {h.avgScore}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  const trendIcon = data.trend === 'improving' ? '\uD83D\uDCC8' : data.trend === 'declining' ? '\uD83D\uDCC9' : '\u27A1\uFE0F';
  const trendColor = data.trend === 'improving' ? 'var(--success)' : data.trend === 'declining' ? 'var(--danger)' : 'var(--accent)';

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Prediction card */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>{t('insights.predictionTitle')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div className="card" style={{ padding: '1rem', textAlign: 'center', border: '2px solid var(--accent)' }}>
            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--accent)' }}>{data.predictedScore}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('insights.predictedScore')}</div>
          </div>
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem' }}>{trendIcon}</div>
            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: trendColor }}>
              {data.trend === 'improving' ? t('insights.trendUp') : data.trend === 'declining' ? t('insights.trendDown') : t('insights.trendStable')}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('insights.slope')}: {data.trendSlope > 0 ? '+' : ''}{data.trendSlope}/ciclo</div>
          </div>
          <div className="card" style={{ padding: '1rem', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>{Math.round(data.confidence * 100)}%</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('insights.confidence')}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{data.cyclesUsed} {t('insights.cyclesUsed')}</div>
          </div>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>{data.explanation}</p>
      </div>

      {/* History */}
      <div className="card" style={{ padding: '1.5rem' }}>
        <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{t('insights.scoreHistory')}</h4>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {data.history?.map((h: any, i: number) => (
            <div key={i} className="card" style={{ padding: '0.5rem 1rem', textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>{h.avgScore}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{h.cycleName}</div>
            </div>
          ))}
          <div className="card" style={{ padding: '0.5rem 1rem', textAlign: 'center', minWidth: 100, border: '2px dashed var(--accent)', opacity: 0.7 }}>
            <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--accent)' }}>{data.predictedScore}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{t('insights.predicted')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Retention Section ────────────────────────────────────────────── */
function RetentionSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useRetentionRecommendations();
  const [searchRT, setSearchRT] = useState('');
  const [deptFilterRT, setDeptFilterRT] = useState('');
  const [riskFilterRT, setRiskFilterRT] = useState('');
  const [pageRT, setPageRT] = useState(1);
  const [expandedRT, setExpandedRT] = useState<string | null>(null);
  const RT_PAGE = 15;

  if (isLoading) return <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>;
  if (!data) return null;

  const allRecs = data.recommendations || [];
  const departments = Array.from(new Set(allRecs.map((r: any) => r.department).filter(Boolean))).sort() as string[];

  let filtered = allRecs;
  if (searchRT) { const q = searchRT.toLowerCase(); filtered = filtered.filter((r: any) => (r.name || '').toLowerCase().includes(q)); }
  if (deptFilterRT) filtered = filtered.filter((r: any) => r.department === deptFilterRT);
  if (riskFilterRT) filtered = filtered.filter((r: any) => r.riskLevel === riskFilterRT);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / RT_PAGE));
  const paged = filtered.slice((pageRT - 1) * RT_PAGE, pageRT * RT_PAGE);

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Summary KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="card" style={{ padding: '1rem', textAlign: 'center', borderLeft: '4px solid var(--danger)', cursor: 'pointer', opacity: !riskFilterRT || riskFilterRT === 'high' ? 1 : 0.5 }}
          onClick={() => { setRiskFilterRT(riskFilterRT === 'high' ? '' : 'high'); setPageRT(1); }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--danger)' }}>{data.totalHighRisk}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('insights.highRiskEmployees')}</div>
        </div>
        <div className="card" style={{ padding: '1rem', textAlign: 'center', borderLeft: '4px solid var(--accent)', cursor: 'pointer', opacity: !riskFilterRT || riskFilterRT === 'medium' ? 1 : 0.5 }}
          onClick={() => { setRiskFilterRT(riskFilterRT === 'medium' ? '' : 'medium'); setPageRT(1); }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>{data.totalMediumRisk}</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{t('insights.mediumRiskEmployees')}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '0.85rem', display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)', width: '200px' }}
          placeholder="Buscar colaborador..." value={searchRT} onChange={(e) => { setSearchRT(e.target.value); setPageRT(1); }} />
        <select style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
          value={deptFilterRT} onChange={(e) => { setDeptFilterRT(e.target.value); setPageRT(1); }}>
          <option value="">Todos los departamentos</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)', color: 'var(--text-primary)' }}
          value={riskFilterRT} onChange={(e) => { setRiskFilterRT(e.target.value); setPageRT(1); }}>
          <option value="">Todos los niveles</option>
          <option value="high">Alto</option>
          <option value="medium">Medio</option>
        </select>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{totalFiltered} colaboradores</span>
      </div>

      {/* Table view instead of cards */}
      <div className="card" style={{ padding: '1.25rem' }}>
        {paged.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>{allRecs.length === 0 ? t('insights.noRiskEmployees') : 'Sin resultados para los filtros seleccionados'}</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Colaborador</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Departamento</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Riesgo</th>
                <th style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((rec: any) => {
                const isOpen = expandedRT === rec.userId;
                return (
                  <React.Fragment key={rec.userId}>
                    <tr style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setExpandedRT(isOpen ? null : rec.userId)}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{rec.name}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-secondary)' }}>{rec.department || '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem' }}>
                        <span className={`badge ${rec.riskLevel === 'high' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.68rem' }}>
                          {rec.riskLevel === 'high' ? 'Alto' : 'Medio'} ({rec.riskScore})
                        </span>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {isOpen ? '▲ ocultar' : `▼ ${(rec.actions || []).length} acciones`}
                      </td>
                    </tr>
                    {isOpen && (rec.actions || []).length > 0 && (
                      <tr style={{ background: 'rgba(201,147,58,0.03)' }}>
                        <td colSpan={4} style={{ padding: '0.75rem 1.25rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {rec.actions.map((action: any, i: number) => (
                              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.82rem', padding: '0.35rem 0.5rem', background: 'rgba(201,147,58,0.04)', borderRadius: 'var(--radius-sm, 6px)' }}>
                                <span className={`badge ${action.priority === 'alta' ? 'badge-danger' : action.priority === 'media' ? 'badge-warning' : 'badge-ghost'}`} style={{ fontSize: '0.65rem', flexShrink: 0 }}>
                                  {action.priority}
                                </span>
                                <span style={{ color: 'var(--text-secondary)' }}>{action.description}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={pageRT <= 1} onClick={() => setPageRT(p => p - 1)}>Anterior</button>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Página {pageRT} de {totalPages}</span>
            <button className="btn-ghost" style={{ fontSize: '0.82rem', padding: '0.3rem 0.75rem' }} disabled={pageRT >= totalPages} onClick={() => setPageRT(p => p + 1)}>Siguiente</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <PlanGate feature="AI_INSIGHTS">
      <InsightsPageContent />
    </PlanGate>
  );
}
