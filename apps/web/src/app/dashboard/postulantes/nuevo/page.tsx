'use client';

import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useDepartments } from '@/hooks/useDepartments';

export default function NuevoProcesoPage() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const { departments: configuredDepartments } = useDepartments();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<any[]>([]);

  const [title, setTitle] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>([]);

  useEffect(() => {
    if (!token) return;
    api.users.list(token, 1, 200).then((res) => {
      setUsers((res as any).data || res || []);
    }).catch(() => {});
  }, [token]);

  // Auto-suggest department managers when department changes
  const eligibleEvaluators = users.filter((u: any) => ['tenant_admin', 'manager'].includes(u.role));
  const deptEvaluators = department
    ? eligibleEvaluators.filter((u: any) => u.department === department)
    : [];
  const otherEvaluators = department
    ? eligibleEvaluators.filter((u: any) => u.department !== department)
    : eligibleEvaluators;

  useEffect(() => {
    if (!department) return;
    // Auto-select managers from the selected department
    const deptManagerIds = eligibleEvaluators
      .filter((u: any) => u.department === department)
      .map((u: any) => u.id);
    if (deptManagerIds.length > 0) {
      setEvaluatorIds((prev) => {
        const combined = Array.from(new Set([...prev, ...deptManagerIds]));
        return combined;
      });
    }
  }, [department]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !title || !position) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api.postulants.processes.create(token, {
        title, position,
        department: department || undefined,
        description: description || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        evaluatorIds: evaluatorIds.length ? evaluatorIds : undefined,
      });
      router.push(`/dashboard/postulantes/${result.id}`);
    } catch (err: any) {
      setError(err.message || 'Error al crear el proceso. Intenta nuevamente.');
      setSaving(false);
    }
  };

  const toggleEvaluator = (userId: string) => {
    setEvaluatorIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.78rem', fontWeight: 600,
    color: 'var(--text-secondary)', marginBottom: '0.4rem',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          Nuevo Proceso de Evaluación
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Define el cargo, evaluadores y criterios para el proceso
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '1rem' }}>Información del Proceso</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>Título del proceso *</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej: Analista de Datos - Q1 2026" required />
            </div>
            <div>
              <label style={labelStyle}>Cargo a evaluar *</label>
              <input className="input" value={position} onChange={(e) => setPosition(e.target.value)}
                placeholder="Ej: Analista de Datos" required />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={labelStyle}>Departamento</label>
              <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
                <option value="">— Seleccionar departamento —</option>
                {configuredDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={labelStyle}>Fecha inicio</label>
                <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label style={labelStyle}>Fecha fin</label>
                <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Descripción</label>
            <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Requisitos, contexto del cargo..." rows={3} style={{ resize: 'vertical' }} />
          </div>
        </div>

        {/* Evaluators */}
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Evaluadores</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
            {department
              ? `Los managers de "${department}" se asignan automáticamente. Puedes agregar evaluadores invitados de otras áreas.`
              : 'Selecciona quiénes evaluarán a los candidatos en este proceso'}
          </p>

          {/* Department evaluators (auto-suggested) */}
          {department && deptEvaluators.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                Evaluadores del departamento ({department})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {deptEvaluators.map((u: any) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleEvaluator(u.id)}
                    style={{
                      padding: '0.4rem 0.85rem',
                      fontSize: '0.82rem',
                      borderRadius: '20px',
                      border: evaluatorIds.includes(u.id) ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: evaluatorIds.includes(u.id) ? 'rgba(201,147,58,0.1)' : 'transparent',
                      color: evaluatorIds.includes(u.id) ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: evaluatorIds.includes(u.id) ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {u.firstName} {u.lastName}
                    {u.position ? ` (${u.position})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {department && deptEvaluators.length === 0 && (
            <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(245,158,11,0.08)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              No hay managers asignados al departamento "{department}". Selecciona evaluadores de otras áreas.
            </div>
          )}

          {/* Other area evaluators (invitados) */}
          {otherEvaluators.length > 0 && (
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
                {department ? 'Evaluadores invitados (otras áreas)' : 'Evaluadores disponibles'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {otherEvaluators.map((u: any) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleEvaluator(u.id)}
                    style={{
                      padding: '0.4rem 0.85rem',
                      fontSize: '0.82rem',
                      borderRadius: '20px',
                      border: evaluatorIds.includes(u.id) ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: evaluatorIds.includes(u.id) ? 'rgba(201,147,58,0.1)' : 'transparent',
                      color: evaluatorIds.includes(u.id) ? 'var(--accent)' : 'var(--text-secondary)',
                      fontWeight: evaluatorIds.includes(u.id) ? 600 : 400,
                      cursor: 'pointer',
                    }}
                  >
                    {u.firstName} {u.lastName}
                    {u.department ? ` (${u.department})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}

          {eligibleEvaluators.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No hay usuarios disponibles como evaluadores</p>
          )}

          {evaluatorIds.length > 0 && (
            <div style={{ marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {evaluatorIds.length} evaluador(es) seleccionado(s)
            </div>
          )}
        </div>

        {error && (
          <div style={{
            padding: '0.75rem 1rem', marginBottom: '1rem',
            background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button type="submit" className="btn-primary" disabled={saving || !title || !position}
            style={{ opacity: saving || !title || !position ? 0.5 : 1 }}>
            {saving ? 'Creando...' : 'Crear Proceso'}
          </button>
          <button type="button" onClick={() => router.back()}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
