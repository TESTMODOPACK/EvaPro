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
  underperformer: 'Bajo rendimiento',
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
  ready_1_year: 'En 1 a\u00f1o',
  ready_2_years: 'En 2 a\u00f1os',
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

  const selectedUsers = selectedBox !== null ? getBoxUsers(selectedBox) : [];

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
            <div className="card animate-fade-up" style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                Cuadrante {selectedBox} — {NINE_BOX_GRID.flat().find((c) => c.box === selectedBox)?.label} ({selectedUsers.length} personas)
              </h3>

              {selectedUsers.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No hay empleados en este cuadrante.</p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Nombre</th><th>Departamento</th><th>Cargo</th>
                        <th>{`Desempe\u00f1o`}</th><th>Potencial</th><th>Clasificaci\u00f3n</th>
                        <th>Preparaci\u00f3n</th><th>Riesgo de Fuga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedUsers.map((a: any) => {
                        const u = a.user || a;
                        const isEditing = editingId === a.id;
                        return (
                          <tr key={a.id} style={{ cursor: 'pointer' }}>
                            {!isEditing ? (
                              <>
                                <td onClick={() => isAdmin && startEdit(a)} style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</td>
                                <td onClick={() => isAdmin && startEdit(a)}>{u.department || '\u2014'}</td>
                                <td onClick={() => isAdmin && startEdit(a)}>{u.position || '\u2014'}</td>
                                <td onClick={() => isAdmin && startEdit(a)}>{a.performanceScore ?? '\u2014'}</td>
                                <td onClick={() => isAdmin && startEdit(a)}>{a.potentialScore ?? '\u2014'}</td>
                                <td onClick={() => isAdmin && startEdit(a)}><span className={`badge ${POOL_BADGE[a.talentPool] || 'badge-accent'}`}>{POOL_LABEL[a.talentPool] || a.talentPool}</span></td>
                                <td onClick={() => isAdmin && startEdit(a)}>{READINESS_LABEL[a.readiness] || a.readiness || '\u2014'}</td>
                                <td onClick={() => isAdmin && startEdit(a)}>{a.flightRisk ? <span className={`badge ${RISK_BADGE[a.flightRisk]}`}>{RISK_LABEL[a.flightRisk]}</span> : '\u2014'}</td>
                              </>
                            ) : (
                              <td colSpan={8}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr auto', gap: '.75rem', alignItems: 'end', padding: '.5rem 0' }}>
                                  <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
                                    Potencial (0-100)
                                    <input
                                      type="number" min={0} max={100}
                                      value={editForm.potentialScore}
                                      onChange={(e) => setEditForm({ ...editForm, potentialScore: +e.target.value })}
                                      style={{ width: '100%', padding: '.4rem .5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', marginTop: '.25rem' }}
                                    />
                                  </label>
                                  <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
                                    {`Preparaci\u00f3n`}
                                    <select
                                      value={editForm.readiness}
                                      onChange={(e) => setEditForm({ ...editForm, readiness: e.target.value })}
                                      style={{ width: '100%', padding: '.4rem .5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', marginTop: '.25rem' }}
                                    >
                                      <option value="">{'\u2014'}</option>
                                      <option value="ready_now">Listo ahora</option>
                                      <option value="ready_1_year">{`En 1 a\u00f1o`}</option>
                                      <option value="ready_2_years">{`En 2 a\u00f1os`}</option>
                                      <option value="not_ready">No listo</option>
                                    </select>
                                  </label>
                                  <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
                                    Riesgo de Fuga
                                    <select
                                      value={editForm.flightRisk}
                                      onChange={(e) => setEditForm({ ...editForm, flightRisk: e.target.value })}
                                      style={{ width: '100%', padding: '.4rem .5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', marginTop: '.25rem' }}
                                    >
                                      <option value="">{'\u2014'}</option>
                                      <option value="high">Alto</option>
                                      <option value="medium">Medio</option>
                                      <option value="low">Bajo</option>
                                    </select>
                                  </label>
                                  <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)' }}>
                                    Notas
                                    <textarea
                                      value={editForm.notes}
                                      onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                      rows={2}
                                      style={{ width: '100%', padding: '.4rem .5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', marginTop: '.25rem', resize: 'vertical' }}
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

  const poolCounts: Record<string, number> = {};
  if (segData && segData.byPool) {
    Object.assign(poolCounts, segData.byPool);
  } else if (assessments.length) {
    for (const a of assessments) {
      poolCounts[a.talentPool] = (poolCounts[a.talentPool] || 0) + 1;
    }
  }

  const POOL_CIRCLE_COLOR: Record<string, string> = {
    star: 'var(--success)', high_performer: 'var(--success)', core_player: 'var(--accent)',
    high_potential: 'var(--warning)', enigma: 'var(--warning)', risk: 'var(--danger)',
    inconsistent: 'var(--danger)', underperformer: 'var(--danger)', dysfunctional: 'var(--danger)',
  };

  return (
    <div>
      {/* Cycle selector */}
      <div style={{ marginBottom: '1.5rem' }}>
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
      </div>

      {loading && <Spinner />}

      {!loading && selectedCycleId && (
        <>
          {/* Pool cards */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.75rem', marginBottom: '1.5rem' }}>
            {POOLS_ORDER.map((pool) => (
              <div key={pool} className="card" style={{ minWidth: '120px', textAlign: 'center', padding: '.75rem 1rem' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%', margin: '0 auto .5rem',
                  background: POOL_CIRCLE_COLOR[pool] || 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontWeight: 700, fontSize: '1rem',
                }}>
                  {poolCounts[pool] || 0}
                </div>
                <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {POOL_LABEL[pool]}
                </div>
              </div>
            ))}
          </div>

          {/* Assessments table */}
          {assessments.length > 0 && (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th><th>Departamento</th><th>{`Desempe\u00f1o`}</th><th>Potencial</th>
                    <th>{`Clasificaci\u00f3n`}</th><th>{`Preparaci\u00f3n`}</th><th>Riesgo de Fuga</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((a: any) => {
                    const u = a.user || a;
                    return (
                      <tr key={a.id}>
                        <td style={{ fontWeight: 600 }}>{u.firstName} {u.lastName}</td>
                        <td>{u.department || '\u2014'}</td>
                        <td>{a.performanceScore ?? '\u2014'}</td>
                        <td>{a.potentialScore ?? '\u2014'}</td>
                        <td><span className={`badge ${POOL_BADGE[a.talentPool] || 'badge-accent'}`}>{POOL_LABEL[a.talentPool] || a.talentPool}</span></td>
                        <td>{READINESS_LABEL[a.readiness] || a.readiness || '\u2014'}</td>
                        <td>{a.flightRisk ? <span className={`badge ${RISK_BADGE[a.flightRisk]}`}>{RISK_LABEL[a.flightRisk]}</span> : '\u2014'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {assessments.length === 0 && !loading && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
              {`No hay evaluaciones de talento para este ciclo. Genera una evaluaci\u00f3n primero desde la pesta\u00f1a Nine Box.`}
            </p>
          )}
        </>
      )}

      {!loading && !selectedCycleId && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
          {`Selecciona un ciclo para ver la segmentaci\u00f3n de talento.`}
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
