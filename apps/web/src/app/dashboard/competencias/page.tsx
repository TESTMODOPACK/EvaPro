'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

const CATEGORY_BADGE: Record<string, string> = {
  tecnica: 'badge badge-accent',
  blanda: 'badge badge-success',
  gestion: 'badge badge-warning',
  liderazgo: 'badge badge-danger',
};

const CATEGORY_LABEL: Record<string, string> = {
  tecnica: 'T\u00e9cnica',
  blanda: 'Blanda',
  gestion: 'Gesti\u00f3n',
  liderazgo: 'Liderazgo',
};

interface CompetencyForm {
  name: string;
  category: string;
  description: string;
}

const emptyForm: CompetencyForm = { name: '', category: 'tecnica', description: '' };

export default function CompetenciasPage() {
  const { token, user } = useAuthStore();
  const isAdmin = user?.role === 'tenant_admin';

  const [loading, setLoading] = useState(true);
  const [competencies, setCompetencies] = useState<any[]>([]);
  const [error, setError] = useState('');

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CompetencyForm>(emptyForm);
  const [creating, setCreating] = useState(false);

  // Edit inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CompetencyForm>(emptyForm);

  useEffect(() => {
    if (!token) return;
    loadData();
  }, [token]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const res = await api.development.competencies.list(token!);
      setCompetencies(Array.isArray(res) ? res : []);
    } catch (e: any) {
      setError(e.message || 'Error al cargar competencias');
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
      setForm(emptyForm);
      setShowCreate(false);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Error al crear competencia');
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
      alert(e.message || 'Error al actualizar competencia');
    }
  }

  async function handleDeactivate(id: string) {
    if (!token) return;
    if (!confirm('\u00bfDesactivar esta competencia?')) return;
    try {
      await api.development.competencies.deactivate(token, id);
      await loadData();
    } catch (e: any) {
      alert(e.message || 'Error al desactivar competencia');
    }
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
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancelar' : '+ Nueva Competencia'}
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--danger)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {/* Info card */}
      <div className="card" style={{ background: 'rgba(99,102,241,0.05)', borderLeft: '4px solid var(--accent)' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Define las competencias que se utilizan en los planes de desarrollo. Estas competencias se vinculan a las acciones del PDI.
        </p>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card animate-fade-up">
          <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 0 }}>
            Nueva Competencia
          </h2>
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Nombre
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="Nombre de la competencia"
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                {'Categor\u00eda'}
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                >
                  <option value="tecnica">{'T\u00e9cnica'}</option>
                  <option value="blanda">Blanda</option>
                  <option value="gestion">{'Gesti\u00f3n'}</option>
                  <option value="liderazgo">Liderazgo</option>
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {'Descripci\u00f3n'}
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                placeholder={'Descripci\u00f3n de la competencia (opcional)'}
                style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', color: 'var(--text-primary)', resize: 'vertical' }}
              />
            </label>
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
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
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
                            <option value="tecnica">{'T\u00e9cnica'}</option>
                            <option value="blanda">Blanda</option>
                            <option value="gestion">{'Gesti\u00f3n'}</option>
                            <option value="liderazgo">Liderazgo</option>
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
                          <span className={CATEGORY_BADGE[comp.category] || 'badge'} style={{ fontSize: '0.72rem' }}>
                            {CATEGORY_LABEL[comp.category] || comp.category}
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
                                  category: comp.category || 'tecnica',
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
    </div>
  );
}
