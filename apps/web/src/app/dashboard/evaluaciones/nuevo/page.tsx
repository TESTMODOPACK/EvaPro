'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useCreateCycle } from '@/hooks/useCycles';
import { useTemplates, useTemplateWithSubTemplates } from '@/hooks/useTemplates';

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
  const { t } = useTranslation();
  const router = useRouter();
  const createCycle = useCreateCycle();
  const STEPS = [t('evaluaciones.nuevo.stepInfo'), t('evaluaciones.nuevo.stepConfig'), t('evaluaciones.nuevo.stepTemplate'), t('evaluaciones.nuevo.stepReview')];
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

  // Fase 3: pesos del ciclo (override de los defaults del template).
  // Se inicializa al seleccionar template; user los puede ajustar antes
  // de crear. Persisten en cycle.settings.weights.
  const [cycleWeights, setCycleWeights] = useState<Record<string, number>>({});
  const { data: templateWithSubs } = useTemplateWithSubTemplates(
    form.templateId || null,
  );

  // Inicializar pesos al cargar las subs del template seleccionado.
  useEffect(() => {
    if (templateWithSubs?.subTemplates && templateWithSubs.subTemplates.length > 0) {
      const initial: Record<string, number> = {};
      for (const sub of templateWithSubs.subTemplates) {
        initial[sub.relationType] = Number(sub.weight) || 0;
      }
      setCycleWeights(initial);
    }
  }, [templateWithSubs?.subTemplates]);

  const totalWeight = useMemo(
    () => Object.values(cycleWeights).reduce((sum, w) => sum + (Number(w) || 0), 0),
    [cycleWeights],
  );
  const weightsOK = Object.keys(cycleWeights).length === 0 || Math.abs(totalWeight - 1.0) < 0.001;

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const canNext = () => {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2) return form.startDate && form.endDate;
    if (step === 3) return form.templateId !== '';
    if (step === 4) return weightsOK;
    return true;
  };

  const handleCreate = async () => {
    if (!weightsOK) return;
    try {
      const settings: any = {};
      // Solo enviar weights si la plantilla tiene subplantillas
      if (Object.keys(cycleWeights).length > 0) {
        settings.weights = cycleWeights;
      }
      await createCycle.mutateAsync({
        name: form.name,
        description: form.description,
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        templateId: form.templateId,
        settings: Object.keys(settings).length > 0 ? settings : undefined,
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
          &larr; {t('evaluaciones.nuevo.backToEvals')}
        </button>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('evaluaciones.nuevo.title')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('evaluaciones.nuevo.subtitle')}
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
              {t('evaluaciones.nuevo.basicInfo')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              {t('evaluaciones.nuevo.basicInfoDesc')}
            </p>
            <div>
              <label style={labelStyle}>{t('evaluaciones.nuevo.cycleName')}</label>
              <input
                className="input"
                type="text"
                placeholder={t('evaluaciones.nuevo.cycleNamePlaceholder')}
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>{t('evaluaciones.nuevo.description')}</label>
              <textarea
                className="input"
                rows={4}
                placeholder={t('evaluaciones.nuevo.descriptionPlaceholder')}
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
              {t('evaluaciones.nuevo.cycleConfig')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              {t('evaluaciones.nuevo.cycleConfigDesc')}
            </p>
            <div>
              <label style={labelStyle}>{t('evaluaciones.nuevo.evalType')}</label>
              <select
                className="input"
                value={form.type}
                onChange={(e) => set('type', e.target.value)}
              >
                <option value="90">{t('evaluaciones.nuevo.type90Desc')}</option>
                <option value="180">{t('evaluaciones.nuevo.type180Desc')}</option>
                <option value="270">{t('evaluaciones.nuevo.type270Desc')}</option>
                <option value="360">{t('evaluaciones.nuevo.type360Desc')}</option>
              </select>
              {/* Type description guide */}
              <div style={{
                marginTop: '0.75rem',
                padding: '0.875rem 1rem',
                background: 'rgba(99,102,241,0.06)',
                borderRadius: 'var(--radius-sm, 0.5rem)',
                border: '1px solid rgba(99,102,241,0.15)',
                fontSize: '0.82rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.65,
              }}>
                {t(`evaluaciones.nuevo.type${form.type}Detail`)}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div>
                <label style={labelStyle}>{t('evaluaciones.nuevo.startDate')}</label>
                <input
                  className="input"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>{t('evaluaciones.nuevo.endDate')}</label>
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
              {t('evaluaciones.nuevo.selectTemplate')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              {t('evaluaciones.nuevo.selectTemplateDesc')}
            </p>
            {loadingTemplates ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                {t('evaluaciones.nuevo.loadingTemplates')}
              </p>
            ) : !Array.isArray(templates) || templates.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                {t('evaluaciones.nuevo.noTemplates')}
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
                      {(() => {
                        // Fase 3: priorizar subTemplatesSummary (preguntas
                        // viven en form_sub_templates). Fallback a
                        // tpl.sections legacy si no hay sub_templates.
                        const summary = (tpl as any).subTemplatesSummary;
                        const totalSections = summary && summary.totalSections > 0
                          ? summary.totalSections
                          : (Array.isArray(tpl.sections) ? tpl.sections.length : 0);
                        const totalQuestions = summary && summary.totalQuestions > 0
                          ? summary.totalQuestions
                          : (Array.isArray(tpl.sections)
                              ? tpl.sections.reduce(
                                  (acc: number, s: any) => acc + (s.questions?.length || 0),
                                  0,
                                )
                              : 0);
                        return (
                          <div
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                              marginTop: '0.35rem',
                            }}
                          >
                            {summary && summary.count > 0 && (
                              <span>
                                {summary.count} subplantillas · {' '}
                              </span>
                            )}
                            {totalSections} secciones &middot; {totalQuestions} preguntas
                          </div>
                        );
                      })()}
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
              {t('evaluaciones.nuevo.reviewTitle')}
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.5rem' }}>
              {t('evaluaciones.nuevo.reviewDesc')}
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
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('evaluaciones.nuevo.nameLabel')}</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{form.name}</span>
              </div>
              {form.description && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    {t('evaluaciones.nuevo.descLabel')}
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
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('evaluaciones.nuevo.typeLabel')}</span>
                <span className="badge badge-accent">{typeLabels[form.type]}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('evaluaciones.nuevo.periodLabel')}</span>
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
                <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t('evaluaciones.nuevo.templateLabel')}</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {selectedTemplate?.name || t('evaluaciones.nuevo.noTemplate')}
                </span>
              </div>
            </div>

            {/* Fase 3: pesos editables si la plantilla tiene subplantillas */}
            {Object.keys(cycleWeights).length > 0 && (
              <div
                style={{
                  background: 'var(--bg-surface)',
                  padding: '1.25rem',
                  borderRadius: 'var(--radius-sm, 0.5rem)',
                  border: '1px solid var(--border)',
                }}
              >
                <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                  ⚖ Peso de cada perspectiva en el score final
                </h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                  Los pesos default vienen de la plantilla. Puedes ajustarlos
                  para este ciclo específico — no afectan otros ciclos que
                  usen la misma plantilla.
                </p>
                {Object.entries(cycleWeights).map(([rel, weight]) => {
                  const labels: Record<string, { emoji: string; label: string }> = {
                    self: { emoji: '🧑', label: 'Auto-evaluación' },
                    manager: { emoji: '👔', label: 'Jefe directo' },
                    peer: { emoji: '👥', label: 'Pares' },
                    direct_report: { emoji: '👇', label: 'Reportes directos' },
                    external: { emoji: '🌐', label: 'Externo' },
                  };
                  const meta = labels[rel] || { emoji: '📋', label: rel };
                  return (
                    <div
                      key={rel}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <div style={{ width: '180px', fontSize: '0.85rem' }}>
                        {meta.emoji} {meta.label}
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={weight}
                        onChange={(e) =>
                          setCycleWeights((prev) => ({ ...prev, [rel]: parseFloat(e.target.value) }))
                        }
                        style={{ flex: 1, accentColor: 'var(--accent)' }}
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(weight * 100)}
                        onChange={(e) =>
                          setCycleWeights((prev) => ({
                            ...prev,
                            [rel]: parseInt(e.target.value || '0') / 100,
                          }))
                        }
                        style={{
                          padding: '0.4rem 0.6rem',
                          background: 'var(--bg-base)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--text-primary)',
                          fontSize: '0.85rem',
                          width: '70px',
                          textAlign: 'center',
                          fontWeight: 600,
                        }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>%</span>
                    </div>
                  );
                })}
                <div
                  style={{
                    marginTop: '0.75rem',
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    background: weightsOK ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    color: weightsOK ? 'var(--success)' : 'var(--danger)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  Total: {(totalWeight * 100).toFixed(1)}%{' '}
                  {weightsOK ? '✅' : '⚠️ Debe ser 100%'}
                </div>
              </div>
            )}

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
                {t('evaluaciones.nuevo.createError')}
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
              &larr; {t('evaluaciones.nuevo.previous')}
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
              {t('evaluaciones.nuevo.next')} &rarr;
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={createCycle.isPending}
              style={{ opacity: createCycle.isPending ? 0.6 : 1 }}
            >
              {createCycle.isPending ? t('evaluaciones.nuevo.creating') : t('evaluaciones.nuevo.createCycle')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
