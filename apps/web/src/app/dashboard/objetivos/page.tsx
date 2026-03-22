'use client';

import { useState } from 'react';
import {
  useObjectives,
  useCreateObjective,
  useUpdateObjective,
  useDeleteObjective,
  useAddObjectiveProgress,
} from '@/hooks/useObjectives';

type FilterStatus = 'all' | 'active' | 'completed' | 'abandoned';
type ObjType = 'OKR' | 'KPI' | 'SMART';

const typeBadge: Record<string, string> = {
  OKR: 'badge-accent',
  KPI: 'badge-warning',
  SMART: 'badge-success',
};

const statusLabel: Record<string, string> = {
  active: 'Activo',
  completed: 'Completado',
  abandoned: 'Abandonado',
};

const statusBadge: Record<string, string> = {
  active: 'badge-success',
  completed: 'badge-accent',
  abandoned: 'badge-danger',
};

const filterPills: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Activos' },
  { key: 'completed', label: 'Completados' },
  { key: 'abandoned', label: 'Abandonados' },
];

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function progressColor(p: number) {
  if (p < 30) return 'var(--danger)';
  if (p < 70) return 'var(--warning)';
  return 'var(--success)';
}

function formatDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ObjetivosPage() {
  const { data: objectives, isLoading } = useObjectives();
  const createObjective = useCreateObjective();
  const deleteObjective = useDeleteObjective();
  const addProgress = useAddObjectiveProgress();

  const [filter, setFilter] = useState<FilterStatus>('all');
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [progressForm, setProgressForm] = useState<{ value: number; notes: string }>({ value: 50, notes: '' });
  const [form, setForm] = useState({ title: '', description: '', type: 'OKR' as ObjType, targetDate: '' });

  const filtered = objectives
    ? objectives.filter((o: any) => filter === 'all' || o.status === filter)
    : [];

  function handleCreate() {
    if (!form.title) return;
    createObjective.mutate(
      {
        title: form.title,
        description: form.description || null,
        type: form.type,
        targetDate: form.targetDate || null,
      },
      {
        onSuccess: () => {
          setForm({ title: '', description: '', type: 'OKR', targetDate: '' });
          setShowForm(false);
        },
      },
    );
  }

  function handleProgress(id: string) {
    addProgress.mutate(
      { id, data: { progressValue: progressForm.value, notes: progressForm.notes || null } },
      {
        onSuccess: () => {
          setExpandedId(null);
          setProgressForm({ value: 50, notes: '' });
        },
      },
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Mis Objetivos</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestiona y da seguimiento a tus objetivos
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancelar' : '+ Nuevo Objetivo'}
        </button>
      </div>

      {/* Filter pills */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {filterPills.map((fp) => (
          <button
            key={fp.key}
            className={filter === fp.key ? 'btn-primary' : 'btn-ghost'}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            onClick={() => setFilter(fp.key)}
          >
            {fp.label}
          </button>
        ))}
      </div>

      {/* New objective form */}
      {showForm && (
        <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>Nuevo Objetivo</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Titulo
              </label>
              <input
                className="input"
                type="text"
                placeholder="Titulo del objetivo..."
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                Descripcion
              </label>
              <textarea
                className="input"
                rows={2}
                placeholder="Describe el objetivo..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                style={{ width: '100%', resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  Tipo
                </label>
                <select
                  className="input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as ObjType })}
                  style={{ width: '100%' }}
                >
                  <option value="OKR">OKR</option>
                  <option value="KPI">KPI</option>
                  <option value="SMART">SMART</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>
                  Fecha objetivo
                </label>
                <input
                  className="input"
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={createObjective.isPending || !form.title}
              style={{ alignSelf: 'flex-start' }}
            >
              {createObjective.isPending ? 'Creando...' : 'Crear Objetivo'}
            </button>
          </div>
        </div>
      )}

      {/* Objectives grid */}
      {isLoading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
            {objectives && objectives.length > 0
              ? 'No hay objetivos con este filtro'
              : 'No hay objetivos registrados'}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
            {objectives && objectives.length > 0
              ? 'Prueba con otro filtro'
              : 'Crea tu primer objetivo para comenzar'}
          </p>
        </div>
      ) : (
        <div
          className="animate-fade-up"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}
        >
          {filtered.map((obj: any) => {
            const progress = Number(obj.progress) || 0;
            const color = progressColor(progress);
            const isExpanded = expandedId === obj.id;

            return (
              <div key={obj.id} className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column' }}>
                {/* Title + badges */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                  <h3 style={{ fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.4, flex: 1, marginRight: '0.5rem' }}>
                    {obj.title}
                  </h3>
                  <div style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
                    <span className={`badge ${typeBadge[obj.type] || 'badge-accent'}`}>{obj.type}</span>
                    <span className={`badge ${statusBadge[obj.status] || 'badge-accent'}`}>
                      {statusLabel[obj.status] || obj.status}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Progreso</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color }}>{progress}%</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                    <div style={{
                      width: `${progress}%`,
                      height: '100%',
                      borderRadius: '999px',
                      background: color,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>

                {/* Target date */}
                {obj.targetDate && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                    Meta: {formatDate(obj.targetDate)}
                  </p>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.5rem' }}>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedId(null);
                      } else {
                        setExpandedId(obj.id);
                        setProgressForm({ value: progress, notes: '' });
                      }
                    }}
                  >
                    {isExpanded ? 'Cerrar' : 'Actualizar'}
                  </button>
                  <button
                    className="btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem', color: 'var(--danger)' }}
                    onClick={() => {
                      if (confirm('Eliminar este objetivo?')) deleteObjective.mutate(obj.id);
                    }}
                  >
                    Eliminar
                  </button>
                </div>

                {/* Inline progress update */}
                {isExpanded && (
                  <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                        Progreso: {progressForm.value}%
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={progressForm.value}
                        onChange={(e) => setProgressForm({ ...progressForm, value: Number(e.target.value) })}
                        style={{ width: '100%', accentColor: 'var(--accent)' }}
                      />
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <textarea
                        className="input"
                        rows={2}
                        placeholder="Notas sobre el avance..."
                        value={progressForm.notes}
                        onChange={(e) => setProgressForm({ ...progressForm, notes: e.target.value })}
                        style={{ width: '100%', resize: 'vertical', fontSize: '0.8rem' }}
                      />
                    </div>
                    <button
                      className="btn-primary"
                      style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                      onClick={() => handleProgress(obj.id)}
                      disabled={addProgress.isPending}
                    >
                      {addProgress.isPending ? 'Guardando...' : 'Guardar'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
