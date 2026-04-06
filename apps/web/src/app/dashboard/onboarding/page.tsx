'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';
import { formatRutInput } from '@/lib/rut';
import { api } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1 — Empresa
  orgName: string;
  orgRut: string;
  orgIndustry: string;
  orgSize: string;
  legalRepName: string;
  legalRepRut: string;
  // Step 2 — Equipo
  teamEmails: string;
  // Step 3 — Competencias
  selectedCompetencies: string[];
  customCompetency: string;
  // Step 4 — Plantilla
  templateName: string;
  templateReady: boolean;
  // Step 5 — Ciclo
  cycleName: string;
}

const DEFAULT_COMPETENCIES = [
  { key: 'liderazgo', label: 'Liderazgo', icon: '🎯' },
  { key: 'comunicacion', label: 'Comunicación efectiva', icon: '💬' },
  { key: 'trabajo_equipo', label: 'Trabajo en equipo', icon: '🤝' },
  { key: 'orientacion_resultados', label: 'Orientación a resultados', icon: '📈' },
  { key: 'innovacion', label: 'Innovación y creatividad', icon: '💡' },
  { key: 'adaptabilidad', label: 'Adaptabilidad al cambio', icon: '🔄' },
  { key: 'resolucion_problemas', label: 'Resolución de problemas', icon: '⚙️' },
  { key: 'enfoque_cliente', label: 'Enfoque en el cliente', icon: '🌟' },
  { key: 'desarrollo_personas', label: 'Desarrollo de personas', icon: '🌱' },
  { key: 'planificacion', label: 'Planificación y organización', icon: '📋' },
];

const INDUSTRY_OPTIONS = [
  'Tecnología', 'Retail / Comercio', 'Servicios financieros',
  'Salud', 'Educación', 'Manufactura', 'Consultoría',
  'Logística', 'Construcción', 'Otro',
];

const SIZE_OPTIONS = [
  { value: '1-15', label: '1–15 colaboradores' },
  { value: '16-50', label: '16–50 colaboradores' },
  { value: '51-100', label: '51–100 colaboradores' },
  { value: '101-200', label: '101–200 colaboradores' },
  { value: '200+', label: 'Más de 200 colaboradores' },
];

const TOTAL_STEPS = 5;

// ─── Step components ─────────────────────────────────────────────────────────

function StepEmpresa({ state, onChange }: { state: WizardState; onChange: (k: keyof WizardState, v: any) => void }) {
  const readonlyStyle: React.CSSProperties = {
    width: '100%', padding: '0.65rem 0.9rem', fontSize: '0.9rem',
    background: 'var(--bg-surface)', border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    boxSizing: 'border-box', cursor: 'not-allowed', opacity: 0.85,
  };
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.65rem 0.9rem', fontSize: '0.9rem',
    background: 'var(--bg-surface)', border: '1.5px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
    transition: 'border-color 0.15s ease', boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)',
    marginBottom: '0.35rem', display: 'block',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Info note */}
      <div style={{
        padding: '0.65rem 0.9rem', background: 'rgba(99,102,241,0.05)',
        border: '1px solid rgba(99,102,241,0.15)', borderRadius: 'var(--radius-sm)',
        fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6,
        display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Los datos de tu organización están cargados desde el registro. Puedes modificarlos en <strong>Configuración → Organización</strong>.
      </div>

      <div>
        <label style={labelStyle}>
          Nombre de la empresa
          <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>— desde el sistema</span>
        </label>
        <input
          style={readonlyStyle}
          value={state.orgName}
          readOnly
          tabIndex={-1}
        />
      </div>

      <div>
        <label style={labelStyle}>
          RUT de la empresa
          <span style={{ marginLeft: '0.5rem', fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>— desde el sistema</span>
        </label>
        <input
          style={readonlyStyle}
          value={state.orgRut || 'No registrado'}
          readOnly
          tabIndex={-1}
        />
      </div>

      <div>
        <label style={labelStyle}>
          Industria <span style={{ color: 'var(--danger)', marginLeft: '2px' }}>*</span>
        </label>
        <select
          style={{ ...inputStyle, borderColor: !state.orgIndustry ? 'rgba(239,68,68,0.4)' : 'var(--border)' }}
          value={state.orgIndustry}
          onChange={(e) => onChange('orgIndustry', e.target.value)}
        >
          <option value="">Seleccionar industria...</option>
          {INDUSTRY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      <div>
        <label style={labelStyle}>
          Tamaño del equipo <span style={{ color: 'var(--danger)', marginLeft: '2px' }}>*</span>
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          {SIZE_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange('orgSize', o.value)}
              style={{
                padding: '0.65rem 1rem', borderRadius: 'var(--radius-sm)',
                border: state.orgSize === o.value ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                background: state.orgSize === o.value ? 'rgba(201,147,58,0.08)' : 'var(--bg-surface)',
                color: state.orgSize === o.value ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: '0.82rem', fontWeight: state.orgSize === o.value ? 700 : 400,
                cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
        {!state.orgSize && (
          <p style={{ fontSize: '0.75rem', color: 'rgba(239,68,68,0.8)', marginTop: '0.4rem' }}>
            Selecciona el tamaño de tu equipo para continuar
          </p>
        )}
      </div>

      {/* Legal representative */}
      <div style={{ gridColumn: '1 / -1', marginTop: '0.5rem' }}>
        <h4 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Representante Legal</h4>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={labelStyle}>Nombres y Apellidos</label>
            <input className="input" type="text" placeholder="Ej: Juan Pérez González"
              value={state.legalRepName} onChange={(e) => onChange('legalRepName', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>RUT del Representante</label>
            <input className="input" type="text" placeholder="Ej: 12.345.678-9"
              value={state.legalRepRut} onChange={(e) => onChange('legalRepRut', formatRutInput(e.target.value))} maxLength={12} />
          </div>
        </div>
        <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Opcional — necesario para generar contratos legales.</p>
      </div>

      {(!state.orgIndustry || !state.orgSize) && (
        <div style={{
          padding: '0.6rem 0.9rem', background: 'rgba(239,68,68,0.05)',
          border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius-sm)',
          fontSize: '0.78rem', color: 'var(--danger)',
        }}>
          Completa los campos obligatorios (<strong>*</strong>) para continuar.
        </div>
      )}
    </div>
  );
}

function StepEquipo({ state, onChange }: { state: WizardState; onChange: (k: keyof WizardState, v: any) => void }) {
  const emails = state.teamEmails.split('\n').filter(Boolean);
  const validEmails = emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
        Ingresa los correos de los colaboradores que quieres agregar a la plataforma, uno por línea. Puedes hacerlo ahora o más tarde desde el módulo de Usuarios.
      </p>
      <div>
        <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', display: 'block' }}>
          Correos de colaboradores
        </label>
        <textarea
          rows={8}
          placeholder={'juan.perez@empresa.cl\nmaria.gonzalez@empresa.cl\ncarlos.silva@empresa.cl'}
          value={state.teamEmails}
          onChange={(e) => onChange('teamEmails', e.target.value)}
          style={{
            width: '100%', padding: '0.65rem 0.9rem', fontSize: '0.875rem',
            background: 'var(--bg-surface)', border: '1.5px solid var(--border)',
            borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
            resize: 'vertical', fontFamily: 'monospace', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          <span>{emails.length} correo{emails.length !== 1 ? 's' : ''} ingresado{emails.length !== 1 ? 's' : ''}</span>
          {emails.length > 0 && <span style={{ color: validEmails.length === emails.length ? 'var(--success)' : 'var(--danger)' }}>
            {validEmails.length} válido{validEmails.length !== 1 ? 's' : ''}
          </span>}
        </div>
      </div>
      <div style={{
        padding: '0.875rem 1rem', background: 'rgba(201,147,58,0.06)',
        border: '1px solid rgba(201,147,58,0.2)', borderRadius: 'var(--radius-sm)',
        fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        💡 Los colaboradores recibirán una invitación por correo cuando actives la plataforma. Podrás agregar más usuarios en cualquier momento.
      </div>
    </div>
  );
}

function StepCompetencias({ state, onChange }: { state: WizardState; onChange: (k: keyof WizardState, v: any) => void }) {
  const toggle = (key: string) => {
    const current = state.selectedCompetencies;
    onChange('selectedCompetencies', current.includes(key) ? current.filter((k) => k !== key) : [...current, key]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
        Selecciona las competencias que quieres evaluar en tu organización. Puedes elegir las que se aplican a tu cultura y agregar otras personalizadas.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        {DEFAULT_COMPETENCIES.map((c) => {
          const selected = state.selectedCompetencies.includes(c.key);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.65rem 0.9rem', borderRadius: 'var(--radius-sm)',
                border: selected ? '2px solid var(--accent)' : '1.5px solid var(--border)',
                background: selected ? 'rgba(201,147,58,0.08)' : 'var(--bg-surface)',
                color: selected ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: '0.82rem', fontWeight: selected ? 700 : 400,
                cursor: 'pointer', transition: 'all 0.15s ease', textAlign: 'left',
              }}
            >
              <span style={{ fontSize: '1rem' }}>{c.icon}</span>
              <span>{c.label}</span>
              {selected && (
                <svg style={{ marginLeft: 'auto' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        {state.selectedCompetencies.length} competencia{state.selectedCompetencies.length !== 1 ? 's' : ''} seleccionada{state.selectedCompetencies.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function StepPlantilla({ state, onChange }: { state: WizardState; onChange: (k: keyof WizardState, v: any) => void }) {
  const templates = [
    { key: 'basica', label: 'Evaluación básica', desc: '10 preguntas de escala 1-5. Ideal para equipos que inician con evaluaciones estructuradas.', questions: 10, time: '10 min' },
    { key: 'completa', label: 'Evaluación 360° completa', desc: '25 preguntas con escala y texto abierto. Cubre competencias técnicas y blandas.', questions: 25, time: '20 min' },
    { key: 'liderazgo', label: 'Evaluación de liderazgo', desc: '15 preguntas enfocadas en habilidades de gestión y desarrollo de equipos.', questions: 15, time: '15 min' },
    { key: 'custom', label: 'Crear desde cero', desc: 'Construye tu propio formulario con las secciones y preguntas que necesitas.', questions: 0, time: '' },
  ];
  const [selected, setSelected] = useState('basica');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
        Elige una plantilla base para tu primera evaluación. Podrás personalizarla más adelante.
      </p>
      {templates.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => { setSelected(t.key); onChange('templateName', t.label); onChange('templateReady', true); }}
          style={{
            display: 'flex', gap: '1rem', padding: '1rem 1.25rem',
            borderRadius: 'var(--radius-sm)', textAlign: 'left', width: '100%',
            border: selected === t.key ? '2px solid var(--accent)' : '1.5px solid var(--border)',
            background: selected === t.key ? 'rgba(201,147,58,0.06)' : 'var(--bg-surface)',
            cursor: 'pointer', transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
            background: selected === t.key ? 'rgba(201,147,58,0.12)' : 'rgba(99,102,241,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke={selected === t.key ? 'var(--accent)' : '#6366f1'} strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>
              {t.label}
              {selected === t.key && (
                <svg style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{t.desc}</div>
            {t.questions > 0 && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.4rem' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>📝 {t.questions} preguntas</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>⏱ {t.time}</span>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

function StepListo({ state }: { state: WizardState }) {
  const completedSteps = [
    state.orgName && { icon: '🏢', label: `Empresa configurada: ${state.orgName}` },
    state.teamEmails.trim() && { icon: '👥', label: `${state.teamEmails.split('\n').filter(Boolean).length} colaboradores listos para invitar` },
    state.selectedCompetencies.length > 0 && { icon: '⭐', label: `${state.selectedCompetencies.length} competencias definidas` },
    state.templateReady && { icon: '📋', label: `Plantilla "${state.templateName}" seleccionada` },
  ].filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '1rem 0' }}>
      <div style={{
        width: '72px', height: '72px', borderRadius: '50%',
        background: 'linear-gradient(135deg, rgba(201,147,58,0.2), rgba(201,147,58,0.05))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '2rem',
      }}>
        🎉
      </div>
      <div style={{ textAlign: 'center' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '0.4rem' }}>¡Todo listo para comenzar!</h3>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          Tu plataforma está configurada. El siguiente paso es crear tu primer ciclo de evaluación.
        </p>
      </div>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {completedSteps.map((s: any, i: number) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: '0.75rem',
            padding: '0.75rem 1rem', background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
          }}>
            <span style={{ fontSize: '1.1rem' }}>{s.icon}</span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>{s.label}</span>
            <svg style={{ marginLeft: 'auto' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="3">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Progress indicator ───────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center', marginBottom: '2rem' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            height: '4px',
            borderRadius: '999px',
            transition: 'all 0.3s ease',
            width: i === current ? '24px' : '8px',
            background: i <= current ? 'var(--accent)' : 'var(--border)',
          }}
        />
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'evapro_onboarding_done';

export default function OnboardingPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [loadingTenant, setLoadingTenant] = useState(true);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantSettings, setTenantSettings] = useState<Record<string, any>>({});
  const [state, setState] = useState<WizardState>({
    orgName: '', orgRut: '', orgIndustry: '', orgSize: '', legalRepName: '', legalRepRut: '',
    teamEmails: '',
    selectedCompetencies: ['trabajo_equipo', 'comunicacion', 'orientacion_resultados'],
    customCompetency: '',
    templateName: 'Evaluación básica', templateReady: true,
    cycleName: '',
  });

  // Load tenant data to pre-populate Step 1
  useEffect(() => {
    if (!token) return;
    api.tenants.me(token)
      .then((tenant: any) => {
        setTenantId(tenant.id || null);
        setTenantSettings(tenant.settings || {});
        setState((prev) => ({
          ...prev,
          orgName: tenant.name || prev.orgName,
          orgRut: tenant.rut || prev.orgRut,
          // industry/size from settings if previously saved
          orgIndustry: tenant.settings?.industry || prev.orgIndustry,
          orgSize: tenant.settings?.size || prev.orgSize,
        }));
      })
      .catch(() => { /* silently ignore — form stays empty */ })
      .finally(() => setLoadingTenant(false));
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (key: keyof WizardState, value: any) => {
    setState((prev) => ({ ...prev, [key]: value }));
  };

  const steps = [
    { title: 'Tu empresa', subtitle: 'Cuéntanos sobre tu organización', component: <StepEmpresa state={state} onChange={onChange} /> },
    { title: 'Tu equipo', subtitle: 'Agrega colaboradores — opcional, puedes hacerlo después', component: <StepEquipo state={state} onChange={onChange} /> },
    { title: 'Competencias', subtitle: 'Define qué evaluar', component: <StepCompetencias state={state} onChange={onChange} /> },
    { title: 'Plantilla', subtitle: 'Elige tu primera plantilla', component: <StepPlantilla state={state} onChange={onChange} /> },
    { title: '¡Listo!', subtitle: 'Tu plataforma está configurada', component: <StepListo state={state} /> },
  ];

  const canNext = () => {
    if (loadingTenant) return false;
    // Step 1 requires industry and team size
    if (step === 0) return !!state.orgIndustry && !!state.orgSize;
    return true;
  };

  const handleFinish = async () => {
    if (!token) {
      setFinishError('No hay sesión activa. Recarga la página e intenta nuevamente.');
      return;
    }
    setSaving(true);
    setFinishError(null);

    // ── Step 1: Save org settings (industry, size, competencies) to tenant ──
    if (tenantId) {
      try {
        const mergedSettings = {
          ...tenantSettings,
          onboardingDone: true,
          ...(state.orgIndustry ? { industry: state.orgIndustry } : {}),
          ...(state.orgSize ? { size: state.orgSize } : {}),
          ...(state.selectedCompetencies.length > 0 ? { initialCompetencies: state.selectedCompetencies } : {}),
        };
        await api.tenants.update(token, tenantId, { settings: mergedSettings });
        // Save legal rep data via updateSettings (stored on tenant columns, not settings)
        if (state.legalRepName || state.legalRepRut) {
          await api.tenants.updateSettings(token, {
            legalRepName: state.legalRepName || null,
            legalRepRut: state.legalRepRut || null,
          });
        }
      } catch {
        // Non-critical: settings save failure should not block cycle creation
      }
    }

    // ── Step 1b: Create Competency entity records for each selected competency ──
    // This ensures the Competencias module is pre-populated after onboarding.
    if (state.selectedCompetencies.length > 0) {
      const competencyMap: Record<string, { label: string; category: string }> = {
        liderazgo:             { label: 'Liderazgo',                   category: 'Habilidades directivas' },
        comunicacion:          { label: 'Comunicación efectiva',       category: 'Habilidades interpersonales' },
        trabajo_equipo:        { label: 'Trabajo en equipo',           category: 'Habilidades interpersonales' },
        orientacion_resultados:{ label: 'Orientación a resultados',    category: 'Desempeño' },
        innovacion:            { label: 'Innovación y creatividad',    category: 'Desempeño' },
        adaptabilidad:         { label: 'Adaptabilidad al cambio',     category: 'Habilidades personales' },
        resolucion_problemas:  { label: 'Resolución de problemas',     category: 'Habilidades personales' },
        enfoque_cliente:       { label: 'Enfoque en el cliente',       category: 'Desempeño' },
        desarrollo_personas:   { label: 'Desarrollo de personas',      category: 'Habilidades directivas' },
        planificacion:         { label: 'Planificación y organización', category: 'Habilidades personales' },
      };
      // Fire-and-forget: failures are non-critical (competencies can be created manually)
      await Promise.allSettled(
        state.selectedCompetencies.map((key) => {
          const meta = competencyMap[key];
          if (!meta) return Promise.resolve();
          return api.development.competencies.create(token, {
            name: meta.label,
            category: meta.category,
            description: `Competencia definida durante la configuración inicial de la empresa.`,
          });
        }),
      );
    }

    // ── Step 2: Create the initial evaluation cycle ──
    try {
      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 90);
      const fmt = (d: Date) => d.toISOString().split('T')[0];

      const orgSuffix = state.orgName ? ` — ${state.orgName}` : '';
      const result = await api.cycles.create(token, {
        name: `Evaluación Inicial ${today.getFullYear()}${orgSuffix}`,
        description: 'Ciclo inicial creado desde la configuración de la plataforma.',
        type: '90',
        period: 'annual',
        startDate: fmt(today),
        endDate: fmt(endDate),
      });

      localStorage.setItem(STORAGE_KEY, '1');
      router.push(`/dashboard/evaluaciones/${result.id}`);
    } catch (err: any) {
      setFinishError(err.message || 'Error al crear el ciclo de evaluación. Intenta nuevamente.');
      setSaving(false);
    }
  };

  const currentStep = steps[step];

  if (loadingTenant && step === 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
        <span className="spinner" />
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '2rem', background: 'var(--bg-base)',
    }}>
      <div style={{ width: '100%', maxWidth: '540px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            marginBottom: '0.5rem',
          }}>
            <div style={{
              width: '36px', height: '36px', borderRadius: '10px',
              background: 'rgba(201,147,58,0.15)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 40 40" fill="none">
                <path d="M20 8L32 14V26L20 32L8 26V14L20 8Z" stroke="#C9933A" strokeWidth="2.5" fill="none"/>
                <circle cx="20" cy="20" r="3.5" fill="#C9933A"/>
              </svg>
            </div>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Eva<span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>360</span>
            </span>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Configuración inicial · Paso {step + 1} de {TOTAL_STEPS}
          </p>
        </div>

        {/* Card */}
        <div className="card animate-fade-up" style={{ padding: '2rem' }}>
          <StepDots current={step} total={TOTAL_STEPS} />

          <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '0.3rem', textAlign: 'center' }}>
            {currentStep.title}
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '1.75rem' }}>
            {currentStep.subtitle}
          </p>

          {currentStep.component}

          {/* Error banner */}
          {finishError && (
            <div style={{
              marginTop: '1.25rem', padding: '0.75rem 1rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: '0.83rem',
            }}>
              {finishError}
            </div>
          )}

          {/* Navigation */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '2rem', justifyContent: 'space-between' }}>
            {step > 0 ? (
              <button className="btn-ghost" onClick={() => setStep(step - 1)} style={{ flex: '0 0 auto' }}>
                ← Atrás
              </button>
            ) : (
              <button
                className="btn-ghost"
                onClick={() => { localStorage.setItem(STORAGE_KEY, '1'); router.push('/dashboard'); }}
                style={{ flex: '0 0 auto', fontSize: '0.82rem' }}
              >
                Omitir por ahora
              </button>
            )}

            {step < TOTAL_STEPS - 1 ? (
              <button
                className="btn-primary"
                style={{ flex: 1, opacity: canNext() ? 1 : 0.5 }}
                disabled={!canNext()}
                onClick={() => setStep(step + 1)}
              >
                {step === TOTAL_STEPS - 2 ? '¡Finalizar configuración!' : 'Continuar →'}
              </button>
            ) : (
              <button
                className="btn-primary"
                style={{ flex: 1, background: 'linear-gradient(135deg, #C9933A, #E8C97A)' }}
                onClick={handleFinish}
                disabled={saving}
              >
                {saving ? 'Guardando...' : 'Crear mi primer ciclo →'}
              </button>
            )}
          </div>
        </div>

        {/* Skip link */}
        {step < TOTAL_STEPS - 1 && (
          <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Puedes completar esta configuración más tarde desde Ajustes.
          </p>
        )}
      </div>
    </div>
  );
}
