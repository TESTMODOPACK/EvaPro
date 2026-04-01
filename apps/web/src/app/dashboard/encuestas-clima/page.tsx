'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';
import { api } from '@/lib/api';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useDepartments } from '@/hooks/useDepartments';

// ─── Default template questions ────────────────────────────────────────
const TEMPLATE_QUESTIONS = [
  { category: 'Liderazgo', questionText: 'Mi líder directo me da retroalimentación constructiva regularmente', questionType: 'likert_5', isRequired: true },
  { category: 'Comunicación', questionText: 'La comunicación interna de la empresa es clara y oportuna', questionType: 'likert_5', isRequired: true },
  { category: 'Bienestar', questionText: 'Siento que la empresa se preocupa por mi bienestar', questionType: 'likert_5', isRequired: true },
  { category: 'Cultura', questionText: 'Me siento orgulloso/a de trabajar en esta empresa', questionType: 'likert_5', isRequired: true },
  { category: 'Desarrollo', questionText: 'Tengo oportunidades reales de crecimiento profesional aquí', questionType: 'likert_5', isRequired: true },
  { category: 'Gestión', questionText: 'Tengo los recursos necesarios para hacer bien mi trabajo', questionType: 'likert_5', isRequired: true },
  { category: 'NPS', questionText: 'Del 0 al 10, ¿qué tan probable es que recomiendes esta empresa como lugar de trabajo?', questionType: 'nps', isRequired: true },
  { category: 'General', questionText: '¿Qué mejorarías de tu experiencia en la empresa?', questionType: 'open_text', isRequired: false },
];

const CATEGORIES = ['Liderazgo', 'Comunicación', 'Bienestar', 'Cultura', 'Desarrollo', 'Gestión', 'NPS', 'General'];
const QUESTION_TYPES = [
  { value: 'likert_5', label: 'Escala 1-5' },
  { value: 'nps', label: 'NPS (0-10)' },
  { value: 'open_text', label: 'Texto Abierto' },
  { value: 'multiple_choice', label: 'Opción Múltiple' },
];

const STATUS_MAP: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Borrador', badge: 'badge-ghost' },
  active: { label: 'Activa', badge: 'badge-success' },
  closed: { label: 'Cerrada', badge: 'badge-warning' },
};

export default function EncuestasClimaPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const toast = useToastStore((s) => s.toast);
  const isAdmin = user?.role === 'tenant_admin' || user?.role === 'super_admin';

  const [surveys, setSurveys] = useState<any[]>([]);
  const [pendingSurveys, setPendingSurveys] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Create form state
  const [form, setForm] = useState({
    title: '',
    description: '',
    isAnonymous: true,
    targetAudience: 'all' as 'all' | 'by_department',
    targetDepartments: [] as string[],
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
    questions: [...TEMPLATE_QUESTIONS] as any[],
  });

  const { departments } = useDepartments();

  const loadData = async () => {
    if (!token) return;
    setLoading(true);
    try {
      if (isAdmin) {
        const data = await api.surveys.list(token);
        setSurveys(data);
      }
      const pending = await api.surveys.getMyPending(token);
      setPendingSurveys(pending);
    } catch (e: any) {
      toast(e.message || 'Error al cargar encuestas', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [token]);

  const handleCreate = async () => {
    if (!token || !form.title.trim()) return;
    if (form.questions.length === 0) {
      toast('La encuesta debe tener al menos una pregunta', 'error');
      return;
    }
    setCreating(true);
    try {
      const dto = {
        ...form,
        questions: form.questions.map((q, i) => ({ ...q, sortOrder: i })),
      };
      await api.surveys.create(token, dto);
      toast('Encuesta creada exitosamente', 'success');
      setShowCreate(false);
      resetForm();
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al crear encuesta', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleLaunch = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.launch(token, id);
      toast('Encuesta lanzada exitosamente', 'success');
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al lanzar encuesta', 'error');
    }
  };

  const handleClose = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.close(token, id);
      toast('Encuesta cerrada exitosamente', 'success');
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al cerrar encuesta', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    try {
      await api.surveys.delete(token, id);
      toast('Encuesta eliminada', 'success');
      setConfirmDelete(null);
      loadData();
    } catch (e: any) {
      toast(e.message || 'Error al eliminar', 'error');
    }
  };

  const resetForm = () => {
    setForm({
      title: '', description: '', isAnonymous: true, targetAudience: 'all',
      targetDepartments: [], startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      questions: [...TEMPLATE_QUESTIONS],
    });
  };

  const addQuestion = () => {
    setForm((f) => ({
      ...f,
      questions: [...f.questions, { category: 'General', questionText: '', questionType: 'likert_5', isRequired: true, options: null }],
    }));
  };

  const removeQuestion = (idx: number) => {
    setForm((f) => ({ ...f, questions: f.questions.filter((_, i) => i !== idx) }));
  };

  const updateQuestion = (idx: number, field: string, value: any) => {
    setForm((f) => ({
      ...f,
      questions: f.questions.map((q, i) => (i === idx ? { ...q, [field]: value } : q)),
    }));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= form.questions.length) return;
    setForm((f) => {
      const qs = [...f.questions];
      [qs[idx], qs[newIdx]] = [qs[newIdx], qs[idx]];
      return { ...f, questions: qs };
    });
  };

  if (loading) return <div className="animate-fade-up" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Cargando encuestas...</div>;

  return (
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('surveys.title', 'Encuestas de Clima')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Mide el compromiso y satisfaccion de tu equipo
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setShowGuide(!showGuide)}>
            {showGuide ? 'Ocultar guia' : 'Ver guia'}
          </button>
          {isAdmin && (
            <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={() => setShowCreate(true)}>
              + Nueva Encuesta
            </button>
          )}
        </div>
      </div>

      {/* Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 0.5rem', fontSize: '1rem', fontWeight: 600 }}>Guia de Encuestas de Clima</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
            <li><strong>Crear:</strong> Define preguntas (Likert, NPS, texto abierto), audiencia y fechas</li>
            <li><strong>Lanzar:</strong> Envia la encuesta a los colaboradores seleccionados</li>
            <li><strong>Anonima:</strong> Las respuestas no registran identidad del respondente</li>
            <li><strong>Resultados:</strong> Visualiza promedios, eNPS, distribucion y tendencias</li>
            <li><strong>IA:</strong> Genera un analisis ejecutivo con recomendaciones automaticas</li>
            <li><strong>Desarrollo:</strong> Crea iniciativas organizacionales desde el analisis de la encuesta</li>
          </ul>
        </div>
      )}

      {/* Pending surveys for employees */}
      {pendingSurveys.length > 0 && (
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 0.75rem' }}>Encuestas Pendientes</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {pendingSurveys.map((s) => (
              <div key={s.id} className="card" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div>
                  <strong>{s.title}</strong>
                  {s.description && <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{s.description}</p>}
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <span>Fecha limite: {new Date(s.endDate).toLocaleDateString()}</span>
                    {s.isAnonymous && <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>Anonima</span>}
                  </div>
                </div>
                <Link href={`/dashboard/encuestas-clima/${s.id}/responder`} className="btn-primary" style={{ fontSize: '0.85rem', textDecoration: 'none' }}>
                  Responder
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin: surveys list */}
      {isAdmin && (
        <div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 0.75rem' }}>Todas las Encuestas</h2>
          {surveys.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              No hay encuestas creadas. Crea la primera encuesta de clima.
            </div>
          ) : (
            <div className="table-wrapper">
              <table style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Titulo</th>
                    <th>Estado</th>
                    <th>Anonima</th>
                    <th>Respuestas</th>
                    <th>Fecha Inicio</th>
                    <th>Fecha Fin</th>
                    <th style={{ textAlign: 'right' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {surveys.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: 500 }}>{s.title}</td>
                      <td>
                        <span className={`badge ${STATUS_MAP[s.status]?.badge || 'badge-ghost'}`}>
                          {STATUS_MAP[s.status]?.label || s.status}
                        </span>
                      </td>
                      <td>{s.isAnonymous ? 'Si' : 'No'}</td>
                      <td>{s.responseCount || 0}</td>
                      <td>{new Date(s.startDate).toLocaleDateString()}</td>
                      <td>{new Date(s.endDate).toLocaleDateString()}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {s.status === 'draft' && (
                            <>
                              <button onClick={() => handleLaunch(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(22,163,106,0.3)', background: 'rgba(22,163,106,0.08)', color: 'var(--success)', cursor: 'pointer' }}>Lanzar</button>
                              <button onClick={() => setConfirmDelete(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: 'var(--danger)', cursor: 'pointer' }}>Eliminar</button>
                            </>
                          )}
                          {s.status === 'active' && (
                            <button onClick={() => handleClose(s.id)} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(234,179,8,0.3)', background: 'rgba(234,179,8,0.08)', color: 'var(--warning)', cursor: 'pointer' }}>Cerrar</button>
                          )}
                          {(s.status === 'active' || s.status === 'closed') && (
                            <Link href={`/dashboard/encuestas-clima/${s.id}/resultados`} style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid rgba(201,147,58,0.3)', background: 'rgba(201,147,58,0.08)', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'none' }}>
                              Resultados
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div className="card animate-fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, padding: '1.75rem' }}>
            <h3 style={{ margin: '0 0 1rem' }}>Eliminar encuesta?</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Esta accion no se puede deshacer.</p>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setConfirmDelete(null)}>Cancelar</button>
              <button onClick={() => handleDelete(confirmDelete)} style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer' }}>Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Create survey modal */}
      {showCreate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCreate(false)}>
          <div className="card animate-fade-up" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, maxHeight: '90vh', overflowY: 'auto', padding: '1.75rem' }}>
            <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.25rem', fontWeight: 700 }}>Nueva Encuesta de Clima</h2>

            {/* Basic info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Titulo *</label>
                <input className="input" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Ej: Encuesta de Clima Q1 2026" />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Descripcion</label>
                <textarea className="input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} placeholder="Descripcion opcional..." />
              </div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha Inicio</label>
                  <input className="input" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha Fin</label>
                  <input className="input" type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={form.isAnonymous} onChange={(e) => setForm((f) => ({ ...f, isAnonymous: e.target.checked }))} />
                  Respuestas anonimas
                </label>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Audiencia</label>
                  <select className="input" value={form.targetAudience} onChange={(e) => setForm((f) => ({ ...f, targetAudience: e.target.value as any }))}>
                    <option value="all">Todos los colaboradores</option>
                    <option value="by_department">Por departamento</option>
                  </select>
                </div>
              </div>
              {form.targetAudience === 'by_department' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Departamentos</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {departments.map((d) => (
                      <label key={d} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={form.targetDepartments.includes(d)}
                          onChange={(e) => {
                            setForm((f) => ({
                              ...f,
                              targetDepartments: e.target.checked ? [...f.targetDepartments, d] : f.targetDepartments.filter((x) => x !== d),
                            }));
                          }}
                        />
                        {d}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Questions builder */}
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Preguntas ({form.questions.length})</h3>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => setForm((f) => ({ ...f, questions: [...TEMPLATE_QUESTIONS] }))}>
                    Usar plantilla
                  </button>
                  <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={addQuestion}>
                    + Agregar
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {form.questions.map((q, i) => (
                  <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.75rem', background: 'var(--bg-main)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <button className="btn-ghost" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }} onClick={() => moveQuestion(i, -1)} disabled={i === 0}>&#8593;</button>
                      <button className="btn-ghost" style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }} onClick={() => moveQuestion(i, 1)} disabled={i === form.questions.length - 1}>&#8595;</button>
                    </div>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <input
                        className="input"
                        style={{ fontSize: '0.85rem' }}
                        value={q.questionText}
                        onChange={(e) => updateQuestion(i, 'questionText', e.target.value)}
                        placeholder="Texto de la pregunta..."
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <select className="input" style={{ flex: 1, minWidth: 120, fontSize: '0.8rem' }} value={q.category} onChange={(e) => updateQuestion(i, 'category', e.target.value)}>
                          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <select className="input" style={{ flex: 1, minWidth: 120, fontSize: '0.8rem' }} value={q.questionType} onChange={(e) => updateQuestion(i, 'questionType', e.target.value)}>
                          {QUESTION_TYPES.map((tp) => <option key={tp.value} value={tp.value}>{tp.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <button className="btn-ghost" style={{ color: 'var(--danger)', padding: '0.25rem', fontSize: '0.8rem' }} onClick={() => removeQuestion(i)}>&#10005;</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
              <button className="btn-ghost" onClick={() => { setShowCreate(false); resetForm(); }}>Cancelar</button>
              <button className="btn-primary" onClick={handleCreate} disabled={creating || !form.title.trim()}>
                {creating ? 'Creando...' : 'Crear Encuesta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
