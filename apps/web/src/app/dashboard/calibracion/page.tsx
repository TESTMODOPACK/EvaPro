'use client';
import { PlanGate } from '@/components/PlanGate';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { useLocaleStore } from '@/store/locale.store';
import { api } from '@/lib/api';
import { calibrationStatusLabel as STATUS_LABEL, calibrationStatusBadge as STATUS_BADGE } from '@/lib/statusMaps';
import { useDepartments } from '@/hooks/useDepartments';

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
      <span className="spinner" />
    </div>
  );
}

function formatDate(d: string, loc: string) {
  return new Date(d).toLocaleDateString(loc === 'pt' ? 'pt-BR' : loc === 'en' ? 'en-US' : 'es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CalibracionPageContent() {
  const { t } = useTranslation();
  const { locale } = useLocaleStore();
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const { departments: configuredDepartments, departmentRecords } = useDepartments();

  const [sessions, setSessions] = useState<any[]>([]);
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [createError, setCreateError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', cycleId: '', department: '', notes: '' });
  const [useCustomDist, setUseCustomDist] = useState(false);
  const [dist, setDist] = useState({ low: 10, midLow: 20, mid: 40, midHigh: 20, high: 10 });
  const distSum = dist.low + dist.midLow + dist.mid + dist.midHigh + dist.high;

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError('');
    // Llamadas separadas: un error en ciclos no borra las sesiones
    api.talent.calibration.list(token)
      .then((sess) => setSessions(sess || []))
      .catch(() => setLoadError(t('calibracion.loadError')))
      .finally(() => setLoading(false));
    api.cycles.list(token)
      .then((cyc) => setCycles(cyc || []))
      .catch(() => {});
  }, [token]);

  async function handleCreate() {
    if (!form.name || !form.cycleId || !token) return;
    if (useCustomDist && distSum !== 100) return;
    setCreating(true);
    setCreateError('');
    try {
      const data: any = { name: form.name, cycleId: form.cycleId };
      if (form.department) {
        data.department = form.department;
        const dRec = departmentRecords.find(d => d.name.toLowerCase() === form.department.toLowerCase());
        if (dRec?.id) data.departmentId = dRec.id;
      }
      if (form.notes) data.notes = form.notes;
      if (useCustomDist) data.expectedDistribution = { ...dist };
      await api.talent.calibration.create(token, data);
      const updated = await api.talent.calibration.list(token);
      setSessions(updated || []);
      setForm({ name: '', cycleId: '', department: '', notes: '' });
      setUseCustomDist(false);
      setDist({ low: 10, midLow: 20, mid: 40, midHigh: 20, high: 10 });
      setShowForm(false);
    } catch (err: any) {
      setCreateError(err?.message || t('calibracion.createError'));
    }
    setCreating(false);
  }

  if (!token) return null;

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      <div className="animate-fade-up">

        {/* Header */}
        <div className="animate-fade-up" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
              {t('calibracion.title')}
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {t('calibracion.subtitle')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn-ghost"
              onClick={() => setShowGuide(!showGuide)}
              style={{ fontSize: '0.82rem' }}
            >
              {showGuide ? t('calibracion.hideGuide') : t('calibracion.howItWorks')}
            </button>
            <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
              {showForm ? t('common.cancel') : t('calibracion.newSession')}
            </button>
          </div>
        </div>

        {/* Guide */}
        {showGuide && (
          <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
              {t('calibracion.guide.title')}
            </h3>

            {/* Qué es */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {t('calibracion.guide.whatIs')}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {t('calibracion.guide.whatIsDesc')}
              </p>
            </div>

            {/* Cuándo se usa */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {t('calibracion.guide.whenUsed')}
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
                {t('calibracion.guide.whenUsedDesc')}
              </p>
            </div>

            {/* Flujo */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {t('calibracion.guide.flow')}
              </div>
              <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
                <li>{t('calibracion.guide.flowStep1')}</li>
                <li>{t('calibracion.guide.flowStep2')}</li>
                <li>{t('calibracion.guide.flowStep3')}</li>
                <li>{t('calibracion.guide.flowStep4')}</li>
                <li>{t('calibracion.guide.flowStep5')}</li>
              </ol>
            </div>

            {/* Conexión con otras funciones */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {t('calibracion.guide.connections')}
              </div>
              <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
                <li>{t('calibracion.guide.connCycles')}</li>
                <li>{t('calibracion.guide.connTalent')}</li>
                <li>{t('calibracion.guide.connReports')}</li>
              </ul>
            </div>

            {/* Permisos */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                {t('calibracion.guide.permissions')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t('calibracion.guide.permAdmin')}
                </div>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t('calibracion.guide.permManager')}
                </div>
                <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(99,102,241,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {t('calibracion.guide.permEmployee')}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Create form */}
        {showForm && (
          <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
            <div style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.2rem', color: 'var(--text-primary)' }}>
                {t('calibracion.form.title')}
              </h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                {t('calibracion.form.subtitle')}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  {t('calibracion.form.name')}
                </label>
                <input
                  className="input"
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('calibracion.form.namePlaceholder')}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  {t('calibracion.form.cycle')}
                </label>
                <select
                  className="input"
                  value={form.cycleId}
                  onChange={(e) => setForm({ ...form, cycleId: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="">{t('calibracion.form.cyclePlaceholder')}</option>
                  {cycles
                    .filter((c: any) => c.status === 'active' || c.status === 'closed')
                    .map((c: any) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.status === 'closed' ? 'Cerrado' : 'Activo'})</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  {t('calibracion.form.department')}
                </label>
                <select
                  className="input"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  style={{ width: '100%' }}
                >
                  <option value="">{t('calibracion.form.departmentPlaceholder')}</option>
                  {configuredDepartments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>
                  {t('calibracion.form.notes')}
                </label>
                <textarea
                  className="input"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  placeholder={t('calibracion.form.notesPlaceholder')}
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            </div>

            {/* Distribución esperada */}
            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={useCustomDist}
                  onChange={(e) => setUseCustomDist(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                {t('calibracion.form.distribution')}
                <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>{t('calibracion.form.distributionDefault')}</span>
              </label>
              {useCustomDist && (
                <div style={{ padding: '1rem', background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.75rem', marginBottom: '0.5rem' }}>
                    {([
                      { key: 'low' as const, label: 'Bajo (0-2)' },
                      { key: 'midLow' as const, label: 'Medio-Bajo' },
                      { key: 'mid' as const, label: 'Medio (4-6)' },
                      { key: 'midHigh' as const, label: 'Medio-Alto' },
                      { key: 'high' as const, label: 'Alto (8-10)' },
                    ]).map(({ key, label }) => (
                      <div key={key} style={{ textAlign: 'center' }}>
                        <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>{label}</label>
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max="100"
                          value={dist[key]}
                          onChange={(e) => setDist((prev) => ({ ...prev, [key]: Math.max(0, Math.min(100, Number(e.target.value))) }))}
                          style={{ textAlign: 'center', padding: '0.4rem' }}
                        />
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>%</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: '0.78rem', textAlign: 'right', fontWeight: 600, color: distSum === 100 ? 'var(--success)' : 'var(--danger)' }}>
                    Total: {distSum}% {distSum === 100 ? '✓' : t('calibracion.form.distributionMustBe100')}
                  </div>
                </div>
              )}
            </div>

            <div style={{ height: '1px', background: 'var(--border)', marginBottom: '1.25rem' }} />

            {createError && (
              <div style={{ padding: '0.6rem 1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--danger)', marginBottom: '1rem' }}>
                {createError}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => { setShowForm(false); setCreateError(''); }}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={creating || !form.name || !form.cycleId || (useCustomDist && distSum !== 100)}
              >
                {creating ? t('calibracion.form.creating') : t('calibracion.form.create')}
              </button>
            </div>
          </div>
        )}

        {/* Sessions list */}
        {loadError ? (
          <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)', background: 'rgba(239,68,68,0.05)' }}>
            <p style={{ fontWeight: 600, color: 'var(--danger)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>{t('calibracion.errorLoadTitle')}</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>{loadError}</p>
            <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => { setLoadError(''); setLoading(true); api.talent.calibration.list(token!).then((s) => setSessions(s || [])).catch(() => setLoadError(t('calibracion.loadError'))).finally(() => setLoading(false)); }}>
              {t('calibracion.retry')}
            </button>
          </div>
        ) : loading ? (
          <Spinner />
        ) : sessions.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: 500 }}>
              {t('calibracion.noSessions')}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
              {t('calibracion.noSessionsHint')}
            </p>
          </div>
        ) : (
          <div
            className="animate-fade-up-delay-1"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
          >
            {sessions.map((s: any) => {
              const cycleName = s.cycle?.name || cycles.find((c: any) => c.id === s.cycleId)?.name || '\u2014';
              const isActive   = s.status === 'in_progress';
              const isDone     = s.status === 'completed';

              return (
                <div
                  key={s.id}
                  className="card"
                  onClick={() => router.push(`/dashboard/calibracion/${s.id}`)}
                  style={{ cursor: 'pointer', padding: '1.4rem', transition: 'var(--transition)', height: '100%', display: 'flex', flexDirection: 'column' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  {/* Row 1: department tag + status badge */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)',
                      background: 'rgba(99,102,241,0.1)', padding: '0.2rem 0.65rem',
                      borderRadius: '999px', letterSpacing: '0.02em',
                    }}>
                      {s.department || t('calibracion.general')}
                    </span>
                    <span className={`badge ${STATUS_BADGE[s.status] || 'badge-accent'}`}>
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </div>

                  {/* Row 2: session name */}
                  <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.25rem', lineHeight: 1.4, color: 'var(--text-primary)' }}>
                    {s.name}
                  </h3>

                  {/* Row 3: cycle name */}
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    {cycleName}
                  </p>

                  {/* Row 4: meta — moderator + date */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', flex: 1 }}>
                    {s.moderator && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                        </svg>
                        <span>{s.moderator.firstName} {s.moderator.lastName}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.6, flexShrink: 0 }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <span>{formatDate(s.createdAt, locale)}</span>
                    </div>
                  </div>

                  {/* Row 5: status bar (matches evaluaciones card) */}
                  {isActive && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('calibracion.progress')}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--accent-hover)' }}>{t('calibracion.inProgress')}</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{ width: '50%', height: '100%', borderRadius: '999px', background: 'var(--accent)', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}
                  {isDone && (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t('calibracion.progress')}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--success)' }}>{t('calibracion.completed')}</span>
                      </div>
                      <div style={{ height: '5px', borderRadius: '999px', background: 'var(--bg-surface)' }}>
                        <div style={{ width: '100%', height: '100%', borderRadius: '999px', background: 'var(--success)', transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}

export default function CalibracionPage() {
  return (
    <PlanGate feature="CALIBRATION">
      <CalibracionPageContent />
    </PlanGate>
  );
}
