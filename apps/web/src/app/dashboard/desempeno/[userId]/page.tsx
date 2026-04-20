'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { usePerformanceHistory } from '@/hooks/usePerformanceHistory';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
// P8-C: import dinámico de Recharts.
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from '@/components/DynamicCharts';
import CompetencyRadarChart from '@/components/CompetencyRadarChart';
import SelfVsOthersChart from '@/components/SelfVsOthersChart';
import GapAnalysisChart from '@/components/GapAnalysisChart';
import { useCycles } from '@/hooks/useCycles';
import { useGapAnalysisIndividual } from '@/hooks/useReports';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function fmtScore(v: number | null): string {
  if (v === null || v === undefined) return '\u2014';
  return Number(v).toFixed(1);
}

export default function DesempenoPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.userId as string;
  const token = useAuthStore((s) => s.token);

  const { data, isLoading } = usePerformanceHistory(userId);
  const { data: cycles } = useCycles();
  const [userName, setUserName] = useState<string>('');
  const [selectedCycleId, setSelectedCycleId] = useState<string>('');

  const closedCycles = (cycles || []).filter((c: any) => c.status === 'closed' || c.status === 'active');

  useEffect(() => {
    if (token && userId) {
      api.users.getById(token, userId).then((u) => {
        setUserName(`${u.firstName} ${u.lastName}`);
      }).catch(() => {
        setUserName('Usuario');
      });
    }
  }, [token, userId]);

  const history = data?.history || [];

  const chartData = history.map((h: any) => ({
    name: h.cycleName,
    self: h.avgSelf !== null ? Number(h.avgSelf) : null,
    manager: h.avgManager !== null ? Number(h.avgManager) : null,
    peer: h.avgPeer !== null ? Number(h.avgPeer) : null,
    overall: h.avgOverall !== null ? Number(h.avgOverall) : null,
  }));

  const customTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload) return null;
    return (
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        fontSize: '0.78rem',
      }}>
        <p style={{ fontWeight: 700, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.dataKey} style={{ color: entry.color, marginBottom: '0.15rem' }}>
            {entry.name}: {entry.value !== null ? Number(entry.value).toFixed(1) : '\u2014'}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <button
          className="btn-ghost"
          style={{ fontSize: '0.8rem', marginBottom: '0.75rem', padding: '0.3rem 0.6rem' }}
          onClick={() => router.back()}
        >
          ← Volver
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {userName || 'Cargando...'} — Historial de Desempeño
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Evolución de puntajes a lo largo de los ciclos
        </p>
      </div>

      {isLoading ? (
        <Spinner />
      ) : history.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            No hay historial de desempeño
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Este usuario aún no tiene evaluaciones completadas
          </p>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>Tendencia de Puntajes</h2>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={{ stroke: 'var(--border)' }}
                />
                <YAxis
                  domain={[0, 10]}
                  tick={{ fill: 'var(--text-muted)', fontSize: 12 }}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickLine={{ stroke: 'var(--border)' }}
                />
                <Tooltip content={customTooltip} />
                <Legend
                  wrapperStyle={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}
                />
                <Line
                  type="monotone"
                  dataKey="self"
                  name="Autoevaluación"
                  stroke="#6366f1"
                  strokeWidth={2}
                  dot={{ fill: '#6366f1', r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="manager"
                  name="Jefatura"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ fill: '#10b981', r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="peer"
                  name="Pares"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={{ fill: '#f59e0b', r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="overall"
                  name="General"
                  stroke="#a78bfa"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ fill: '#a78bfa', r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Competency Analysis - cycle selector + charts */}
          {closedCycles.length > 0 && (
            <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <h2 style={{ fontWeight: 700, fontSize: '0.95rem', margin: 0 }}>Análisis por Ciclo</h2>
                <select
                  className="input"
                  value={selectedCycleId}
                  onChange={(e) => setSelectedCycleId(e.target.value)}
                  style={{ fontSize: '0.82rem', padding: '0.4rem 0.6rem', width: 'auto', minWidth: '220px' }}
                >
                  <option value="">Seleccionar ciclo...</option>
                  {closedCycles.map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.status === 'closed' ? 'Cerrado' : c.status === 'active' ? 'Activo' : c.status})</option>
                  ))}
                </select>
              </div>
              {selectedCycleId && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                    <CompetencyRadarChart cycleId={selectedCycleId} userId={userId} />
                    <SelfVsOthersChart cycleId={selectedCycleId} userId={userId} />
                  </div>
                  <GapAnalysisSection cycleId={selectedCycleId} userId={userId} />
                </>
              )}
            </div>
          )}

          {/* Breakdown table */}
          <div className="card animate-fade-up" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>Detalle por Ciclo</h2>
            <div className="table-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Ciclo', 'Auto', 'Jefatura', 'Pares', 'General', 'Objetivos'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: 'left',
                          padding: '0.6rem 0.75rem',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.05em',
                          borderBottom: '1px solid var(--border)',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.map((h: any, i: number) => (
                    <tr key={i}>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>
                        {h.cycleName}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#6366f1', borderBottom: '1px solid var(--border)' }}>
                        {fmtScore(h.avgSelf)}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#10b981', borderBottom: '1px solid var(--border)' }}>
                        {fmtScore(h.avgManager)}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#f59e0b', borderBottom: '1px solid var(--border)' }}>
                        {fmtScore(h.avgPeer)}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: '#a78bfa', borderBottom: '1px solid var(--border)' }}>
                        {fmtScore(h.avgOverall)}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                        {h.completedObjectives ?? '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Gap Analysis Section ─────────────────────────────────────────────

function GapAnalysisSection({ cycleId, userId }: { cycleId: string; userId: string }) {
  const { data, isLoading } = useGapAnalysisIndividual(cycleId, userId);
  return (
    <div className="animate-fade-up" style={{ marginTop: '0.5rem' }}>
      <GapAnalysisChart data={data} isLoading={isLoading} />
    </div>
  );
}
