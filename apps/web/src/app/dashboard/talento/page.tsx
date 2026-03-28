'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

type ActiveTab = 'ninebox' | 'segmentation';

const POOL_LABEL: Record<string, string> = {
  star: 'Estrella',
  high_performer: 'Alto rendimiento',
  core_player: 'Profesional clave',
  high_potential: 'Alto potencial',
  enigma: 'Enigma',
  risk: 'Riesgo',
  inconsistent: 'Inconsistente',
  underperformer: 'Bajo rend. con potencial',
  dysfunctional: 'Bajo rendimiento',
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

const READINESS_LABEL: Record<string, string> = {
  ready_now: 'Listo ahora',
  ready_1_year: 'En 1 año',
  ready_2_years: 'En 2 años',
  not_ready: 'No listo',
};

/* Nine-box grid definition: [row][col] — Top row = high performance */
const NINE_BOX_GRID = [
  [
    { box: 6, label: 'Enigma', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.5)', textColor: '#b45309' },
    { box: 8, label: 'Alto rendimiento', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', textColor: '#047857' },
    { box: 9, label: 'Estrella', bg: 'rgba(16,185,129,0.25)', border: 'rgba(16,185,129,0.7)', textColor: '#047857' },
  ],
  [
    { box: 3, label: 'Riesgo', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.5)', textColor: '#b91c1c' },
    { box: 5, label: 'Profesional clave', bg: 'rgba(99,102,241,0.15)', border: 'rgba(99,102,241,0.5)', textColor: '#4338ca' },
    { box: 7, label: 'Alto potencial', bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', textColor: '#047857' },
  ],
  [
    { box: 1, label: 'Bajo rendimiento', bg: 'rgba(239,68,68,0.2)', border: 'rgba(239,68,68,0.6)', textColor: '#b91c1c' },
    { box: 2, label: 'Bajo rend. con potencial', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.4)', textColor: '#b91c1c' },
    { box: 4, label: 'Inconsistente', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', textColor: '#b45309' },
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
  const token = useAuthStore((s) => s.token)!;
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'tenant_admin' || userRole === 'super_admin';
  const [nineBoxData, setNineBoxData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [selectedBox, setSelectedBox] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [sortField, setSortField] = useState<string>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    if (!selectedCycleId) { setNineBoxData(null); return; }
    setLoading(true);
    setSelectedBox(null);
    api.talent.nineBox(token, selectedCycleId)
      .then((d) => setNineBoxData(d))
      .catch(() => setNineBoxData(null))
      .finally(() => setLoading(false));
  }, [selectedCycleId, token]);

  async function handleGenerate() {
    if (!selectedCycleId) return;
    setGenerating(true);
    try {
      await api.talent.generate(token, selectedCycleId);
      const d = await api.talent.nineBox(token, selectedCycleId);
      setNineBoxData(d);
    } catch { /* ignore */ }
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
    setEditingId(a.id);
    setEditForm({
      potentialScore: a.potentialScore ?? '',
      readiness: a.readiness ?? '',
      flightRisk: a.flightRisk ?? '',
      notes: a.notes ?? '',
    });
  }

  async function handleSave(assessmentId: string) {
    setSaving(true);
    try {
      await api.talent.update(token, assessmentId, editForm);
      const d = await api.talent.nineBox(token, selectedCycleId);
      setNineBoxData(d);
      setEditingId(null);
    } catch { /* ignore */ }
    setSaving(false);
  }

  const RISK_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  }

  function SortTh({ field, label }: { field: string; label: string }) {
    const active = sortField === field;
    return (
      <th onClick={() => toggleSort(field)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
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
  const selectedUsers = [...rawUsers].sort((a, b) => {
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
          {cycles.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {selectedCycleId && isAdmin && (
          <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generando...' : 'Generar evaluaci\u00f3n de talento'}
          </button>
        )}
      </div>

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
                      onClick={() => setSelectedBox(isSelected ? null : cell.box)}
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
                      <div style={{ fontSize: '.78rem', color: cell.textColor, fontWeight: 700, marginTop: '.25rem' }}>{cell.label}</div>
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
                    <span style={{ fontWeight: 800, fontSize: '1.4rem', color: cell?.textColor }}>{selectedUsers.length}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.95rem', color: cell?.textColor }}>{cell?.label}</div>
                      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Cuadrante {selectedBox} — {isAdmin ? 'clic en una fila para editar' : 'vista de solo lectura'}</div>
                    </div>
                  </div>
                );
              })()}

              {selectedUsers.length === 0 ? (
                <div className="card" style={{ borderRadius: '0 0 var(--radius) var(--radius)', textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No hay empleados en este cuadrante.
                </div>
              ) : (
                <div className="card" style={{ padding: 0, overflow: 'hidden', borderRadius: '0 0 var(--radius) var(--radius)' }}>
                  <div className="table-wrapper" style={{ margin: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <SortTh field="name" label="Colaborador" />
                          <SortTh field="dept" label="Departamento" />
                          <th>{`Clasificaci\u00f3n`}</th>
                          <SortTh field="performance" label={`Desempe\u00f1o`} />
                          <SortTh field="potential" label="Potencial" />
                          <th style={{ whiteSpace: 'nowrap' }}>{`Preparaci\u00f3n`}</th>
                          <SortTh field="risk" label="Riesgo de Fuga" />
                          {isAdmin && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUsers.map((a: any) => {
                          const u = a.user || a;
                          const accent = POOL_ACCENT[a.talentPool] || 'var(--accent)';
                          const isEditing = editingId === a.id;
                          return (
                            <tr key={a.id} style={{ borderLeft: `3px solid ${accent}`, cursor: isAdmin && !isEditing ? 'pointer' : 'default' }}>
                              {!isEditing ? (
                                <>
                                  <td onClick={() => isAdmin && startEdit(a)}>
                                    <div style={{ fontWeight: 700, fontSize: '.9rem' }}>{u.firstName} {u.lastName}</div>
                                    {u.position && <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.1rem' }}>{u.position}</div>}
                                  </td>
                                  <td onClick={() => isAdmin && startEdit(a)} style={{ color: 'var(--text-secondary)', fontSize: '.875rem' }}>{u.department || '\u2014'}</td>
                                  <td onClick={() => isAdmin && startEdit(a)}>
                                    <span className={`badge ${POOL_BADGE[a.talentPool] || 'badge-accent'}`}>{POOL_LABEL[a.talentPool] || a.talentPool}</span>
                                  </td>
                                  <td onClick={() => isAdmin && startEdit(a)} style={{ minWidth: '110px' }}>
                                    <ScoreBar value={a.performanceScore} color="var(--accent)" />
                                  </td>
                                  <td onClick={() => isAdmin && startEdit(a)} style={{ minWidth: '110px' }}>
                                    <ScoreBar value={a.potentialScore} color="var(--success)" />
                                  </td>
                                  <td onClick={() => isAdmin && startEdit(a)} style={{ fontSize: '.875rem', color: 'var(--text-secondary)' }}>
                                    {READINESS_LABEL[a.readiness] || a.readiness || '\u2014'}
                                  </td>
                                  <td onClick={() => isAdmin && startEdit(a)}>
                                    {a.flightRisk
                                      ? <span className={`badge ${RISK_BADGE[a.flightRisk]}`}>{RISK_LABEL[a.flightRisk]}</span>
                                      : <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>}
                                  </td>
                                  {isAdmin && (
                                    <td>
                                      <button className="btn-ghost" onClick={() => startEdit(a)} style={{ fontSize: '.78rem', padding: '.25rem .6rem' }}>
                                        Editar
                                      </button>
                                    </td>
                                  )}
                                </>
                              ) : (
                                <td colSpan={isAdmin ? 8 : 7} style={{ padding: '1rem' }}>
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr auto', gap: '.75rem', alignItems: 'end' }}>
                                    <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                                      Potencial (0-10)
                                      <input
                                        className="input"
                                        type="number" min={0} max={10} step={0.5}
                                        value={editForm.potentialScore}
                                        onChange={(e) => setEditForm({ ...editForm, potentialScore: +e.target.value })}
                                        style={{ width: '100%', fontSize: '.85rem' }}
                                      />
                                    </label>
                                    <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                                      {`Preparaci\u00f3n`}
                                      <select
                                        className="input"
                                        value={editForm.readiness}
                                        onChange={(e) => setEditForm({ ...editForm, readiness: e.target.value })}
                                        style={{ width: '100%', fontSize: '.85rem' }}
                                      >
                                        <option value="">{'\u2014'}</option>
                                        <option value="ready_now">Listo ahora</option>
                                        <option value="ready_1_year">{`En 1 a\u00f1o`}</option>
                                        <option value="ready_2_years">{`En 2 a\u00f1os`}</option>
                                        <option value="not_ready">No listo</option>
                                      </select>
                                    </label>
                                    <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                                      Riesgo de Fuga
                                      <select
                                        className="input"
                                        value={editForm.flightRisk}
                                        onChange={(e) => setEditForm({ ...editForm, flightRisk: e.target.value })}
                                        style={{ width: '100%', fontSize: '.85rem' }}
                                      >
                                        <option value="">{'\u2014'}</option>
                                        <option value="high">Alto</option>
                                        <option value="medium">Medio</option>
                                        <option value="low">Bajo</option>
                                      </select>
                                    </label>
                                    <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                                      Notas
                                      <textarea
                                        className="input"
                                        value={editForm.notes}
                                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                        rows={2}
                                        style={{ width: '100%', fontSize: '.85rem', resize: 'vertical' }}
                                      />
                                    </label>
                                    <div style={{ display: 'flex', gap: '.5rem' }}>
                                      <button className="btn-primary" onClick={() => handleSave(a.id)} disabled={saving}>
                                        {saving ? 'Guardando...' : 'Guardar'}
                                      </button>
                                      <button className="btn-ghost" onClick={() => setEditingId(null)}>Cancelar</button>
                                    </div>
                                  </div>
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
          Selecciona un ciclo para ver la matriz Nine Box.
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Segmentation Tab                                                          */
/* ========================================================================== */

function SegmentationTab({ cycles, selectedCycleId, onCycleChange }: { cycles: any[]; selectedCycleId: string; onCycleChange: (id: string) => void }) {
  const token = useAuthStore((s) => s.token)!;
  const [segData, setSegData] = useState<any>(null);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<string>('pool');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [filterPool, setFilterPool] = useState<string>('all');
  const [search, setSearch] = useState('');

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

  const filtered = assessments
    .filter((a) => {
      const u = a.user || a;
      const name = `${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
      const dept = (u.department || '').toLowerCase();
      const q = search.toLowerCase();
      const matchSearch = !q || name.includes(q) || dept.includes(q);
      const matchPool = filterPool === 'all' || a.talentPool === filterPool;
      return matchSearch && matchPool;
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

  function SortTh({ field, label, align }: { field: string; label: string; align?: string }) {
    const active = sortField === field;
    return (
      <th
        onClick={() => toggleSort(field)}
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
      {/* Cycle selector */}
      <div style={{ marginBottom: '1.5rem' }}>
        <select
          className="input"
          value={selectedCycleId}
          onChange={(e) => onCycleChange(e.target.value)}
          style={{ minWidth: '220px', fontSize: '.875rem' }}
        >
          <option value="">Seleccionar ciclo...</option>
          {cycles.map((c: any) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {loading && <Spinner />}

      {!loading && selectedCycleId && (
        <>
          {/* Pool summary cards */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.6rem', marginBottom: '1.5rem' }}>
            {POOLS_ORDER.filter((p) => (poolCounts[p] || 0) > 0).map((pool) => (
              <button
                key={pool}
                onClick={() => setFilterPool(filterPool === pool ? 'all' : pool)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '.6rem',
                  padding: '.5rem .9rem',
                  borderRadius: 'var(--radius)',
                  border: `2px solid ${filterPool === pool ? POOL_ACCENT[pool] : 'var(--border)'}`,
                  background: filterPool === pool ? `${POOL_ACCENT[pool]}18` : 'var(--bg-elevated)',
                  cursor: 'pointer', transition: 'var(--transition)',
                }}
              >
                <span style={{
                  width: '26px', height: '26px', borderRadius: '50%',
                  background: POOL_ACCENT[pool] || 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 800, fontSize: '.8rem', flexShrink: 0,
                }}>
                  {poolCounts[pool] || 0}
                </span>
                <span style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {POOL_LABEL[pool]}
                </span>
              </button>
            ))}
          </div>

          {/* Search + filter bar */}
          {assessments.length > 0 && (
            <div style={{ display: 'flex', gap: '.75rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                className="input"
                type="text"
                placeholder="Buscar por nombre o departamento..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ minWidth: '220px', flex: 1, fontSize: '.875rem' }}
              />
              <span style={{ fontSize: '.82rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
              </span>
              {(search || filterPool !== 'all') && (
                <button className="btn-ghost" style={{ fontSize: '.82rem' }} onClick={() => { setSearch(''); setFilterPool('all'); }}>
                  Limpiar filtros
                </button>
              )}
            </div>
          )}

          {/* Assessments table */}
          {assessments.length > 0 && (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrapper" style={{ margin: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <SortTh field="name" label="Colaborador" />
                      <SortTh field="dept" label="Departamento" />
                      <SortTh field="pool" label={`Clasificaci\u00f3n`} />
                      <SortTh field="performance" label={`Desempe\u00f1o`} />
                      <SortTh field="potential" label="Potencial" />
                      <th style={{ whiteSpace: 'nowrap' }}>{`Preparaci\u00f3n`}</th>
                      <SortTh field="risk" label="Riesgo de Fuga" />
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
                              {POOL_LABEL[a.talentPool] || a.talentPool}
                            </span>
                          </td>
                          <td style={{ minWidth: '110px' }}>
                            <ScoreBar value={a.performanceScore} color="var(--accent)" />
                          </td>
                          <td style={{ minWidth: '110px' }}>
                            <ScoreBar value={a.potentialScore} color="var(--success)" />
                          </td>
                          <td style={{ fontSize: '.875rem', color: 'var(--text-secondary)' }}>
                            {READINESS_LABEL[a.readiness] || a.readiness || '\u2014'}
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
                {`Genera una evaluación primero desde la pestaña Nine Box.`}
              </p>
            </div>
          )}
        </>
      )}

      {!loading && !selectedCycleId && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          {`Selecciona un ciclo para ver la segmentación de talento.`}
        </p>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Main Page                                                                 */
/* ========================================================================== */

export default function TalentoPage() {
  const token = useAuthStore((s) => s.token);
  const [tab, setTab] = useState<ActiveTab>('ninebox');
  const [cycles, setCycles] = useState<any[]>([]);
  const [loadingCycles, setLoadingCycles] = useState(true);
  const [selectedCycleId, setSelectedCycleId] = useState('');
  const [showGuide, setShowGuide] = useState(false);

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
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontWeight: 800, fontSize: '1.5rem', color: 'var(--text-primary)' }}>{`Gesti\u00f3n de Talento`}</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '.875rem', marginTop: '.25rem' }}>
          {`Matriz Nine Box, segmentaci\u00f3n por clasificaci\u00f3n y gesti\u00f3n del talento organizacional`}
        </p>
      </div>

      {/* Guide toggle button */}
      <div style={{ marginBottom: '1rem' }}>
        <button
          className="btn-ghost"
          onClick={() => setShowGuide(!showGuide)}
          style={{ fontSize: '.85rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}
        >
          <span style={{ transition: 'transform 0.2s', display: 'inline-block', transform: showGuide ? 'rotate(90deg)' : 'rotate(0deg)' }}>{'\u25B6'}</span>
          {showGuide ? 'Ocultar gu\u00eda de uso' : 'Ver gu\u00eda de uso'}
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
            <p style={{ fontWeight: 700, fontSize: '.9rem', color: 'var(--accent)', marginBottom: '.35rem' }}>
              {'Los 9 cuadrantes:'}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <li><strong>{'Cuadrante 1 (Alto-Alto):'}</strong>{` Estrella / Top Talent \u2192 promover y retener`}</li>
              <li><strong>{'Cuadrante 2 (Alto-Bajo):'}</strong>{` Alto potencial, bajo rendimiento \u2192 desarrollar`}</li>
              <li><strong>{'Cuadrante 3 (Bajo-Alto):'}</strong>{` Buen rendimiento, bajo potencial \u2192 reconocer`}</li>
              <li><strong>{'Cuadrante 4-9:'}</strong>{` Combinaciones intermedias con acciones sugeridas`}</li>
            </ul>
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

      {/* Info card */}
      <div className="card" style={{ background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)', marginBottom: '1.5rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.5rem' }}>
          {`\u00bfC\u00f3mo funciona la Gesti\u00f3n de Talento?`}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          <div>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 700 }}>
              Matriz Nine Box (9 Cuadrantes)
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <li>{`Cruza dos dimensiones: Desempe\u00f1o (resultado de evaluaciones) y Potencial (evaluado manualmente)`}</li>
              <li>{'Clasifica autom\u00e1ticamente a cada colaborador en uno de 9 cuadrantes (Estrella, Alto Potencial, Riesgo, etc.)'}</li>
              <li>{`El administrador puede ajustar el puntaje de potencial, preparaci\u00f3n para ascenso y riesgo de fuga`}</li>
            </ul>
          </div>
          <div>
            <p style={{ margin: '0 0 0.35rem', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 700 }}>
              {`Conexi\u00f3n con otras funcionalidades`}
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
              <li><strong>{`Evaluaciones de Desempe\u00f1o`}</strong>{`: Los puntajes de desempe\u00f1o se generan autom\u00e1ticamente desde las evaluaciones completadas`}</li>
              <li><strong>{`Calibraci\u00f3n`}</strong>{`: Permite ajustar puntajes en sesi\u00f3n colaborativa antes de finalizar la clasificaci\u00f3n`}</li>
              <li><strong>{'Planes de Desarrollo'}</strong>{`: Los resultados del Nine Box sugieren acciones de desarrollo seg\u00fan el cuadrante del colaborador`}</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '2px solid var(--border)' }}>
        {([
          { key: 'ninebox' as const, label: 'Matriz Nine Box' },
          { key: 'segmentation' as const, label: `Segmentaci\u00f3n` },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="btn-ghost"
            style={{
              borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0,
              fontWeight: tab === t.key ? 700 : 500,
              color: tab === t.key ? 'var(--accent)' : 'var(--text-secondary)',
              marginBottom: '-2px',
            }}
          >
            {t.label}
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
