'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { CUSTOM_SETTINGS_DEFAULTS, CUSTOM_SETTINGS_META, CUSTOM_SETTINGS_KEYS } from '@/lib/constants';
import { DepartmentData, PositionData } from '@/lib/api';
import { useInvalidateDepartments } from '@/hooks/useDepartments';
import { useInvalidatePositions } from '@/hooks/usePositions';

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.78rem',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: '0.4rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

export default function MantenedoresPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const invalidateDepts = useInvalidateDepartments();
  const invalidatePos = useInvalidatePositions();

  const [customSettings, setCustomSettings] = useState<Record<string, string[]>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [newItemText, setNewItemText] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [settingSaved, setSettingSaved] = useState<string | null>(null);
  const [settingError, setSettingError] = useState<string | null>(null);
  const [settingErrorMsg, setSettingErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [normalizing, setNormalizing] = useState(false);
  const [normalizeResult, setNormalizeResult] = useState<{ mismatches: any[]; fixed: number } | null>(null);

  // Departments table CRUD
  const [deptRecords, setDeptRecords] = useState<DepartmentData[]>([]);
  const [deptExpanded, setDeptExpanded] = useState(false);
  const [deptNewName, setDeptNewName] = useState('');
  const [deptSaving, setDeptSaving] = useState(false);
  const [deptSaved, setDeptSaved] = useState(false);
  const [deptError, setDeptError] = useState<string | null>(null);

  // Positions catalog (structured, separate from string[] settings)
  const [positions, setPositions] = useState<{ name: string; level: number }[]>([]);
  const [posExpanded, setPosExpanded] = useState(false);
  const [posNewName, setPosNewName] = useState('');
  const [posNewLevel, setPosNewLevel] = useState(1);
  const [posSaving, setPosSaving] = useState(false);
  const [posSaved, setPosSaved] = useState(false);
  const [posError, setPosError] = useState<string | null>(null);
  const [posGuideOpen, setPosGuideOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      api.tenants.getAllCustomSettings(token).catch(() => ({})),
      api.tenants.getPositionsCatalog(token).catch(() => []),
      api.tenants.getDepartmentsTable(token).catch(() => []),
    ]).then(([settings, pos, depts]) => {
      setCustomSettings(settings);
      setPositions(pos);
      setDeptRecords(Array.isArray(depts) ? depts.filter((d: any) => d.isActive) : []);
    }).finally(() => setLoading(false));
  }, [token]);

  const handleSaveSetting = async (key: string) => {
    if (!token) return;
    const items = customSettings[key];
    if (!items || items.length === 0) {
      setSettingError(key);
      setTimeout(() => setSettingError(null), 3000);
      return;
    }
    setSavingKey(key);
    setSettingError(null);
    try {
      await api.tenants.updateCustomSetting(token, key, items);
      setSettingSaved(key);
      setTimeout(() => setSettingSaved(null), 3000);
    } catch (err: any) {
      setSettingError(key);
      setSettingErrorMsg(err.message || 'Error al guardar');
      setTimeout(() => { setSettingError(null); setSettingErrorMsg(null); }, 6000);
    }
    setSavingKey(null);
  };

  const handleAddItem = (key: string) => {
    const text = newItemText.trim();
    if (!text || customSettings[key]?.includes(text)) return;
    setCustomSettings((prev) => ({
      ...prev,
      [key]: [...(prev[key] || []), text],
    }));
    setNewItemText('');
  };

  const [removeError, setRemoveError] = useState<string | null>(null);
  const [checkingRemove, setCheckingRemove] = useState(false);

  const handleRemoveItem = async (key: string, index: number) => {
    const value = customSettings[key]?.[index];
    if (!value || !token) return;

    // For departments: check if any user has this department before allowing delete
    setRemoveError(null);
    setCheckingRemove(true);
    try {
      const usage = await api.tenants.checkSettingUsage(token, key, value);
      if (usage.inUse) {
        const msg = key === 'departments'
          ? `No se puede eliminar "${value}" porque tiene ${usage.entity} asignado(s). Solo puede actualizar su nombre editando el campo directamente.`
          : usage.message;
        setRemoveError(msg);
        setCheckingRemove(false);
        setTimeout(() => setRemoveError(null), 8000);
        return;
      }
    } catch {
      // If check fails, allow removal (fail-open for non-critical settings)
    }
    setCheckingRemove(false);

    setCustomSettings((prev) => ({
      ...prev,
      [key]: prev[key].filter((_, i) => i !== index),
    }));
  };

  const handleNormalizeDepts = async (apply: boolean) => {
    if (!token) return;
    setNormalizing(true);
    try {
      const res = await api.users.normalizeDepartments(token, apply);
      setNormalizeResult(res);
    } catch {
      setNormalizeResult(null);
    }
    setNormalizing(false);
  };

  const handleRestoreDefaults = (key: string) => {
    setCustomSettings((prev) => ({
      ...prev,
      [key]: [...CUSTOM_SETTINGS_DEFAULTS[key]],
    }));
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('mantenedores.loading')}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
          {t('mantenedores.title')}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          {t('mantenedores.subtitle')}
        </p>
      </div>

      {/* ─── Departments Table CRUD ─── */}
      <div className="card animate-fade-up" style={{ overflow: 'hidden', padding: 0, marginBottom: '1rem' }}>
        <button type="button" onClick={() => setDeptExpanded(!deptExpanded)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: deptExpanded ? 'var(--bg-secondary)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>Departamentos</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.75rem' }}>{deptRecords.length} departamentos</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: deptExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</span>
        </button>
        {deptExpanded && (
          <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border)' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
              Departamentos de la organización. Cada departamento tiene un ID único para mantener integridad referencial.
            </p>
            {/* Department list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
              {deptRecords.map((d) => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '0.88rem' }}>
                  <input className="input" value={d.name}
                    onChange={(e) => setDeptRecords(prev => prev.map(dept => dept.id === d.id ? { ...dept, name: e.target.value } : dept))}
                    onBlur={async () => {
                      if (!token || !d.name.trim() || !d.id) return;
                      try {
                        await api.tenants.updateDepartmentRecord(token, d.id, { name: d.name.trim() });
                        setDeptSaved(true); setTimeout(() => setDeptSaved(false), 2000);
                        invalidateDepts();
                      } catch (e: any) { setDeptError(e.message || 'Error'); setTimeout(() => setDeptError(null), 4000); }
                    }}
                    style={{ flex: 1, fontSize: '0.85rem', padding: '0.3rem 0.6rem' }} />
                  <button type="button" onClick={async () => {
                    if (!token || !d.id) return;
                    setDeptError(null);
                    try {
                      await api.tenants.deleteDepartmentRecord(token, d.id);
                      setDeptRecords(prev => prev.filter(dept => dept.id !== d.id));
                      invalidateDepts();
                    } catch (e: any) {
                      setDeptError(e.message || 'No se puede eliminar');
                      setTimeout(() => setDeptError(null), 6000);
                    }
                  }} title="Eliminar" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.1rem', padding: '0 0.3rem', lineHeight: 1, flexShrink: 0 }}>&times;</button>
                </div>
              ))}
              {deptRecords.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>Sin departamentos configurados</p>}
            </div>
            {deptError && <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.5rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontSize: '0.82rem', color: 'var(--danger)' }}>{deptError}</div>}
            {/* Add new department */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <input className="input" type="text" value={deptNewName} onChange={(e) => setDeptNewName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && deptNewName.trim() && token) {
                    e.preventDefault();
                    setDeptSaving(true); setDeptError(null);
                    try {
                      const created = await api.tenants.createDepartmentRecord(token, { name: deptNewName.trim() });
                      setDeptRecords(prev => [...prev, created]);
                      setDeptNewName('');
                      invalidateDepts();
                    } catch (err: any) { setDeptError(err.message || 'Error'); setTimeout(() => setDeptError(null), 4000); }
                    setDeptSaving(false);
                  }
                }}
                placeholder="Nombre del departamento" style={{ flex: 1, fontSize: '0.88rem' }} />
              <button type="button" className="btn-primary" disabled={!deptNewName.trim() || deptSaving}
                onClick={async () => {
                  if (!token || !deptNewName.trim()) return;
                  setDeptSaving(true); setDeptError(null);
                  try {
                    const created = await api.tenants.createDepartmentRecord(token, { name: deptNewName.trim() });
                    setDeptRecords(prev => [...prev, created]);
                    setDeptNewName('');
                    invalidateDepts();
                  } catch (err: any) { setDeptError(err.message || 'Error'); setTimeout(() => setDeptError(null), 4000); }
                  setDeptSaving(false);
                }}
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', opacity: !deptNewName.trim() ? 0.5 : 1 }}>
                {deptSaving ? 'Creando...' : 'Agregar'}
              </button>
            </div>
            {deptSaved && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>&#10003; Guardado</span>}

            {/* Normalize departments tool */}
            <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => handleNormalizeDepts(false)} disabled={normalizing}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: normalizing ? 'wait' : 'pointer', opacity: normalizing ? 0.6 : 1 }}>
                  {normalizing ? 'Analizando...' : 'Verificar departamentos de colaboradores'}
                </button>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Detecta colaboradores con departamentos que no coinciden con la lista configurada
                </span>
              </div>
              {normalizeResult && (
                <div style={{ marginTop: '0.75rem' }}>
                  {normalizeResult.mismatches.length === 0 ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: 600 }}>Todos los departamentos coinciden.</p>
                  ) : (
                    <>
                      <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                        <strong>{normalizeResult.mismatches.length}</strong> colaborador(es) con departamento diferente:
                        {normalizeResult.fixed > 0 && <span style={{ color: 'var(--success)', marginLeft: '0.5rem' }}>({normalizeResult.fixed} corregidos)</span>}
                      </p>
                      <div style={{ maxHeight: '200px', overflowY: 'auto', background: 'var(--bg-secondary)', borderRadius: '6px', padding: '0.5rem 0.75rem', fontSize: '0.82rem' }}>
                        {normalizeResult.mismatches.map((m: any, i: number) => (
                          <div key={i} style={{ padding: '0.25rem 0', borderBottom: i < normalizeResult.mismatches.length - 1 ? '1px solid var(--border)' : 'none' }}>
                            <strong>{m.name}</strong>: &quot;{m.current}&quot;
                            {m.suggested ? <span style={{ color: 'var(--primary)' }}> → {m.suggested}</span> : <span style={{ color: 'var(--danger)' }}> (sin coincidencia)</span>}
                          </div>
                        ))}
                      </div>
                      {normalizeResult.fixed === 0 && normalizeResult.mismatches.some((m: any) => m.suggested) && (
                        <button type="button" className="btn-primary" onClick={() => handleNormalizeDepts(true)} disabled={normalizing}
                          style={{ marginTop: '0.75rem', fontSize: '0.85rem', padding: '0.45rem 1.2rem' }}>
                          Corregir departamentos sugeridos
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Positions Catalog ─── */}
      <div className="card animate-fade-up" style={{ overflow: 'hidden', padding: 0, marginBottom: '1rem' }}>
        <button type="button" onClick={() => setPosExpanded(!posExpanded)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', background: posExpanded ? 'var(--bg-secondary)' : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>Cargos y Niveles Jerárquicos</span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.75rem' }}>{positions.length} cargos</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: posExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>&#9660;</span>
        </button>
        {posExpanded && (
          <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border)' }}>
            {/* Guide toggle */}
            <div style={{ marginBottom: '1rem' }}>
              <button type="button" onClick={() => setPosGuideOpen(!posGuideOpen)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 600, padding: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ transition: 'transform 0.2s', transform: posGuideOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block', fontSize: '0.7rem' }}>&#9654;</span>
                Guía: Cargos y Niveles Jerárquicos
              </button>
            </div>

            {posGuideOpen && (
              <div className="animate-fade-up" style={{ borderLeft: '4px solid var(--accent)', padding: '1.25rem', marginBottom: '1.25rem', background: 'var(--bg-surface)', borderRadius: '0 var(--radius-sm) var(--radius-sm) 0' }}>
                <h4 style={{ fontSize: '0.95rem', fontWeight: 800, marginBottom: '1rem', color: 'var(--accent)' }}>
                  Guía: Cargos y Niveles Jerárquicos
                </h4>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Qué es el catálogo de cargos?</p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 }}>
                    Es la lista de posiciones que existen en su organización, cada una con un nivel jerárquico numérico. El nivel 1 es el más alto (ej: Gerente General) y los niveles mayores representan posiciones subordinadas.
                  </p>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Para qué se utiliza?</p>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    <li><strong>Sugerencia de pares:</strong> En evaluaciones 270° y 360°, el sistema sugiere automáticamente evaluadores del mismo nivel jerárquico como pares potenciales.</li>
                    <li><strong>Organigrama:</strong> El nivel se muestra en la vista de organigrama para facilitar la comprensión de la estructura.</li>
                    <li><strong>Estandarización:</strong> Al crear o editar un usuario, el cargo se selecciona del catálogo en vez de escribirlo libremente, asegurando consistencia.</li>
                  </ul>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Cómo funcionan los niveles?</p>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    <li><strong>Nivel 1:</strong> Máxima autoridad (Gerente General, CEO, Director General)</li>
                    <li><strong>Nivel 2-3:</strong> Alta dirección (Gerentes de Área, Subgerentes)</li>
                    <li><strong>Nivel 4-5:</strong> Mandos medios (Jefes de Área, Coordinadores)</li>
                    <li><strong>Nivel 6-7:</strong> Colaboradores (Analistas, Asistentes)</li>
                    <li>Puede agregar más niveles según la complejidad de su organización</li>
                  </ul>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>¿Cómo se relaciona con las evaluaciones?</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {[
                      { type: '90°', desc: 'Solo jefe directo evalúa al colaborador. La jerarquía se define por el campo "Jefatura directa" del usuario.' },
                      { type: '180°', desc: 'Jefe directo + autoevaluación. El nivel jerárquico no interviene.' },
                      { type: '270°', desc: 'Jefe + auto + pares. El sistema sugiere pares del mismo nivel jerárquico para agilizar la selección.' },
                      { type: '360°', desc: 'Jefe + auto + pares + reportes directos. Los subordinados directos evalúan hacia arriba (solo 1 nivel, no saltando niveles).' },
                    ].map((e) => (
                      <div key={e.type} style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '0.8rem' }}>
                        <strong style={{ color: 'var(--accent)' }}>{e.type}:</strong>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>{e.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.35rem' }}>Ejemplo práctico</p>
                  <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    <p style={{ margin: '0 0 0.5rem' }}>Organización con: <strong>Gerente(Nv.2)</strong> → 3 <strong>Subgerentes(Nv.3)</strong> → <strong>Jefes de Área(Nv.4)</strong> → 5 <strong>Colaboradores(Nv.6)</strong> cada uno.</p>
                    <p style={{ margin: '0 0 0.3rem' }}>En una evaluación <strong>360°</strong>:</p>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                      <li>Cada Colaborador es evaluado por: su Jefe de Área + sí mismo + pares sugeridos del Nv.6 + nadie desde abajo (no tiene reportes)</li>
                      <li>Cada Jefe de Área es evaluado por: su Subgerente + sí mismo + pares sugeridos del Nv.4 + sus 5 Colaboradores directos</li>
                      <li>Cada Subgerente es evaluado por: el Gerente + sí mismo + otros Subgerentes (Nv.3) como pares + sus Jefes de Área directos</li>
                    </ul>
                  </div>
                </div>

                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  <strong style={{ color: 'var(--accent)' }}>Importante:</strong> La jefatura directa (quién reporta a quién) se define en el campo &quot;Jefatura directa&quot; al crear/editar un usuario, no por el nivel del cargo. El nivel jerárquico es informativo y se usa para sugerir pares automáticamente.
                </div>
              </div>
            )}
            {/* Positions list */}
            {positions.length > 0 && (
              <div style={{ display: 'flex', gap: '0.5rem', padding: '0 0.6rem 0.25rem', fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span style={{ width: '48px', textAlign: 'center' }}>Nivel</span>
                <span style={{ flex: 1 }}>Nombre del cargo</span>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
              {positions.map((p, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--bg-secondary)', borderRadius: '6px', fontSize: '0.88rem' }}>
                  <input className="input" type="number" min={1} max={20} value={p.level}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                      setPositions(prev => prev.map((pos, i) => i === idx ? { ...pos, level: val } : pos));
                    }}
                    style={{ width: '48px', textAlign: 'center', fontSize: '0.82rem', padding: '0.3rem', fontWeight: 700 }} />
                  <input className="input" value={p.name}
                    onChange={(e) => setPositions(prev => prev.map((pos, i) => i === idx ? { ...pos, name: e.target.value } : pos))}
                    style={{ flex: 1, fontSize: '0.85rem', padding: '0.3rem 0.6rem' }} />
                  <button type="button" onClick={async () => {
                    if (!token) return;
                    const usage = await api.tenants.checkPositionUsage(token, p.name).catch(() => ({ inUse: false, count: 0 }));
                    if (usage.inUse) { setPosError(`"${p.name}" está en uso por ${usage.count} usuario(s)`); setTimeout(() => setPosError(null), 4000); return; }
                    const updated = positions.filter((_, i) => i !== idx);
                    setPositions(updated);
                  }} title="Eliminar" style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1.1rem', padding: '0 0.3rem', lineHeight: 1, flexShrink: 0 }}>&times;</button>
                </div>
              ))}
              {positions.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>Sin cargos configurados</p>}
            </div>
            {posError && <div style={{ padding: '0.5rem 0.75rem', marginBottom: '0.5rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', fontSize: '0.82rem', color: 'var(--danger)' }}>{posError}</div>}
            {/* Add new position */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              <input className="input" type="text" value={posNewName} onChange={(e) => setPosNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (posNewName.trim()) { setPositions(prev => [...prev, { name: posNewName.trim(), level: posNewLevel }].sort((a, b) => a.level - b.level)); setPosNewName(''); } } }}
                placeholder="Nombre del cargo" style={{ flex: 1, fontSize: '0.88rem', minWidth: '150px' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Nivel:</label>
                <input className="input" type="number" min={1} max={20} value={posNewLevel} onChange={(e) => setPosNewLevel(Number(e.target.value) || 1)}
                  style={{ width: '60px', fontSize: '0.88rem', textAlign: 'center' }} />
              </div>
              <button type="button" className="btn-primary" disabled={!posNewName.trim()}
                onClick={() => { if (posNewName.trim()) { setPositions(prev => [...prev, { name: posNewName.trim(), level: posNewLevel }].sort((a, b) => a.level - b.level)); setPosNewName(''); } }}
                style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', opacity: !posNewName.trim() ? 0.5 : 1 }}>
                Agregar
              </button>
            </div>
            {/* Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" disabled={posSaving}
                onClick={async () => {
                  if (!token || positions.length === 0) return;
                  setPosSaving(true); setPosError(null);
                  try {
                    const saved = await api.tenants.setPositionsCatalog(token, positions);
                    setPositions(saved); setPosSaved(true); setTimeout(() => setPosSaved(false), 3000);
                    invalidatePos();
                  } catch (e: any) { setPosError(e.message || 'Error al guardar'); setTimeout(() => setPosError(null), 4000); }
                  setPosSaving(false);
                }}
                style={{ fontSize: '0.85rem', padding: '0.45rem 1.2rem', opacity: posSaving ? 0.6 : 1 }}>
                {posSaving ? 'Guardando...' : 'Guardar cargos'}
              </button>
              <button type="button" onClick={() => setPositions([
                { name: 'Gerente General', level: 1 }, { name: 'Gerente de Área', level: 2 },
                { name: 'Subgerente', level: 3 }, { name: 'Jefe de Área', level: 4 },
                { name: 'Coordinador', level: 5 }, { name: 'Analista', level: 6 }, { name: 'Asistente', level: 7 },
              ])} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.45rem 1rem', fontSize: '0.82rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                Restaurar predeterminados
              </button>
              {posSaved && <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>&#10003; Guardado</span>}
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {CUSTOM_SETTINGS_KEYS.filter((key) => CUSTOM_SETTINGS_META[key]).map((key) => {
          const meta = CUSTOM_SETTINGS_META[key];
          const items = customSettings[key] ?? [];
          const isExpanded = expandedKey === key;
          const isSaving = savingKey === key;
          const justSaved = settingSaved === key;
          const hasError = settingError === key;

          return (
            <div
              key={key}
              className="card animate-fade-up"
              style={{ overflow: 'hidden', padding: 0 }}
            >
              {/* Header - clickable */}
              <button
                type="button"
                onClick={() => {
                  setExpandedKey(isExpanded ? null : key);
                  setNewItemText('');
                }}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '1rem 1.25rem',
                  background: isExpanded ? 'var(--bg-secondary)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{meta.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '0.75rem' }}>
                    {items.length} {items.length === 1 ? t('mantenedores.element') : t('mantenedores.elements')}
                  </span>
                </div>
                <span style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  transform: isExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}>
                  &#9660;
                </span>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div style={{ padding: '1.25rem', borderTop: '1px solid var(--border)' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '1rem' }}>
                    {meta.description}
                  </p>

                  {/* Items list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: '1rem' }}>
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.4rem 0.6rem',
                          background: 'var(--bg-secondary)',
                          borderRadius: '6px',
                          fontSize: '0.88rem',
                        }}
                      >
                        <input className="input" value={item}
                          onChange={(e) => {
                            const updated = [...items];
                            updated[idx] = e.target.value;
                            setCustomSettings((prev: any) => ({ ...prev, [key]: updated }));
                          }}
                          style={{ flex: 1, fontSize: '0.85rem', padding: '0.3rem 0.6rem' }} />
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(key, idx)}
                          title={t('common.delete')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--danger)',
                            cursor: 'pointer',
                            fontSize: '1.1rem',
                            padding: '0 0.3rem',
                            lineHeight: 1,
                            flexShrink: 0,
                          }}
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                    {items.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic', padding: '0.5rem 0' }}>
                        {t('mantenedores.noElements')}
                      </p>
                    )}
                  </div>

                  {/* Usage error message */}
                  {removeError && expandedKey === key && (
                    <div style={{
                      padding: '0.6rem 0.85rem', marginBottom: '0.5rem',
                      background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: 'var(--radius-sm)', fontSize: '0.82rem', color: 'var(--danger)',
                    }}>
                      {removeError}
                    </div>
                  )}
                  {checkingRemove && expandedKey === key && (
                    <div style={{ padding: '0.3rem 0.85rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Verificando uso...
                    </div>
                  )}

                  {/* Add new item */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                    <input
                      className="input"
                      type="text"
                      value={expandedKey === key ? newItemText : ''}
                      onChange={(e) => setNewItemText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddItem(key); } }}
                      placeholder={t('mantenedores.newElement')}
                      style={{ flex: 1, fontSize: '0.88rem' }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleAddItem(key)}
                      disabled={!newItemText.trim()}
                      style={{ fontSize: '0.85rem', padding: '0.45rem 1rem', opacity: !newItemText.trim() ? 0.5 : 1 }}
                    >
                      {t('mantenedores.add')}
                    </button>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => handleSaveSetting(key)}
                      disabled={isSaving}
                      style={{ fontSize: '0.85rem', padding: '0.45rem 1.2rem', opacity: isSaving ? 0.6 : 1 }}
                    >
                      {isSaving ? t('mantenedores.saving') : t('mantenedores.saveBtn')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRestoreDefaults(key)}
                      style={{
                        background: 'none',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '0.45rem 1rem',
                        fontSize: '0.82rem',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {t('mantenedores.restoreDefaults')}
                    </button>
                    {justSaved && (
                      <span style={{ color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                        &#10003; {t('mantenedores.saved')}
                      </span>
                    )}
                    {hasError && (
                      <span style={{ color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                        {items.length === 0 ? t('mantenedores.atLeastOne') : (settingErrorMsg || t('mantenedores.saveError'))}
                      </span>
                    )}
                  </div>

                  {/* Normalize departments tool */}
                  {key === 'departments' && (
                    <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={() => handleNormalizeDepts(false)}
                          disabled={normalizing}
                          style={{
                            background: 'none',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '0.45rem 1rem',
                            fontSize: '0.82rem',
                            color: 'var(--text-secondary)',
                            cursor: normalizing ? 'wait' : 'pointer',
                            opacity: normalizing ? 0.6 : 1,
                          }}
                        >
                          {normalizing ? 'Analizando...' : 'Verificar departamentos de colaboradores'}
                        </button>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          Detecta colaboradores con departamentos que no coinciden con la lista configurada
                        </span>
                      </div>
                      {normalizeResult && (
                        <div style={{ marginTop: '0.75rem' }}>
                          {normalizeResult.mismatches.length === 0 ? (
                            <p style={{ fontSize: '0.85rem', color: 'var(--success)', fontWeight: 600 }}>
                              Todos los departamentos de colaboradores coinciden con la lista configurada.
                            </p>
                          ) : (
                            <>
                              <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                                <strong>{normalizeResult.mismatches.length}</strong> colaborador(es) con departamento diferente:
                                {normalizeResult.fixed > 0 && (
                                  <span style={{ color: 'var(--success)', marginLeft: '0.5rem' }}>
                                    ({normalizeResult.fixed} corregidos)
                                  </span>
                                )}
                              </p>
                              <div style={{
                                maxHeight: '200px', overflowY: 'auto',
                                background: 'var(--bg-secondary)', borderRadius: '6px',
                                padding: '0.5rem 0.75rem', fontSize: '0.82rem',
                              }}>
                                {normalizeResult.mismatches.map((m, i) => (
                                  <div key={i} style={{ padding: '0.25rem 0', borderBottom: i < normalizeResult.mismatches.length - 1 ? '1px solid var(--border)' : 'none' }}>
                                    <strong>{m.name}</strong>: &quot;{m.current}&quot;
                                    {m.suggested
                                      ? <span style={{ color: 'var(--primary)' }}> → {m.suggested}</span>
                                      : <span style={{ color: 'var(--danger)' }}> (sin coincidencia)</span>
                                    }
                                  </div>
                                ))}
                              </div>
                              {normalizeResult.fixed === 0 && normalizeResult.mismatches.some(m => m.suggested) && (
                                <button
                                  type="button"
                                  className="btn-primary"
                                  onClick={() => handleNormalizeDepts(true)}
                                  disabled={normalizing}
                                  style={{ marginTop: '0.75rem', fontSize: '0.85rem', padding: '0.45rem 1.2rem' }}
                                >
                                  Corregir departamentos sugeridos
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ Competencias por Cargo ═══ */}
      <RoleCompetenciesSection />
    </div>
  );
}

// ─── Competencias por Cargo Section ────────────────────────────────────

function RoleCompetenciesSection() {
  const token = useAuthStore((s) => s.token);
  const [expanded, setExpanded] = useState(false);
  const [positions, setPositions] = useState<any[]>([]);
  const [competencies, setCompetencies] = useState<any[]>([]);
  const [roleComps, setRoleComps] = useState<any[]>([]);
  const [selectedPosition, setSelectedPosition] = useState('');
  const [addCompId, setAddCompId] = useState('');
  const [addLevel, setAddLevel] = useState(5);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const loadData = async () => {
    if (!token) return;
    const [pos, comps, rcs] = await Promise.all([
      api.tenants.getPositionsCatalog(token).catch(() => []),
      api.development.competencies.list(token).catch(() => []),
      api.development.roleCompetencies.list(token).catch(() => []),
    ]);
    setPositions(Array.isArray(pos) ? pos : []);
    setCompetencies(Array.isArray(comps) ? comps : []);
    setRoleComps(Array.isArray(rcs) ? rcs : []);
  };

  useEffect(() => { if (expanded) loadData(); }, [expanded, token]);

  // Suggest competency level based on position hierarchy
  const getSuggestedLevel = (positionName: string): number => {
    const pos = positions.find((p: any) => p.name === positionName);
    if (!pos) return 5;
    // Map hierarchy level (1=highest) to competency level (10=highest)
    // Level 1 (CEO) → competency 9, Level 2 → 8, Level 3 → 7, Level 4 → 6, Level 5 → 5, Level 6 → 4, Level 7+ → 3
    const map: Record<number, number> = { 1: 9, 2: 8, 3: 7, 4: 6, 5: 5, 6: 4, 7: 3 };
    return map[pos.level] || 2;
  };

  const filtered = selectedPosition ? roleComps.filter((rc: any) => rc.position === selectedPosition) : [];
  const assignedCompIds = new Set(filtered.map((rc: any) => rc.competencyId));
  const availableComps = competencies.filter((c: any) => c.isActive && !assignedCompIds.has(c.id));
  const positionsWithComps = new Set(roleComps.map((rc: any) => rc.position));
  const positionsWithout = positions.filter((p: any) => !positionsWithComps.has(p.name));

  const handleAdd = async () => {
    if (!token || !selectedPosition || !addCompId) return;
    setSaving(true); setMsg('');
    try {
      await api.development.roleCompetencies.create(token, { position: selectedPosition, competencyId: addCompId, expectedLevel: addLevel });
      setAddCompId(''); setAddLevel(5);
      await loadData();
      setMsg('Competencia asignada');
    } catch (e: any) { setMsg(e.message || 'Error'); }
    setSaving(false);
  };

  const handleUpdateLevel = async (id: string, level: number) => {
    if (!token) return;
    try {
      await api.development.roleCompetencies.update(token, id, { expectedLevel: level });
      await loadData();
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!token) return;
    try {
      await api.development.roleCompetencies.remove(token, id);
      await loadData();
    } catch {}
  };

  const handleBulk = async (position: string) => {
    if (!token) return;
    setSaving(true); setMsg('');
    try {
      const level = getSuggestedLevel(position);
      const result = await api.development.roleCompetencies.bulkAssign(token, { position, defaultLevel: level });
      await loadData();
      setMsg(`${result.created} competencias asignadas a ${position} (nivel ${level})`);
    } catch (e: any) { setMsg(e.message || 'Error'); }
    setSaving(false);
  };

  const handleBulkAll = async () => {
    if (!token) return;
    setSaving(true); setMsg('');
    let total = 0;
    for (const p of positionsWithout) {
      try {
        const level = getSuggestedLevel(p.name);
        const result = await api.development.roleCompetencies.bulkAssign(token, { position: p.name, defaultLevel: level });
        total += result.created;
      } catch {}
    }
    await loadData();
    setMsg(`${total} competencias asignadas a ${positionsWithout.length} cargos (niveles según jerarquía)`);
    setSaving(false);
  };

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <button onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        padding: '1rem 1.25rem', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Competencias por Cargo</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Define qué competencias y nivel de dominio se espera para cada cargo.</div>
        </div>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
      </button>

      {expanded && (
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          {/* Level explanation */}
          <div style={{ padding: '1rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.1)', marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--accent)', fontSize: '0.82rem', display: 'block', marginBottom: '0.6rem' }}>Escala de niveles de competencia (1-10)</strong>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
              {[
                { range: '1-2', label: 'Básico', desc: 'Conocimiento introductorio', color: '#ef4444', bg: 'rgba(239,68,68,0.08)' },
                { range: '3-4', label: 'Intermedio', desc: 'Aplica con supervisión', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
                { range: '5-6', label: 'Competente', desc: 'Aplica de forma autónoma', color: '#6366f1', bg: 'rgba(99,102,241,0.08)' },
                { range: '7-8', label: 'Avanzado', desc: 'Referente en el área', color: '#8b5cf6', bg: 'rgba(139,92,246,0.08)' },
                { range: '9-10', label: 'Experto', desc: 'Lidera y enseña a otros', color: '#10b981', bg: 'rgba(16,185,129,0.08)' },
              ].map((l) => (
                <div key={l.range} style={{ padding: '0.5rem 0.6rem', borderRadius: '6px', background: l.bg, border: `1px solid ${l.color}20`, textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: l.color, lineHeight: 1.2 }}>{l.range}</div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: l.color, marginTop: '0.15rem' }}>{l.label}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.3 }}>{l.desc}</div>
                </div>
              ))}
            </div>
            <p style={{ margin: '0.6rem 0 0', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5, textAlign: 'center' }}>
              El nivel sugerido se calcula según la jerarquía del cargo: cargos de mayor nivel requieren mayor dominio.
            </p>
          </div>

          {/* Position selector */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 250px' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Cargo</label>
              <select className="input" value={selectedPosition} onChange={(e) => { setSelectedPosition(e.target.value); if (e.target.value) setAddLevel(getSuggestedLevel(e.target.value)); }} style={{ width: '100%', fontSize: '0.82rem' }}>
                <option value="">— Seleccionar cargo —</option>
                {positions.map((p: any) => (
                  <option key={p.name} value={p.name}>
                    {p.name} (Nv.{p.level}){positionsWithComps.has(p.name) ? ` · ${roleComps.filter((rc: any) => rc.position === p.name).length} comp.` : ' · Sin competencias'}
                  </option>
                ))}
              </select>
            </div>
            {positionsWithout.length > 0 && (
              <button className="btn-ghost" disabled={saving} onClick={handleBulkAll} style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                {saving ? '...' : `Asignar a ${positionsWithout.length} cargos sin perfil`}
              </button>
            )}
          </div>

          {msg && <p style={{ fontSize: '0.78rem', color: 'var(--success)', marginBottom: '0.75rem' }}>{msg}</p>}

          {/* Assigned competencies for selected position */}
          {selectedPosition && (
            <>
              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Competencias de "{selectedPosition}" ({filtered.length}):
              </div>

              {filtered.length === 0 ? (
                <div style={{ padding: '1rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                  Sin competencias asignadas. Use el formulario abajo para agregar.
                  <button className="btn-primary" style={{ display: 'block', margin: '0.5rem auto 0', fontSize: '0.78rem' }} disabled={saving}
                    onClick={() => handleBulk(selectedPosition)}>
                    {saving ? '...' : `Asignar todas las competencias (nivel sugerido: ${getSuggestedLevel(selectedPosition)})`}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', marginBottom: '0.75rem' }}>
                  {filtered.map((rc: any) => (
                    <div key={rc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{rc.competency?.name || rc.competencyId}</span>
                        {rc.competency?.category && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: '0.35rem' }}>({rc.competency.category})</span>}
                      </div>
                      <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Nivel:</label>
                      <select className="input" value={rc.expectedLevel} onChange={(e) => handleUpdateLevel(rc.id, Number(e.target.value))} style={{ width: 60, fontSize: '0.82rem', padding: '0.2rem 0.4rem' }}>
                        {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <button onClick={() => handleDelete(rc.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.85rem', padding: '0.15rem 0.3rem' }} title="Eliminar">✕</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new competency */}
              {availableComps.length > 0 && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', padding: '0.75rem', background: 'rgba(99,102,241,0.04)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(99,102,241,0.12)' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Agregar competencia</label>
                    <select className="input" value={addCompId} onChange={(e) => setAddCompId(e.target.value)} style={{ width: '100%', fontSize: '0.82rem' }}>
                      <option value="">Seleccionar...</option>
                      {availableComps.map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.category})</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '0.2rem' }}>Nivel</label>
                    <select className="input" value={addLevel} onChange={(e) => setAddLevel(Number(e.target.value))} style={{ width: 60, fontSize: '0.82rem' }}>
                      {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  <button className="btn-primary" onClick={handleAdd} disabled={saving || !addCompId} style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    {saving ? '...' : 'Agregar'}
                  </button>
                </div>
              )}
              {availableComps.length === 0 && filtered.length > 0 && (
                <p style={{ fontSize: '0.75rem', color: 'var(--success)', fontStyle: 'italic' }}>Todas las competencias del catálogo están asignadas a este cargo.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
