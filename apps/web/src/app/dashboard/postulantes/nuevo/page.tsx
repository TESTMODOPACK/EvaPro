'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useDepartments } from '@/hooks/useDepartments';
import { usePositions } from '@/hooks/usePositions';

const REQUIREMENT_CATEGORIES = [
  {
    key: 'experiencia',
    label: 'Experiencia',
    defaults: [
      '3+ años de experiencia en el área',
      'Experiencia liderando equipos',
      'Experiencia en la industria',
      'Experiencia en gestión de proyectos',
    ],
  },
  {
    key: 'conocimiento_tecnico',
    label: 'Conocimiento Técnico',
    defaults: [
      'Dominio de herramientas ofimáticas avanzadas',
      'Manejo de sistemas ERP',
      'Conocimiento de metodologías ágiles',
      'Manejo de herramientas de análisis de datos',
    ],
  },
  {
    key: 'habilidades_blandas',
    label: 'Habilidades Blandas',
    defaults: [], // Se cargan desde competencias de la organización
  },
  {
    key: 'formacion',
    label: 'Formación',
    defaults: [
      'Título profesional universitario',
      'Postgrado o MBA',
      'Certificaciones relevantes del área',
    ],
  },
  {
    key: 'idiomas',
    label: 'Idiomas',
    defaults: [
      'Inglés intermedio',
      'Inglés avanzado',
      'Portugués básico',
    ],
  },
];

export default function NuevoProcesoPage() {
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore((s) => s.toast);
  const router = useRouter();
  const { departments: configuredDepartments } = useDepartments();
  const { positions: positionCatalog } = usePositions();
  const [showNewPosition, setShowNewPosition] = useState(false);
  const [newPosName, setNewPosName] = useState('');
  const [newPosLevel, setNewPosLevel] = useState(6);
  const [collapsedReqCats, setCollapsedReqCats] = useState<Set<string>>(new Set(REQUIREMENT_CATEGORIES.map(c => c.key)));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [users, setUsers] = useState<any[]>([]);
  const [competencies, setCompetencies] = useState<string[]>([]);

  // Form state
  const [processType, setProcessType] = useState('');
  const [title, setTitle] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [requirements, setRequirements] = useState<Array<{ category: string; text: string }>>([]);
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>([]);
  const [requireCvForInternal, setRequireCvForInternal] = useState(false);
  const [historyWeight, setHistoryWeight] = useState(40);
  const [customReq, setCustomReq] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return;
    api.users.list(token, 1, 200).then((res) => {
      setUsers((res as any).data || res || []);
    }).catch(() => {});
    // Load competencies for habilidades blandas
    api.development?.competencies?.list?.(token).then((data: any[]) => {
      setCompetencies((data || []).map((c: any) => c.name));
    }).catch(() => {});
  }, [token]);

  const deptMatch = (a: string, b: string) => (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' }) === 0;
  const eligibleEvaluators = users.filter((u: any) => ['tenant_admin', 'manager'].includes(u.role));
  const deptEvaluators = department ? eligibleEvaluators.filter((u: any) => deptMatch(u.department, department)) : [];
  const otherEvaluators = department ? eligibleEvaluators.filter((u: any) => !deptMatch(u.department, department)) : eligibleEvaluators;

  useEffect(() => {
    if (!department) return;
    const ids = deptEvaluators.map((u: any) => u.id);
    if (ids.length > 0) {
      setEvaluatorIds((prev) => {
        const seen = new Set(prev);
        for (const id of ids) seen.add(id);
        return Array.from(seen);
      });
    }
  }, [department]);

  const toggleReq = (category: string, text: string) => {
    setRequirements((prev) => {
      const exists = prev.some((r) => r.category === category && r.text === text);
      if (exists) return prev.filter((r) => !(r.category === category && r.text === text));
      return [...prev, { category, text }];
    });
  };

  const isReqSelected = (category: string, text: string) =>
    requirements.some((r) => r.category === category && r.text === text);

  const addCustomReq = (category: string) => {
    const text = (customReq[category] || '').trim();
    if (!text) return;
    if (!isReqSelected(category, text)) {
      setRequirements((prev) => [...prev, { category, text }]);
    }
    setCustomReq((prev) => ({ ...prev, [category]: '' }));
  };

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!token || !processType || !title.trim() || !position.trim()) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.recruitment.processes.create(token, {
        processType, title: title.trim(), position: position.trim(),
        department: department || undefined,
        description: description.trim() || undefined,
        requirements,
        requireCvForInternal,
        scoringWeights: { history: historyWeight, interview: 100 - historyWeight },
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        evaluatorIds: evaluatorIds.length ? evaluatorIds : undefined,
      });
      router.push('/dashboard/postulantes/' + result.id);
    } catch (err: any) {
      setError(err.message || 'Error al crear el proceso');
      setSaving(false);
    }
  };

  const toggleEvaluator = (id: string) => {
    setEvaluatorIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const labelStyle = {
    display: 'block' as const, fontSize: '0.78rem', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '0.4rem',
    textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  };

  // Build requirement options with org competencies
  const reqCategories = REQUIREMENT_CATEGORIES.map((cat) => {
    if (cat.key === 'habilidades_blandas') {
      return { ...cat, defaults: competencies.length > 0 ? competencies : ['Trabajo en equipo', 'Comunicación efectiva', 'Liderazgo', 'Resolución de problemas', 'Orientación a resultados'] };
    }
    return cat;
  });

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Nuevo Proceso de Selección</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Define el tipo, cargo, requisitos y evaluadores</p>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Step 1: Type */}
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Tipo de Proceso *</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {[
              { key: 'external', icon: 'E', title: 'Contratación Externa', desc: 'Candidatos fuera de la organización. CV, análisis IA y entrevistas.' },
              { key: 'internal', icon: 'I', title: 'Promoción Interna', desc: 'Colaboradores de la organización. Historial, comparativa y recomendación IA.' },
            ].map((opt) => (
              <button key={opt.key} type="button" onClick={() => setProcessType(opt.key)}
                style={{
                  padding: '1.25rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', textAlign: 'left' as const,
                  border: processType === opt.key ? `2px solid ${opt.key === 'external' ? 'var(--accent)' : '#6366f1'}` : '2px solid var(--border)',
                  background: processType === opt.key ? (opt.key === 'external' ? 'rgba(201,147,58,0.06)' : 'rgba(99,102,241,0.06)') : 'transparent',
                }}>
                <div style={{ fontSize: '1.2rem', marginBottom: '0.3rem' }} dangerouslySetInnerHTML={{ __html: opt.key === 'external' ? '&#127758;' : '&#127970;' }} />
                <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.25rem' }}>{opt.title}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {processType && (
          <>
            {/* Step 2: Basic info */}
            <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Información del Proceso</h2>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>Título del proceso *</label>
                  <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Analista de Datos Q2 2026" required />
                </div>
                <div>
                  <label style={labelStyle}>Cargo *</label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <select className="input" style={{ flex: 1 }} value={positionCatalog.some(p => p.name === position) ? position : (position ? '__custom__' : '')}
                      onChange={(e) => { if (e.target.value === '__new__') { setShowNewPosition(true); } else if (e.target.value === '__custom__') { setPosition(''); } else { setPosition(e.target.value); } }}>
                      <option value="">Seleccionar cargo...</option>
                      {positionCatalog.map(p => <option key={p.name} value={p.name}>{p.name} (Nivel {p.level})</option>)}
                      {position && !positionCatalog.some(p => p.name === position) && <option value="__custom__">{position} (personalizado)</option>}
                      <option value="__new__">+ Crear nuevo cargo</option>
                    </select>
                  </div>
                  <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                    Si el cargo no existe en el listado, selecciona &quot;+ Crear nuevo cargo&quot; al final de la lista para agregarlo.
                  </p>
                  {showNewPosition && (
                    <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <input className="input" placeholder="Nombre del cargo" value={newPosName} onChange={(e) => setNewPosName(e.target.value)} style={{ flex: 1, fontSize: '0.82rem' }} />
                        <input className="input" type="number" min={1} max={20} value={newPosLevel} onChange={(e) => setNewPosLevel(Number(e.target.value) || 6)} style={{ width: '80px', fontSize: '0.82rem' }} placeholder="Nivel" />
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button className="btn-primary" style={{ fontSize: '0.78rem' }} disabled={!newPosName.trim()} onClick={async () => {
                          if (!token || !newPosName.trim()) return;
                          try {
                            const current = [...positionCatalog, { name: newPosName.trim(), level: newPosLevel }].sort((a, b) => a.level - b.level);
                            await api.tenants.setPositionsCatalog(token, current);
                            setPosition(newPosName.trim());
                            setNewPosName(''); setShowNewPosition(false);
                          } catch {}
                        }}>Crear</button>
                        <button className="btn-ghost" style={{ fontSize: '0.78rem' }} onClick={() => setShowNewPosition(false)}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={labelStyle}>Departamento</label>
                  <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
                    <option value="">Seleccionar</option>
                    {configuredDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Fecha inicio</label>
                  <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label style={labelStyle}>Fecha fin</label>
                  <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Descripción</label>
                <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexto del cargo..." rows={3} style={{ resize: 'vertical' as const }} />
              </div>
            </div>

            {/* Step 3: Requirements by category */}
            <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Requisitos del Cargo</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                Selecciona los requisitos agrupados por categoría. Puedes agregar personalizados.
              </p>
              {reqCategories.map((cat) => {
                const isCollapsed = collapsedReqCats.has(cat.key);
                const catCount = requirements.filter((r) => r.category === cat.key).length;
                return (
                  <div key={cat.key} style={{ marginBottom: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                    <button type="button" onClick={() => {
                      setCollapsedReqCats(prev => { const next = new Set(prev); if (next.has(cat.key)) next.delete(cat.key); else next.add(cat.key); return next; });
                    }} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.75rem', background: 'var(--bg-base)', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                        {isCollapsed ? '▶' : '▼'} {cat.label}
                      </span>
                      {catCount > 0 && <span className="badge badge-accent" style={{ fontSize: '0.68rem' }}>{catCount}</span>}
                    </button>
                    {!isCollapsed && (
                      <div style={{ padding: '0.5rem 0.75rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', marginBottom: '0.5rem' }}>
                          {cat.defaults.map((text) => {
                            const checked = isReqSelected(cat.key, text);
                            return (
                              <label key={text} style={{
                                display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem',
                                cursor: 'pointer', padding: '0.3rem 0.5rem', borderRadius: 'var(--radius-sm)',
                                background: checked ? 'rgba(201,147,58,0.08)' : 'transparent',
                              }}>
                                <input type="checkbox" checked={checked} onChange={() => toggleReq(cat.key, text)} style={{ accentColor: 'var(--accent)' }} />
                                <span style={{ fontWeight: checked ? 600 : 400 }}>{text}</span>
                              </label>
                            );
                          })}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <input className="input" style={{ flex: 1, fontSize: '0.82rem' }}
                            value={customReq[cat.key] || ''} onChange={(e) => setCustomReq((p) => ({ ...p, [cat.key]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomReq(cat.key); } }}
                            placeholder={`Agregar requisito de ${cat.label.toLowerCase()}...`} />
                          <button type="button" className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => addCustomReq(cat.key)} disabled={!(customReq[cat.key] || '').trim()}>+</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {requirements.length > 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  {requirements.length} requisito{requirements.length !== 1 ? 's' : ''} selecciónado{requirements.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>

            {/* Step 4: Evaluators */}
            <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Evaluadores</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                {department ? `Managers de "${department}" se sugieren automáticamente.` : 'Selecciona quiénes evaluarán candidatos.'}
              </p>
              {department && deptEvaluators.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    Evaluadores del departamento
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem' }}>
                    {deptEvaluators.map((u: any) => (
                      <button key={u.id} type="button" onClick={() => toggleEvaluator(u.id)}
                        style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', borderRadius: 20, cursor: 'pointer',
                          border: evaluatorIds.includes(u.id) ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: evaluatorIds.includes(u.id) ? 'rgba(201,147,58,0.1)' : 'transparent',
                          color: evaluatorIds.includes(u.id) ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: evaluatorIds.includes(u.id) ? 600 : 400,
                        }}>
                        {u.firstName} {u.lastName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {otherEvaluators.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                    {department ? 'Evaluadores de otras areas' : 'Evaluadores disponibles'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: '0.5rem' }}>
                    {otherEvaluators.map((u: any) => (
                      <button key={u.id} type="button" onClick={() => toggleEvaluator(u.id)}
                        style={{ padding: '0.4rem 0.85rem', fontSize: '0.82rem', borderRadius: 20, cursor: 'pointer',
                          border: evaluatorIds.includes(u.id) ? '2px solid var(--accent)' : '1px solid var(--border)',
                          background: evaluatorIds.includes(u.id) ? 'rgba(201,147,58,0.1)' : 'transparent',
                          color: evaluatorIds.includes(u.id) ? 'var(--accent)' : 'var(--text-secondary)',
                          fontWeight: evaluatorIds.includes(u.id) ? 600 : 400,
                        }}>
                        {u.firstName} {u.lastName} {u.department ? `(${u.department})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {evaluatorIds.length > 0 && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {evaluatorIds.length} evaluador(es) selecciónado(s)
                </div>
              )}
            </div>

            {/* Step 5: Internal config (only for internal processes) */}
            {processType === 'internal' && (
              <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
                <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Configuración Proceso Interno</h2>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  <input type="checkbox" checked={requireCvForInternal} onChange={(e) => setRequireCvForInternal(e.target.checked)} />
                  Solicitar CV a los postulantes internos
                </label>
                <div>
                  <label style={labelStyle}>Pesos de puntuacion (historial vs entrevistas)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontSize: '0.82rem', minWidth: 120 }}>Historial: <strong>{historyWeight}%</strong></span>
                    <input type="range" min={0} max={100} step={5} value={historyWeight} onChange={(e) => setHistoryWeight(Number(e.target.value))} style={{ flex: 1 }} />
                    <span style={{ fontSize: '0.82rem', minWidth: 120 }}>Entrevistas: <strong>{100 - historyWeight}%</strong></span>
                  </div>
                </div>
              </div>
            )}

            {/* Error + Submit */}
            {error && (
              <div style={{ padding: '0.75rem 1rem', marginBottom: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem' }}>
                {error}
              </div>
            )}
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <button type="submit" className="btn-primary" disabled={saving || !title.trim() || !position.trim()}>
                {saving ? 'Creando...' : 'Crear Proceso'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => router.back()}>Cancelar</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
