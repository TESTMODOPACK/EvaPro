'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateCycle } from '@/hooks/useCycles';
import { useTemplates } from '@/hooks/useTemplates';

const STEPS = ['Información', 'Configuración', 'Plantilla', 'Revisión'];

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.4rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function NuevoCicloPage() {
  const router = useRouter();
  const createCycle = useCreateCycle();
  const { data: templates, isLoading: loadingTemplates } = useTemplates();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    description: '',
    type: '90',
    startDate: '',
    endDate: '',
    templateId: '',
  });

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canNext = () => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return form.startDate && form.endDate;
    if (step === 3) return form.templateId !== '';
    return true;
  };

  const handleCreate = async () => {
    try {
      await createCycle.mutateAsync({
        name: form.name,
        description: form.description,
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        templateId: form.templateId,
      });
      router.push('/dashboard/evaluaciones');
    } catch {
      // mutation error is accessible via createCycle.error
    }
  };

  const typeLabels: Record<string, string> = {
    '90': '90°',
    '180': '180°',
    '270': '270°',
    '360': '360°',
  };

  const selectedTemplate = Array.isArray(templates)
    ? templates.find((t: any) => t.id === form.templateId)
    : null;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '800px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <button
          className="btn-ghost"
          onClick={() => router.push('/dashboard/evaluaciones')}
          style={{ marginBottom: '0.75rem', fontSize: '0.82rem', padding: '0.3rem 0.65rem' }}
        >
          &larr; Volver a evaluaciones
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          Nuevo ciclo de evaluaci&oacute;n
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Configura un nuevo ciclo en 4 pasos
        </p>
      </div>

      {/* Step indicators */}
      <div
        className="animate-fade-up"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '2rem',
        }}
      >
        {STEPS.map((label, i) => {
          const num = i + 1;
          const isActive = num === step;
          const isDone = num < step;
          return (
            <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {i > 0 && (
                <div
                  style={{
                    width: '2rem',
                    height: '2px',
                    background: isDone ? 'var(--accent)' : 'var(--border)',
                    borderRadius: '1px',
                  }}
                />
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    background: isActive
                      ? 'var(--accent)'
                      : isDone
                        ? 'var(--success)'
                        : 'var(--bg-surface)',
                    color: isActive || isDone ? '#fff' : 'var(--text-muted)',
                    border: isActive
                      ? 'none'
                      : isDone
                        ? 'none'
                        : '1.5px solid var(--border)',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {isDone ? '\u2713' : num}
                </div>
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem' }}>
        {/* Step 1: Name + Description */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              Informaci&oacute;n b&aacute;sica
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              Define el nombre y descripci&oacute;n del ciclo de evaluaci&oacute;n
            </p>
            <div>
              <label style={labelStyle}>Nombre del ciclo *</label>
              <input
                className="input"
                type="text"
                placeholder="Ej. Evaluación Semestral Q1 2026"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>Descripci&oacute;n</label>
              <textarea
                className="input"
                rows={4}
                placeholder="Describe el propósito de este ciclo de evaluación..."
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                style={{ resize: 'vertical', minHeight: '100px' }}
              />
            </div>
          </div>
        )}

        {/* Step 2: Type + Dates */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              Configuraci&oacute;n del ciclo
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              Selecciona el tipo de evaluaci&oacute;n y el rango de fechas
            </p>
            <div>
              <label style={labelStyle}>Tipo de evaluaci&oacute;n</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => set('type', e.target.value)}
              >
                <option value="90">90&deg; &mdash; Jefatura directa</option>
                <option value="180">180&deg; &mdash; Jefatura + Autoevaluaci&oacute;n</option>
                <option value="270">270&deg; &mdash; Jefatura + Auto + Pares</option>
                <option value="360">360&deg; &mdash; Evaluaci&oacute;n completa</option>
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>Fecha de inicio *</label>
                <input
                  className="input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>Fecha de cierre *</label>
                <input
                  className="input"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set('endDate', e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Template selection */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              Seleccionar plantilla
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              Elige la plantilla de preguntas que se usar&aacute; en este ciclo
            </p>
            {loadingTemplates ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                Cargando plantillas...
              </p>
            ) : !Array.isArray(templates) || templates.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                No hay plantillas disponibles. Crea una plantilla primero.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {templates.map((tpl: any) => (
                  <label
                    key={tpl.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.875rem',
                      padding: '1rem 1.25rem',
                      background:
                        form.templateId === tpl.id
                          ? 'var(--bg-surface)'
                          : 'transparent',
                      border:
                        form.templateId === tpl.id
                          ? '1.5px solid var(--accent)'
                          : '1.5px solid var(--border)',
                      borderRadius: 'var(--radius-sm, 0.5rem)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="radio"
                      name="template"
                      checked={form.templateId === tpl.id}
                      onChange={() => set('templateId', tpl.id)}
                      style={{ marginTop: '0.2rem', accentColor: 'var(--accent)' }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                        {tpl.name}
                      </div>
                      {tpl.description && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {tpl.description}
                        </div>
                      )}
                      {tpl.sections && (
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-muted)',
                            marginTop: '0.35rem',
                          }}
                        >
                          {tpl.sections.length} secciones &middot;{' '}
                          {tpl.sections.reduce(
                            (acc: number, s: any) => acc + (s.questions?.length || 0),
                            0,
                          )}{' '}
                          preguntas
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              Revisi&oacute;n final
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              Confirma los datos antes de crear el ciclo
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.875rem',
                background: 'var(--bg-surface)',
                padding: '1.25rem',
                borderRadius: 'var(--radius-sm, 0.5rem)',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Nombre</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{form.name}</span>
              </div>
              {form.description && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Descripci&oacute;n
                  </span>
                  <span
                    style={{
                      fontSize: '0.875rem',
                      maxWidth: '60%',
                      textAlign: 'right',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {form.description}
                  </span>
                </div>
              )}
              <div
                style={{
                  height: '1px',
                  background: 'var(--border)',
                  margin: '0.25rem 0',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Tipo</span>
                <span className="badge badge-accent">{typeLabels[form.type]}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Per&iacute;odo</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {form.startDate} &mdash; {form.endDate}
                </span>
              </div>
              <div
                style={{
                  height: '1px',
                  background: 'var(--border)',
                  margin: '0.25rem 0',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Plantilla</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {selectedTemplate?.name || 'No seleccionada'}
                </span>
              </div>
            </div>

            {createCycle.isError && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid var(--danger)',
                  borderRadius: 'var(--radius-sm, 0.5rem)',
                  color: 'var(--danger)',
                  fontSize: '0.85rem',
                }}
              >
                Error al crear el ciclo. Int&eacute;ntalo de nuevo.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div
        className="animate-fade-up"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          {step > 1 && (
            <button
              className="btn-ghost"
              onClick={() => setStep((s) => s - 1)}
              style={{ fontSize: '0.875rem' }}
            >
              &larr; Anterior
            </button>
          )}
        </div>
        <div>
          {step < 4 ? (
            <button
              className="btn-primary"
              disabled={!canNext()}
              onClick={() => setStep((s) => s + 1)}
              style={{ opacity: canNext() ? 1 : 0.5 }}
            >
              Siguiente &rarr;
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={createCycle.isPending}
              style={{ opacity: createCycle.isPending ? 0.6 : 1 }}
            >
              {createCycle.isPending ? 'Creando...' : 'Crear ciclo de evaluación'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
