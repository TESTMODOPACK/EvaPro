'use client';
import { PlanGate } from '@/components/PlanGate';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

type ActiveTab = 'ninebox' | 'segmentation';

const POOL_LABEL_KEY: Record<string, string> = {
  star: 'talento.quadrants.star',
  high_performer: 'talento.quadrants.high_performer',
  core_player: 'talento.quadrants.core_player',
  high_potential: 'talento.quadrants.high_potential',
  enigma: 'talento.quadrants.enigma',
  risk: 'talento.quadrants.risk',
  inconsistent: 'talento.quadrants.inconsistent',
  underperformer: 'talento.quadrants.underperformer',
  dysfunctional: 'talento.quadrants.dysfunctional',
};

const POOL_BADGE: Record<string, string> = {
  star: 'badge-success',
  high_performer: 'badge-success',
  core_player: 'badge-accent',
  high_potential: 'badge-warning',
  enigma: 'badge-warning',
  risk: 'badge-danger',
  inconsistent: 'badge-danger',
  underperformer: 'badge-danger',
  dysfunctional: 'badge-danger',
};

const RISK_BADGE: Record<string, string> = {
  high: 'badge-danger',
  medium: 'badge-warning',
  low: 'badge-success',
};

const RISK_LABEL: Record<string, string> = {
  high: 'Alto',
  medium: 'Medio',
  low: 'Bajo',
};

const READINESS_LABEL_KEY: Record<string, string> = {
  ready_now: 'talento.readinessNow',
  ready_1_year: 'talento.readiness1yr',
  ready_2_years: 'talento.readiness2yr',
  not_ready: 'talento.readinessNo',
};

/* Nine-box grid definition: [row][col] — Top row = high performance */
const NINE_BOX_GRID = [
  [
    { box: 6, labelKey: 'talento.quadrants.enigma', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.5)', textColor: '#b45309' },
    { box: 8, labelKey: 'talento.quadrants.high_performer', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', textColor: '#047857' },
    { box: 9, labelKey: 'talento.quadrants.star', bg: 'rgba(16,185,129,0.25)', border: 'rgba(16,185,129,0.7)', textColor: '#047857' },
  ],
  [
    { box: 3, labelKey: 'talento.quadrants.risk', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.5)', textColor: '#b91c1c' },
    { box: 5, labelKey: 'talento.quadrants.core_player', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.5)', textColor: '#4338ca' },
    { box: 7, labelKey: 'talento.quadrants.high_potential', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', textColor: '#047857' },
  ],
  [
    { box: 1, labelKey: 'talento.quadrants.dysfunctional', bg: 'rgba(239,68,68,0.2)', border: 'rgba(239,68,68,0.6)', textColor: '#b91c1c' },
    { box: 2, labelKey: 'talento.quadrants.underperformer', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.4)', textColor: '#b91c1c' },
    { box: 4, labelKey: 'talento.quadrants.inconsistent', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', textColor: '#b45309' },
  ],
];

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const POOL_ACCENT: Record<string, string> = {
  star: 'var(--success)', high_performer: 'var(--success)', core_player: 'var(--accent)',
  high_potential: 'var(--warning)', enigma: 'var(--warning)', risk: 'var(--danger)',
  inconsistent: 'var(--danger)', underperformer: 'var(--danger)', dysfunctional: 'var(--danger)',
};

function ScoreBar({ value, max = 10, color }: { value: number | null; max?: number; color: string }) {
  if (value === null || value === undefined) return <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>;
  const pct = Math.min(Math.round((value / max) * 100), 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
      <div style={{ flex: 1, height: '6px', borderRadius: '999px', background: 'var(--bg-surface)', minWidth: '50px' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '999px', background: color, transition: 'width .4s ease' }} />
      </div>
      <span style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--text-primary)', minWidth: '24px', textAlign: 'right' }}>{Number(value).toFixed(1)}</span>
    </div>
  );
}

/* ========================================================================== */
/*  Nine Box Tab                                                              */
/* ========================================================================== */

function NineBoxTab({ cycles, selectedCycleId, onCycleChange }: { cycles: any[]; selectedCycleId: string; onCycleChange: (id: string) => void }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token)!;
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'tenant_admin' || userRole === 'super_admin';
  const [nineBoxData, setNineBoxData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [editingAssessment, setEditingAssessment] = useState<any | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [sortField, setSortField] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [boxSearch, setBoxSearch] = useState('');
  const [boxDeptFilter, setBoxDeptFilter] = useState('');

  useEffect(() => {
    if (!selectedCycleId) { setNineBoxData(null); return; }
    setLoading(true);
    setSelectedBox(null);
    setGenerateMsg(null);
    api.talent.nineBox(token, selectedCycleId)
      .then((d) => setNineBoxData(d))
      .catch(() => setNineBoxData(null))
      .finally(() => setLoading(false));
  }, [selectedCycleId, token]);

  async function handleGenerate() {
    if (!selectedCycleId) return;
    setGenerating(true);
    setGenerateMsg(null);
    try {
      await api.talent.generate(token, selectedCycleId);
      const d = await api.talent.nineBox(token, selectedCycleId);
      setNineBoxData(d);
      const total = d?.boxes
        ? Object.values(d.boxes as Record<string, any>).reduce((sum: number, b: any) => sum + (b?.users?.length || 0), 0)
        : 0;
      if (total === 0) {
        setGenerateMsg({
          type: 'error',
          text: 'No se generaron evaluaciones. Verifica que el ciclo tenga evaluaciones completadas antes de generar.',
        });
      } else {
        setGenerateMsg({ type: 'success', text: `✓ ${total} ${t('talento.generateSuccess')}` });
        setTimeout(() => setGenerateMsg(null), 7000);
      }
    } catch (e: any) {
      setGenerateMsg({ type: 'error', text: e?.message || 'Error al generar evaluaciones de talento. Intenta nuevamente.' });
    }
    setGenerating(false);
  }

  function getBoxUsers(box: number): any[] {
    if (!nineBoxData || !nineBoxData.boxes) return [];
    const b = nineBoxData.boxes[box];
    return b?.users || [];
  }

  function getBoxCount(box: number): number {
    return getBoxUsers(box).length;
  }

  function startEdit(a: any) {
    setEditingAssessment(a);
    setEditForm({
      potentialScore: a.potentialScore ?? '',
      readiness: a.readiness ?? '',
      flightRisk: a.flightRisk ?? '',
      notes: a.notes ?? '',
    });
  }

  async function handleSave() {
    if (!editingAssessment) return;
    setSaving(true);
    try {
      await api.talent.update(token, editingAssessment.id, editForm);
      const d = await api.talent.nineBox(token, selectedCycleId);
      setNineBoxData(d);
      setEditingAssessment(null);
    } catch { /* ignore */ }
    setSaving(false);
  }

  const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortTh({ field, label, title }: { field: string; label: string; title?: string }) {
    const active = sortField === field;
    return (
      <th onClick={() => toggleSort(field)} title={title} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
          {label}
          <span style={{ fontSize: '.65rem', opacity: active ? 1 : 0.3, color: active ? 'var(--accent)' : 'inherit' }}>
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        </span>
      </th>
    );
  }

  const rawUsers = selectedBox !== null ? getBoxUsers(selectedBox) : [];
  // Apply search + department filter
  const filteredUsers = rawUsers.filter((a: any) => {
    const u = a.user || a;
    const name = `${u.firstName} ${u.lastName}`.toLowerCase();
    const dept = (u.department || '').toLowerCase();
    const matchesSearch = !boxSearch || name.includes(boxSearch.toLowerCase()) || dept.includes(boxSearch.toLowerCase()) || (u.position || '').toLowerCase().includes(boxSearch.toLowerCase());
    const matchesDept = !boxDeptFilter || u.department === boxDeptFilter;
    return matchesSearch && matchesDept;
  });
  // Get unique departments from raw users for the filter dropdown
  const boxDepts = Array.from(new Set(rawUsers.map((a: any) => (a.user || a).department).filter(Boolean))).sort() as string[];
  const selectedUsers = [...filteredUsers].sort((a, b) => {
    const u1 = a.user || a;
    const u2 = b.user || b;
    let cmp = 0;
    switch (sortField) {
      case 'name':
        cmp = `${u1.firstName} ${u1.lastName}`.localeCompare(`${u2.firstName} ${u2.lastName}`, 'es');
        break;
      case 'dept':
        cmp = (u1.department || '').localeCompare(u2.department || '', 'es');
        break;
      case 'performance':
        cmp = (a.performanceScore ?? -1) - (b.performanceScore ?? -1);
        break;
      case 'potential':
        cmp = (a.potentialScore ?? -1) - (b.potentialScore ?? -1);
        break;
      case 'risk':
        cmp = (RISK_ORDER[a.flightRisk] ?? 9) - (RISK_ORDER[b.flightRisk] ?? 9);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div>
      {/* Cycle selector + generate button */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <select
          value={selectedCycleId}
          onChange={(e) => onCycleChange(e.target.value)}
          style={{
            padding: '.5rem .75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
            background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '.875rem', minWidth: '220px',
          }}
        >
          <option value="">Seleccionar ciclo...</option>
          {cycles.filter((c: any) => c.status === 'closed').map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} (Cerrado)</option>
          ))}
        </select>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Solo ciclos cerrados con evaluaciones completadas</span>

        {selectedCycleId && isAdmin && (
          <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? t('talento.generating') : t('talento.generateBtn')}
          </button>
        )}
      </div>

      {/* Generate feedback message */}
      {generateMsg && (
        <div style={{
          padding: '.65rem 1rem',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '1rem',
          fontSize: '.85rem',
          fontWeight: 500,
          background: generateMsg.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${generateMsg.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.25)'}`,
          color: generateMsg.type === 'success' ? 'var(--success)' : 'var(--danger)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
        }}>
          <span>{generateMsg.text}</span>
          <button onClick={() => setGenerateMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 700, fontSize: '1rem', lineHeight: 1 }}>×</button>
        </div>
      )}

      {loading && <Spinner />}

      {!loading && selectedCycleId && (
        <>
          {/* Nine-box grid */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch' }}>
            {/* Y-axis label */}
            <div style={{
              writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '.82rem', color: 'var(--text-secondary)', letterSpacing: '.03em',
            }}>
              {`Desempe\u00f1o (Bajo \u2192 Alto)`}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem',
              }}>
                {NINE_BOX_GRID.flat().map((cell) => {
                  const count = getBoxCount(cell.box);
                  const isSelected = selectedBox === cell.box;
                  return (
                    <div
                      key={cell.box}
                      onClick={() => { setSelectedBox(isSelected ? null : cell.box); setBoxSearch(''); setBoxDeptFilter(''); }}
                      style={{
                        background: cell.bg,
                        borderRadius: 'var(--radius-sm)',
                        padding: '1.25rem 1rem',
                        textAlign: 'center',
                        cursor: 'pointer',
                        border: isSelected ? `3px solid ${cell.border}` : `2px solid ${cell.border}`,
                        transition: 'var(--transition)',
                        minHeight: '110px',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        boxShadow: isSelected ? `0 0 0 2px ${cell.border}` : 'none',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: '1.6rem', color: cell.textColor }}>{count}</div>
                      <div style={{ fontSize: '.78rem', color: cell.textColor, fontWeight: 700, marginTop: '.25rem' }}>{t(cell.labelKey)}</div>
                      <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>Cuadrante {cell.box}</div>
                    </div>
                  );
                })}
              </div>

              {/* X-axis label */}
              <div style={{ textAlign: 'center', marginTop: '.5rem', fontWeight: 700, fontSize: '.82rem', color: 'var(--text-secondary)', letterSpacing: '.03em' }}>
                {`Potencial (Bajo \u2192 Alto)`}
              </div>
            </div>
          </div>

          {/* Hint to click on quadrants */}
          {selectedBox === null && (
            <div style={{
              textAlign: 'center', marginTop: '1rem', padding: '0.65rem 1rem',
              fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 600,
              background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(99,102,241,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
            }}>
              <span style={{ fontSize: '1.1rem' }}>{'👆'}</span>
              Presiona sobre un cuadrante para ver el detalle de los colaboradores clasificados en esa posición
            </div>
          )}

          {/* Selected box detail panel */}
          {selectedBox !== null && (
            <div className="animate-fade-up" style={{ marginTop: '1.5rem' }}>
              {/* Panel header */}
              {(() => {
                const cell = NINE_BOX_GRID.flat().find((c) => c.box === selectedBox);
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '.75rem',
                    padding: '.875rem 1.25rem',
                    background: cell?.bg,
                    border: `2px solid ${cell?.border}`,
                    borderBottom: 'none',
                    borderRadius: 'var(--radius) var(--radius) 0 0',
                  }}>
                    <span style={{ fontWeight: 800, fontSize: '1.4rem', color: cell?.textColor }}>{rawUsers.length}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.95rem', color: cell?.textColor }}>{cell ? t(cell.labelKey) : ''}</div>
                      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Cuadrante {selectedBox} — {isAdmin ? 'clic en una fila para editar' : 'vista de solo lectura'}</div>
                    </div>
                  </div>
                );
              })()}

              {selectedUsers.length === 0 ? (
                <div className="card" style={{ borderRadius: '0 0 var(--radius) var(--radius)', textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  {rawUsers.length > 0 && (boxSearch || boxDeptFilter)
                    ? `No se encontraron colaboradores con los filtros aplicados (${rawUsers.length} en total en este cuadrante).`
                    : 'No hay empleados en este cuadrante.'}
                </div>
              ) : (
                <div className="card" style={{ padding: 0, borderRadius: '0 0 var(--radius) var(--radius)' }}>
                  {isAdmin && (
                    <div style={{
                      padding: '.5rem 1.25rem',
                      background: 'rgba(99,102,241,0.05)',
                      borderBottom: '1px solid var(--border)',
                      fontSize: '.78rem', color: 'var(--text-secondary)',
                      display: 'flex', alignItems: 'center', gap: '.5rem',
                    }}>
                      <span style={{ fontSize: '.9rem' }}>✎</span>
                      <span>{t('talento.editHint')}</span>
                    </div>
                  )}

                  {/* Filters bar */}
                  {rawUsers.length > 3 && (
                    <div style={{
                      display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap',
                      padding: '0.6rem 1.25rem', borderBottom: '1px solid var(--border)',
                      background: 'var(--bg-base)',
                    }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="Buscar colaborador..."
                        value={boxSearch}
                        onChange={(e) => setBoxSearch(e.target.value)}
                        style={{ flex: 1, minWidth: '150px', maxWidth: '280px', fontSize: '0.82rem', padding: '0.35rem 0.65rem' }}
                      />
                      {boxDepts.length > 1 && (
                        <select
                          className="input"
                          value={boxDeptFilter}
                          onChange={(e) => setBoxDeptFilter(e.target.value)}
                          style={{ fontSize: '0.82rem', padding: '0.35rem 0.5rem' }}
                        >
                          <option value="">Todos los deptos.</option>
                          {boxDepts.map((d: string) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      )}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {selectedUsers.length} de {rawUsers.length} colaboradores
                      </span>
                    </div>
                  )}

                  <div className="table-wrapper" style={{ margin: 0, overflowX: 'auto' }}>
                    <table style={{ minWidth: '760px' }}>
                      <thead>
                        <tr>
                          <SortTh field="name" label="Colaborador" />
                          <SortTh field="dept" label="Departamento" />
                          <th>{`Clasificaci\u00f3n`}</th>
                          <SortTh field="performance" label={t('talento.colPerformance')} title={t('talento.colPerformanceHint')} />
                          <SortTh field="potential" label={t('talento.colPotential')} title={t('talento.colPotentialHint')} />
                          <th style={{ whiteSpace: 'nowrap', cursor: 'default' }} title={t('talento.colReadinessHint')}>{t('talento.colReadiness')}</th>
                          <SortTh field="risk" label={t('talento.colFlightRisk')} title={t('talento.colFlightRiskHint')} />
                          {isAdmin && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUsers.map((a: any) => {
                          const u = a.user || a;
                          const accent = POOL_ACCENT[a.talentPool] || 'var(--accent)';
                          return (
                            <tr
                              key={a.id}
                              onClick={() => isAdmin && startEdit(a)}
                              style={{ borderLeft: `3px solid ${accent}`, cursor: isAdmin ? 'pointer' : 'default' }}
                            >
                              <td>
                                <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{u.firstName} {u.lastName}</div>
                                {u.position && <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.1rem' }}>{u.position}</div>}
                              </td>
                              <td style={{ color: 'var(--text-secondary)', fontSize: '.875rem' }}>{u.department || '\u2014'}</td>
                              <td>
                                <span className={`badge ${POOL_BADGE[a.talentPool] || 'badge-accent'}`}>{POOL_LABEL_KEY[a.talentPool] ? t(POOL_LABEL_KEY[a.talentPool]) : a.talentPool}</span>
                              </td>
                              <td style={{ minWidth: '110px' }}>
                                <ScoreBar value={a.performanceScore} color="var(--accent)" />
                              </td>
                              <td style={{ minWidth: '110px' }}>
                                <ScoreBar value={a.potentialScore} color="var(--success)" />
                              </td>
                              <td style={{ fontSize: '.875rem', color: 'var(--text-secondary)' }}>
                                {READINESS_LABEL_KEY[a.readiness] ? t(READINESS_LABEL_KEY[a.readiness]) : a.readiness || '\u2014'}
                              </td>
                              <td>
                                {a.flightRisk
                                  ? <span className={`badge ${RISK_BADGE[a.flightRisk]}`}>{RISK_LABEL[a.flightRisk]}</span>
                                  : <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>}
                              </td>
                              {isAdmin && (
                                <td onClick={(e) => { e.stopPropagation(); startEdit(a); }}>
                                  <button className="btn-ghost" style={{ fontSize: '.78rem', padding: '.25rem .6rem' }}>
                                    {t('talento.editBtn')}
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!loading && !selectedCycleId && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          {t('talento.selectCycle')}
        </p>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────── */}
      {editingAssessment && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setEditingAssessment(null); }}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div className="card animate-fade-up" style={{ width: '100%', maxWidth: '460px', padding: '1.5rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem' }}>Editar datos de talento</div>
                <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>
                  {(editingAssessment.user || editingAssessment).firstName}{' '}
                  {(editingAssessment.user || editingAssessment).lastName}
                </div>
              </div>
              <button
                onClick={() => setEditingAssessment(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.3rem', color: 'var(--text-muted)', lineHeight: 1, padding: '.1rem .3rem' }}
              >
                ×
              </button>
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <label style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                {t('talento.editPotential')}
                <input
                  className="input"
                  type="number" min={0} max={10} step={0.5}
                  value={editForm.potentialScore}
                  onChange={(e) => setEditForm({ ...editForm, potentialScore: +e.target.value })}
                />
              </label>

              <label style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                {t('talento.editClassification')}
                <select
                  className="input"
                  value={editForm.readiness}
                  onChange={(e) => setEditForm({ ...editForm, readiness: e.target.value })}
                >
                  <option value="">{'\u2014'}</option>
                  <option value="ready_now">{t('talento.readinessNow')}</option>
                  <option value="ready_1_year">{t('talento.readiness1yr')}</option>
                  <option value="ready_2_years">{t('talento.readiness2yr')}</option>
                  <option value="not_ready">{t('talento.readinessNo')}</option>
                </select>
              </label>

              <label style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                Riesgo de Fuga
                <select
                  className="input"
                  value={editForm.flightRisk}
                  onChange={(e) => setEditForm({ ...editForm, flightRisk: e.target.value })}
                >
                  <option value="">{'\u2014'}</option>
                  <option value="high">Alto</option>
                  <option value="medium">Medio</option>
                  <option value="low">Bajo</option>
                </select>
              </label>

              <label style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                Notas internas
                <textarea
                  className="input"
                  rows={3}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  style={{ resize: 'vertical' }}
                  placeholder={`Observaciones del colaborador\u2026`}
                />
              </label>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
              <button className="btn-ghost" onClick={() => setEditingAssessment(null)}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Guardando...' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Segmentation Tab                                                          */
/* ========================================================================== */

function SegmentationTab({ cycles, selectedCycleId, onCycleChange }: { cycles: any[]; selectedCycleId: string; onCycleChange: (id: string) => void }) {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token)!;
  const [segData, setSegData] = useState<any>(null);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<string>('pool');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterPool, setFilterPool] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [segDeptFilter, setSegDeptFilter] = useState('');

  useEffect(() => {
    if (!selectedCycleId) { setSegData(null); setAssessments([]); return; }
    setLoading(true);
    Promise.all([
      api.talent.segmentation(token, selectedCycleId),
      api.talent.findByCycle(token, selectedCycleId),
    ])
      .then(([seg, list]) => { setSegData(seg); setAssessments(list || []); })
      .catch(() => { setSegData(null); setAssessments([]); })
      .finally(() => setLoading(false));
  }, [selectedCycleId, token]);

  const POOLS_ORDER = ['star', 'high_performer', 'core_player', 'high_potential', 'enigma', 'risk', 'inconsistent', 'underperformer', 'dysfunctional'];
  const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

  const poolCounts: Record<string, number> = {};
  if (segData && segData.byPool) {
    Object.assign(poolCounts, segData.byPool);
  } else if (assessments.length) {
    for (const a of assessments) {
      poolCounts[a.talentPool] = (poolCounts[a.talentPool] || 0) + 1;
    }
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  // Compute unique departments for the filter dropdown
  const segDepts = Array.from(new Set(assessments.map((a: any) => (a.user || a).department).filter(Boolean))).sort() as string[];

  const filtered = assessments
    .filter((a) => {
      const u = a.user || a;
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const dept = (u.department || '').toLowerCase();
      const pos = (u.position || '').toLowerCase();
      const q = search.toLowerCase();
      const matchSearch = !q || name.includes(q) || dept.includes(q) || pos.includes(q);
      const matchPool = filterPool === 'all' || a.talentPool === filterPool;
      const matchDept = !segDeptFilter || u.department === segDeptFilter;
      return matchSearch && matchPool && matchDept;
    })
    .sort((a, b) => {
      const u1 = a.user || a;
      const u2 = b.user || b;
      let cmp = 0;
      switch (sortField) {
        case 'pool':
          cmp = POOLS_ORDER.indexOf(a.talentPool) - POOLS_ORDER.indexOf(b.talentPool);
          if (cmp === 0) cmp = (b.performanceScore ?? 0) - (a.performanceScore ?? 0);
          break;
        case 'name':
          cmp = `${u1.firstName} ${u1.lastName}`.localeCompare(`${u2.firstName} ${u2.lastName}`, 'es');
          break;
        case 'dept':
          cmp = (u1.department || '').localeCompare(u2.department || '', 'es');
          break;
        case 'performance':
          cmp = (a.performanceScore ?? -1) - (b.performanceScore ?? -1);
          break;
        case 'potential':
          cmp = (a.potentialScore ?? -1) - (b.potentialScore ?? -1);
          break;
        case 'risk':
          cmp = (RISK_ORDER[a.flightRisk] ?? 9) - (RISK_ORDER[b.flightRisk] ?? 9);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  function SortTh({ field, label, align, title }: { field: string; label: string; align?: string; title?: string }) {
    const active = sortField === field;
    return (
      <th
        onClick={() => toggleSort(field)}
        title={title}
        style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: (align as any) || 'left' }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}>
          {label}
          <span style={{ fontSize: '.65rem', opacity: active ? 1 : 0.3, color: active ? 'var(--accent)' : 'inherit' }}>
            {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
          </span>
        </span>
      </th>
    );
  }

  return (
    <div>
      {/* Tab description */}
      <div style={{ marginBottom: '1rem', padding: '.6rem .9rem', background: 'rgba(99,102,241,0.05)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--accent)', fontSize: '.82rem', color: 'var(--text-secondary)' }}>
        {'Vista completa de todos los colaboradores clasificados. Busca por nombre o filtra por pool de talento. Para editar Potencial, Preparación y Riesgo de Fuga, usa la pestaña '}
        <strong>{'Matriz Nine Box'}</strong>{'.'}
      </div>

      {/* Cycle selector */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <select
          className="input"
          value={selectedCycleId}
          onChange={(e) => onCycleChange(e.target.value)}
          style={{ minWidth: '220px', fontSize: '.875rem' }}
        >
          <option value="">Seleccionar ciclo...</option>
          {cycles.filter((c: any) => c.status === 'closed').map((c: any) => (
            <option key={c.id} value={c.id}>{c.name} (Cerrado)</option>
          ))}
        </select>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Solo ciclos cerrados</span>
      </div>

      {loading && <Spinner />}

      {!loading && selectedCycleId && (
        <>
          {/* Classification (Pool) filter */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Clasificación del colaborador
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
              {POOLS_ORDER.filter((p) => (poolCounts[p] || 0) > 0).map((pool) => (
                <button
                  key={pool}
                  onClick={() => setFilterPool(filterPool === pool ? 'all' : pool)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '.5rem',
                    padding: '.4rem .75rem',
                    borderRadius: 'var(--radius)',
                    border: `2px solid ${filterPool === pool ? POOL_ACCENT[pool] : 'var(--border)'}`,
                    background: filterPool === pool ? `${POOL_ACCENT[pool]}18` : 'var(--bg-elevated)',
                    cursor: 'pointer', transition: 'var(--transition)',
                  }}
                >
                  <span style={{
                    width: '22px', height: '22px', borderRadius: '50%',
                    background: POOL_ACCENT[pool] || 'var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 800, fontSize: '.72rem', flexShrink: 0,
                  }}>
                    {poolCounts[pool] || 0}
                  </span>
                  <span style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {POOL_LABEL_KEY[pool] ? t(POOL_LABEL_KEY[pool]) : pool}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Search + Department filter — same row */}
          {assessments.length > 0 && (
            <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Nombre
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder="Buscar por nombre, cargo..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: '100%', fontSize: '.875rem' }}
                />
              </div>
              {segDepts.length > 1 && (
                <div style={{ minWidth: '160px' }}>
                  <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Departamento
                  </label>
                  <select
                    className="input"
                    value={segDeptFilter}
                    onChange={(e) => setSegDeptFilter(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  >
                    <option value="">Todos</option>
                    {segDepts.map((d: string) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              <span style={{ fontSize: '.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingBottom: '0.35rem' }}>
                {filtered.length} de {assessments.length}
              </span>
              {(search || filterPool !== 'all' || segDeptFilter) && (
                <button className="btn-ghost" style={{ fontSize: '.82rem', paddingBottom: '0.35rem' }} onClick={() => { setSearch(''); setFilterPool('all'); setSegDeptFilter(''); }}>
                  Limpiar filtros
                </button>
              )}
            </div>
          )}

          {/* Assessments table */}
          {assessments.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div className="table-wrapper" style={{ margin: 0, overflowX: 'auto' }}>
                <table style={{ minWidth: '720px' }}>
                  <thead>
                    <tr>
                      <SortTh field="name" label="Colaborador" />
                      <SortTh field="dept" label="Departamento" />
                      <SortTh field="pool" label={t('talento.segClassification')} />
                      <SortTh field="performance" label={t('talento.colPerformance')} title={t('talento.colPerformanceHint')} />
                      <SortTh field="potential" label={t('talento.segPotential')} title={t('talento.segPotentialHint')} />
                      <th style={{ whiteSpace: 'nowrap', cursor: 'default' }} title={t('talento.segReadinessHint')}>{t('talento.segReadiness')}</th>
                      <SortTh field="risk" label={t('talento.segFlightRisk')} title={t('talento.segFlightRiskHint')} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a: any) => {
                      const u = a.user || a;
                      const accent = POOL_ACCENT[a.talentPool] || 'var(--accent)';
                      return (
                        <tr key={a.id} style={{ borderLeft: `3px solid ${accent}` }}>
                          <td>
                            <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{u.firstName} {u.lastName}</div>
                            {u.position && <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.1rem' }}>{u.position}</div>}
                          </td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: '.875rem' }}>{u.department || '\u2014'}</td>
                          <td>
                            <span className={`badge ${POOL_BADGE[a.talentPool] || 'badge-accent'}`}>
                              {POOL_LABEL_KEY[a.talentPool] ? t(POOL_LABEL_KEY[a.talentPool]) : a.talentPool}
                            </span>
                          </td>
                          <td style={{ minWidth: '110px' }}>
                            <ScoreBar value={a.performanceScore} color="var(--accent)" />
                          </td>
                          <td style={{ minWidth: '110px' }}>
                            <ScoreBar value={a.potentialScore} color="var(--success)" />
                          </td>
                          <td style={{ fontSize: '.875rem', color: 'var(--text-secondary)' }}>
                            {READINESS_LABEL_KEY[a.readiness] ? t(READINESS_LABEL_KEY[a.readiness]) : a.readiness || '\u2014'}
                          </td>
                          <td>
                            {a.flightRisk
                              ? <span className={`badge ${RISK_BADGE[a.flightRisk]}`}>{RISK_LABEL[a.flightRisk]}</span>
                              : <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                          Sin resultados para los filtros aplicados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {assessments.length === 0 && !loading && (
            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <p style={{ fontWeight: 500, marginBottom: '.25rem' }}>
                {`No hay evaluaciones de talento para este ciclo.`}
              </p>
              <p style={{ fontSize: '.85rem' }}>
                {t('talento.generateFirst')}
              </p>
            </div>
          )}
        </>
      )}

      {!loading && !selectedCycleId && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          {t('talento.selectCycle')}
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Main Page                                                                 */
/* ========================================================================== */

function TalentoPageContent() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const [tab, setTab] = useState<ActiveTab>('ninebox');
  const [cycles, setCycles] = useState<any[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

  const handleExport = async (format: 'csv' | 'xlsx' | 'pdf') => {
    if (!token || !selectedCycleId) return;
    setExporting(format);
    try {
      const res = await fetch(`${BASE_URL}/talent/cycle/${selectedCycleId}/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Error');
      const blob = await res.blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `talento.${format}`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {} finally { setExporting(null); }
  };

  useEffect(() => {
    if (!token) return;
    api.cycles.list(token)
      .then((data) => setCycles(data || []))
      .catch(() => setCycles([]))
      .finally(() => setLoadingCycles(false));
  }, [token]);

  if (!token) return null;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
    <div className="animate-fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>{t('talento.title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '.875rem', marginTop: '.25rem' }}>
            {t('talento.subtitle')}
          </p>
        </div>
        {selectedCycleId && (
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            {(['pdf', 'xlsx', 'csv'] as const).map((fmt) => (
              <button key={fmt} type="button" disabled={!!exporting}
                onClick={() => handleExport(fmt)}
                style={{
                  padding: '0.35rem 0.65rem', fontSize: '0.72rem', fontWeight: 600,
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 6px)',
                  background: exporting === fmt ? 'var(--bg-hover)' : 'var(--bg-surface)',
                  color: 'var(--text-secondary)', cursor: exporting ? 'wait' : 'pointer',
                  opacity: exporting && exporting !== fmt ? 0.5 : 1,
                }}>
                {exporting === fmt ? '...' : fmt.toUpperCase()}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Guide toggle button */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          className="btn-ghost"
          onClick={() => setShowGuide(!showGuide)}
          style={{ fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}
        >
          <span style={{ transition: 'transform 0.2s', display: 'inline-block', transform: showGuide ? 'rotate(90deg)' : 'rotate(0deg)' }}>{'\u25B6'}</span>
          {showGuide ? t('common.hideGuide') : t('common.showGuide')}
        </button>
      </div>

      {/* Collapsible guide card */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
            {`Gu\u00eda de uso: Gesti\u00f3n de Talento (Nine Box)`}
          </h3>

          {/* Section 1 */}
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--accent)', marginBottom: '.35rem' }}>
              {`\u00bfQu\u00e9 es el Nine Box?`}
            </p>
            <p style={{ fontSize: '.84rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.7 }}>
              {`Es una herramienta visual que clasifica a los colaboradores en una matriz de 3x3 combinando dos ejes: Desempe\u00f1o (basado en evaluaciones) y Potencial (evaluaci\u00f3n del encargado). Permite identificar talento clave, colaboradores de alto potencial y \u00e1reas que requieren intervenci\u00f3n.`}
            </p>
          </div>

          {/* Section 2 */}
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--accent)', marginBottom: '.35rem' }}>
              {`\u00bfC\u00f3mo se calculan los ejes?`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{`Desempe\u00f1o:`}</strong>{` Puntaje promedio de las evaluaciones completadas (escala 0-10)`}</li>
              <li><strong>{'Potencial:'}</strong>{` Evaluaci\u00f3n manual del encargado/administrador`}</li>
              <li><strong>{`Clasificaci\u00f3n autom\u00e1tica seg\u00fan umbrales:`}</strong>{` Bajo (<4), Medio (4-7), Alto (>7)`}</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--accent)', marginBottom: '.75rem' }}>
              {'Los 9 cuadrantes (Desempeño ↑ — Potencial →):'}
            </p>
            {/* Visual mini-grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.35rem', marginBottom: '.75rem', fontSize: '.75rem' }}>
              {[
                { box: 6, label: 'Enigma', bg: 'rgba(245,158,11,0.15)', color: '#b45309', desc: 'Alto desempeño, bajo potencial' },
                { box: 8, label: 'Alto rendimiento', bg: 'rgba(16,185,129,0.15)', color: '#047857', desc: 'Alto desempeño, potencial medio' },
                { box: 9, label: '⭐ Estrella', bg: 'rgba(16,185,129,0.25)', color: '#047857', desc: 'Alto desempeño, alto potencial' },
                { box: 3, label: 'Riesgo', bg: 'rgba(239,68,68,0.15)', color: '#b91c1c', desc: 'Desempeño medio, bajo potencial' },
                { box: 5, label: 'Profesional clave', bg: 'rgba(99,102,241,0.15)', color: '#4338ca', desc: 'Desempeño medio, potencial medio' },
                { box: 7, label: 'Alto potencial', bg: 'rgba(16,185,129,0.15)', color: '#047857', desc: 'Desempeño medio, alto potencial' },
                { box: 1, label: 'Bajo rendimiento', bg: 'rgba(239,68,68,0.2)', color: '#b91c1c', desc: 'Bajo desempeño, bajo potencial' },
                { box: 2, label: 'Bajo rend. c/potencial', bg: 'rgba(239,68,68,0.1)', color: '#b91c1c', desc: 'Bajo desempeño, potencial medio' },
                { box: 4, label: 'Inconsistente', bg: 'rgba(245,158,11,0.12)', color: '#b45309', desc: 'Bajo desempeño, alto potencial' },
              ].map((cell) => (
                <div key={cell.box} style={{ background: cell.bg, borderRadius: '6px', padding: '.4rem .5rem', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, color: cell.color, fontSize: '.72rem' }}>{cell.label}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '.65rem', marginTop: '.1rem', lineHeight: 1.3 }}>{cell.desc}</div>
                  <div style={{ fontSize: '.6rem', color: 'var(--text-muted)', marginTop: '.15rem', opacity: 0.6 }}>Cuad. {cell.box}</div>
                </div>
              ))}
            </div>
            <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', margin: 0, fontStyle: 'italic' }}>
              {t('talento.matrixAxisNote')}
            </p>
          </div>

          {/* Section 4 */}
          <div style={{ marginBottom: '1.25rem' }}>
            <p style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--accent)', marginBottom: '.35rem' }}>
              {`Conexi\u00f3n con otras funciones:`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{'Evaluaciones:'}</strong>{` El puntaje de desempe\u00f1o viene de las evaluaciones completadas`}</li>
              <li><strong>{'Planes de Desarrollo (PDI):'}</strong>{` Los colaboradores en cuadrantes de mejora se vinculan con acciones de desarrollo`}</li>
              <li><strong>{`Calibraci\u00f3n:`}</strong>{` Los puntajes pueden ser calibrados antes de alimentar el Nine Box`}</li>
              <li><strong>{'Competencias:'}</strong>{` Las brechas identificadas se conectan con el cat\u00e1logo de competencias`}</li>
            </ul>
          </div>

          {/* Section 5 */}
          <div>
            <p style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--accent)', marginBottom: '.35rem' }}>
              {'Permisos:'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{'Administrador:'}</strong>{` Ve toda la organizaci\u00f3n, crea evaluaciones de potencial`}</li>
              <li><strong>{'Encargado de Equipo:'}</strong>{` Ve su equipo, eval\u00faa potencial de sus reportes directos`}</li>
              <li><strong>{'Colaborador:'}</strong>{` No tiene acceso a esta funci\u00f3n`}</li>
            </ul>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)' }}>
        {([
          { key: 'ninebox' as const, label: t('talento.tabNineBox') },
          { key: 'segmentation' as const, label: t('talento.tabSegmentation') },
        ]).map((tab_item) => (
          <button
            key={tab_item.key}
            onClick={() => setTab(tab_item.key)}
            className="btn-ghost"
            style={{
              borderBottom: tab === tab_item.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              fontWeight: tab === tab_item.key ? 700 : 500,
              color: tab === tab_item.key ? 'var(--accent)' : 'var(--text-secondary)',
              marginBottom: '-2px',
            }}
          >
            {tab_item.label}
          </button>
        ))}
      </div>

      {loadingCycles ? (
        <Spinner />
      ) : (
        <>
          {tab === 'ninebox' && (
            <NineBoxTab cycles={cycles} selectedCycleId={selectedCycleId} onCycleChange={setSelectedCycleId} />
          )}
          {tab === 'segmentation' && (
            <SegmentationTab cycles={cycles} selectedCycleId={selectedCycleId} onCycleChange={setSelectedCycleId} />
          )}
        </>
      )}
    </div>
    </div>
  );
}

export default function TalentoPage() {
  return (
    <PlanGate feature="NINE_BOX">
      <TalentoPageContent />
    </PlanGate>
  );
}
