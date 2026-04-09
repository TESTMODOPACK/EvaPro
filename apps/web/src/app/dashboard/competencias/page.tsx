'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import ConfirmModal from '@/components/ConfirmModal';
import { DEFAULT_COMPETENCY_CATEGORIES } from '@/lib/constants';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

// ─── Paleta de colores para categorías dinámicas ──────────────────────────────
// Se asigna por índice (posición en la lista de Mantenedores), rotando entre 5 estilos.
const BADGE_PALETTE = [
  { badge: 'badge badge-accent',   dot: 'var(--accent)'   },
  { badge: 'badge badge-success',  dot: 'var(--success)'  },
  { badge: 'badge badge-warning',  dot: 'var(--warning)'  },
  { badge: 'badge badge-danger',   dot: 'var(--danger)'   },
  { badge: 'badge',                dot: 'var(--text-muted)' },
];

// Legado: mapeo de claves antiguas a nombres legibles (para competencias existentes
// que fueron guardadas con las claves hardcodeadas anteriores).
const LEGACY_LABEL: Record<string, string> = {
  tecnica:   'Técnica',
  blanda:    'Blanda',
  gestion:   'Gestión',
  liderazgo: 'Liderazgo',
  // También cubrir mayúsculas por si acaso
  Tecnica:   'Técnica',
  Blanda:    'Blanda',
  Gestion:   'Gestión',
  Liderazgo: 'Liderazgo',
};

interface CompetencyForm {
  name: string;
  category: string;
  description: string;
}

export default function CompetenciasPage() {
  const { t } = useTranslation();
  const { token, user } = useAuthStore();
  const toast = useToastStore();
  const isAdmin = user?.role === 'tenant_admin';

  const [confirmState, setConfirmState] = useState<{
    message: string;
    detail?: string;
    danger?: boolean;
    confirmLabel?: string;
    onConfirm: () => void;
  } | null>(null);

  const [showGuide, setShowGuide] = useState(false);
  const [loading, setLoading] = useState(true);
  const [competencies, setCompetencies] = useState<any[]>([]);
  const [error, setError] = useState('');

  // ── Categorías derivadas de las competencias existentes ────────────────
  const [categories, setCategories] = useState<string[]>(DEFAULT_COMPETENCY_CATEGORIES);

  // Derivados: índice → paleta de color, nombre legible
  const categoryIndex = (cat: string) => {
    const idx = categories.indexOf(cat);
    return idx >= 0 ? idx : -1;
  };
  const getCategoryBadge = (cat: string): string => {
    const idx = categoryIndex(cat);
    if (idx >= 0) return BADGE_PALETTE[idx % BADGE_PALETTE.length].badge;
    // Legado: claves antiguas hardcodeadas
    if (cat === 'tecnica') return BADGE_PALETTE[0].badge;
    if (cat === 'blanda')  return BADGE_PALETTE[1].badge;
    if (cat === 'gestion') return BADGE_PALETTE[2].badge;
    if (cat === 'liderazgo') return BADGE_PALETTE[3].badge;
    return BADGE_PALETTE[4].badge;
  };
  const getCategoryLabel = (cat: string): string => {
    // Si está en la lista actual, mostrarlo tal cual (ya es el nombre legible)
    if (categories.includes(cat)) return cat;
    // Legado: traducir claves antiguas
    return LEGACY_LABEL[cat] ?? cat;
  };
  const getCategoryDot = (cat: string): string => {
    const idx = categoryIndex(cat);
    return idx >= 0 ? BADGE_PALETTE[idx % BADGE_PALETTE.length].dot : 'var(--text-muted)';
  };

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CompetencyForm>({ name: '', category: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const handleSeedDefaults = async () => {
    if (!token) return;
    if (!confirm('Se cargarán 8 competencias base (Gestión, Blanda, Técnica). Las existentes con el mismo nombre se actualizarán con acentos correctos. ¿Continuar?')) return;
    setSeeding(true);
    try {
      const result = await api.development.competencies.seedDefaults(token);
      const parts = [];
      if (result.created > 0) parts.push(`${result.created} nuevas`);
      if (result.updated > 0) parts.push(`${result.updated} actualizadas`);
      if (result.skipped > 0) parts.push(`${result.skipped} ya existían`);
      toast.success(`Competencias base: ${parts.join(', ')}`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Error al cargar competencias base');
    }
    setSeeding(false);
  };

  // Edit inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CompetencyForm>({ name: '', category: '', description: '' });

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token]);

  const planBlocked = error.includes('plan') || error.includes('Plan') || error.includes('funcionalidad');

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await api.development.competencies.list(token!);
      const comps = Array.isArray(res) ? res : [];
      setCompetencies(comps);

      // Derivar categorías de las competencias existentes + defaults
      const existingCats = Array.from(new Set(comps.map((c: any) => c.category).filter(Boolean))) as string[];
      const allCats = Array.from(new Set([...existingCats, ...DEFAULT_COMPETENCY_CATEGORIES]));
      allCats.sort();
      setCategories(allCats);

      // Sincronizar el valor por defecto del formulario con la primera categoría
      setForm((f) => ({ ...f, category: f.category || allCats[0] || '' }));
    } catch (e: any) {
      const msg = e.message || 'Error al cargar competencias';
      setError(msg.replace(/"PDI"/g, '"Planes de Desarrollo Individual (PDI)"'));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    try {
      await api.development.competencies.create(token, {
        name: form.name,
        category: form.category,
        description: form.description || undefined,
      });
      setForm({ name: '', category: categories[0] || '', description: '' });
      setShowCreate(false);
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Error al crear competencia');
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit(id: string) {
    if (!token) return;
    try {
      await api.development.competencies.update(token, id, {
        name: editForm.name,
        category: editForm.category,
        description: editForm.description || undefined,
      });
      setEditingId(null);
      await loadData();
    } catch (e: any) {
      toast.error(e.message || 'Error al actualizar competencia');
    }
  }

  async function handleDeactivate(id: string) {
    if (!token) return;
    setConfirmState({
      message: '¿Desactivar esta competencia?',
      danger: true,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await api.development.competencies.deactivate(token, id);
          await loadData();
        } catch (e: any) {
          toast.error(e.message || 'Error al desactivar competencia');
        }
      },
    });
  }

  if (!isAdmin) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        {'No tienes permisos para acceder a esta secci\u00f3n.'}
      </div>
    );
  }

  if (loading) return <Spinner />;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
    <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
            {'Cat\u00e1logo de Competencias'}
          </h1>
          <p style={{ color: 'var(--text-muted)', margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
            {'Gesti\u00f3n de competencias para planes de desarrollo'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={handleSeedDefaults} disabled={seeding || planBlocked}
            style={{ fontSize: '0.82rem' }}>
            {seeding ? 'Cargando...' : 'Cargar competencias base'}
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)} disabled={planBlocked}>
            {showCreate ? 'Cancelar' : '+ Nueva Competencia'}
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{
          padding: '1rem 1.25rem',
          borderLeft: '4px solid var(--warning)',
          background: 'rgba(217,119,6,0.06)',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)', marginBottom: '0.15rem' }}>
              Funcionalidad restringida
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {error}
            </div>
          </div>
        </div>
      )}

      {/* Guide toggle */}
      <button
        onClick={() => setShowGuide(!showGuide)}
        style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, padding: 0, textAlign: 'left' }}
      >
        {showGuide ? t('common.hideGuide') : t('common.showGuide')}
      </button>

      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {'Gu\u00eda de uso: Cat\u00e1logo de Competencias'}
          </h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1rem', lineHeight: 1.6 }}>
            {'El cat\u00e1logo de competencias define las habilidades y conocimientos clave que la organizaci\u00f3n necesita desarrollar en sus colaboradores. Cada competencia se clasifica por categor\u00eda y se vincula directamente con las acciones de los Planes de Desarrollo Individual (PDI).'}
          </p>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{'Categor\u00edas configuradas'}</div>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {'Edita las categor\u00edas en Mantenedores \u2192 Categor\u00edas de Competencias'}
              </span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {categories.map((cat, i) => (
                <span
                  key={cat}
                  className={BADGE_PALETTE[i % BADGE_PALETTE.length].badge}
                  style={{ fontSize: '0.78rem' }}
                >
                  {cat}
                </span>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{'Conexi\u00f3n con otras funciones'}</div>
            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <li><strong>Planes de Desarrollo (PDI):</strong>{' Las acciones del PDI se vinculan a competencias espec\u00edficas del cat\u00e1logo'}</li>
              <li><strong>{'Evaluaci\u00f3n de Talento:'}</strong>{' Las brechas de competencia identificadas en el Nine Box sugieren acciones de desarrollo'}</li>
              <li><strong>Objetivos:</strong>{' Los objetivos de tipo OKR pueden alinearse con el desarrollo de competencias clave'}</li>
            </ul>
          </div>

          <div style={{ padding: '0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--accent)' }}>Permisos:</strong>{' Solo el Administrador puede crear, editar y eliminar competencias. Los Encargados de Equipo y Colaboradores pueden ver el cat\u00e1logo al crear acciones en sus PDI.'}
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && !planBlocked && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', borderLeft: '4px solid var(--accent)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 0.25rem' }}>
            Nueva Competencia
          </h2>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1.25rem' }}>
            Define una nueva competencia para agregar al catálogo organizacional
          </p>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  Nombre
                </label>
                <input
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="Nombre de la competencia"
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  Categoría
                </label>
                <select
                  className="input"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  style={{ width: '100%' }}
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                Descripción
              </label>
              <textarea
                className="input"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder="Descripción de la competencia (opcional)"
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-ghost" onClick={() => setShowCreate(false)}>Cancelar</button>
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? 'Creando...' : 'Crear Competencia'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {competencies.length === 0 && !loading ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          No hay competencias registradas. Crea la primera competencia para comenzar.
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '600px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(99,102,241,0.03)' }}>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Nombre</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{'Categor\u00eda'}</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{'Descripci\u00f3n'}</th>
                  <th style={{ textAlign: 'center', padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Estado</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.78rem' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {competencies.map((comp: any) => (
                  <tr key={comp.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    {editingId === comp.id ? (
                      <>
                        <td style={{ padding: '0.5rem 1rem' }}>
                          <input
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem', width: '100%' }}
                          />
                        </td>
                        <td style={{ padding: '0.5rem 1rem' }}>
                          <select
                            value={editForm.category}
                            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                            style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                          >
                            {/* Mostrar las categorías actuales de Mantenedores */}
                            {categories.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                            {/* Si la categoría guardada no está en la lista actual (legado), mostrarla igual */}
                            {editForm.category && !categories.includes(editForm.category) && (
                              <option value={editForm.category}>
                                {getCategoryLabel(editForm.category)} (legado)
                              </option>
                            )}
                          </select>
                        </td>
                        <td style={{ padding: '0.5rem 1rem' }}>
                          <input
                            value={editForm.description}
                            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                            style={{ padding: '0.35rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: '0.82rem', width: '100%' }}
                          />
                        </td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'center' }}>
                          <span className={comp.isActive !== false ? 'badge badge-success' : 'badge badge-danger'} style={{ fontSize: '0.72rem' }}>
                            {comp.isActive !== false ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                            <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }} onClick={() => setEditingId(null)}>Cancelar</button>
                            <button className="btn-primary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }} onClick={() => handleEdit(comp.id)}>Guardar</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{comp.name}</td>
                        <td style={{ padding: '0.75rem 1rem' }}>
                          <span className={getCategoryBadge(comp.category)} style={{ fontSize: '0.72rem' }}>
                            {getCategoryLabel(comp.category)}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {comp.description || '\u2014'}
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                          <span className={comp.isActive !== false ? 'badge badge-success' : 'badge badge-danger'} style={{ fontSize: '0.72rem' }}>
                            {comp.isActive !== false ? 'Activa' : 'Inactiva'}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'flex-end' }}>
                            <button
                              className="btn-ghost"
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
                              onClick={() => {
                                setEditingId(comp.id);
                                setEditForm({
                                  name: comp.name || '',
                                  // Si la categoría guardada no está en la lista actual, mantenerla tal cual
                                  category: comp.category || categories[0] || '',
                                  description: comp.description || '',
                                });
                              }}
                            >
                              Editar
                            </button>
                            {comp.isActive !== false && (
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem', color: 'var(--danger)' }}
                                onClick={() => handleDeactivate(comp.id)}
                              >
                                Desactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    {confirmState && (
      <ConfirmModal
        message={confirmState.message}
        detail={confirmState.detail}
        danger={confirmState.danger}
        confirmLabel={confirmState.confirmLabel}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(null)}
      />
    )}
    </div>
  );
}
