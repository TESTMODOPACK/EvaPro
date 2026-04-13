'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useDemographics, useEquityAnalysis, useGapReport } from '@/hooks/useDei';
import { useCycles } from '@/hooks/useCycles';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

// ─── Group label maps ──────────────────────────────────────────
const SENIORITY_LABELS: Record<string, string> = {
  junior: 'Junior', mid: 'Nivel Medio', senior: 'Senior',
  lead: 'Lead / Líder', director: 'Director(a)', executive: 'Ejecutivo(a)',
};

/** Capitalize first letter of each word */
const capitalize = (s: string) =>
  s?.replace(/\b\w/g, (c) => c.toUpperCase()) || s;

/** Format group name to a human-readable label */
const formatGroupLabel = (group: string, dimension: string): string => {
  if (!group) return 'Sin dato';
  if (dimension === 'seniority') return SENIORITY_LABELS[group.toLowerCase()] || capitalize(group);
  // gender, nationality, department — just capitalize
  return capitalize(group);
};

// Brand-aligned warm palette (gold, earth tones matching Ascenda theme)
const BAR_COLORS = [
  'var(--accent)',        // gold
  '#8b6914',             // dark gold
  '#b8860b',             // goldenrod
  '#a0522d',             // sienna
  '#6b705c',             // olive gray
  '#d4a574',             // tan
  '#917c5c',             // warm brown
  '#c9933a',             // brand gold
];

function DistributionBar({ items, dimension }: { items: Array<{ group: string; count: number; percentage: number }>; dimension?: string }) {
  if (!items || items.length === 0) return <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Sin datos</span>;
  const label = (g: string) => formatGroupLabel(g, dimension || '');
  return (
    <div>
      <div style={{ display: 'flex', height: 20, borderRadius: 'var(--radius-sm)', overflow: 'hidden', marginBottom: '0.35rem' }}>
        {items.map((item, i) => (
          <div key={item.group} title={`${label(item.group)}: ${item.count} (${item.percentage}%)`}
            style={{ width: `${item.percentage}%`, background: BAR_COLORS[i % BAR_COLORS.length], minWidth: item.percentage > 0 ? 2 : 0, opacity: 0.85 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        {items.map((item, i) => (
          <span key={item.group} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: BAR_COLORS[i % BAR_COLORS.length], display: 'inline-block', opacity: 0.85 }} />
            {label(item.group)}: {item.count} ({item.percentage}%)
          </span>
        ))}
      </div>
    </div>
  );
}

function DataCompletenessBar({ data, t }: { data: Array<{ field: string; percentage: number }>; t: any }) {
  const labels: Record<string, string> = {
    gender: t('dei.fields.gender'), birthDate: t('dei.fields.birthDate'), nationality: t('dei.fields.nationality'),
    seniorityLevel: t('dei.fields.seniority'), contractType: t('dei.fields.contractType'), workLocation: t('dei.fields.workLocation'),
  };
  return (
    <div>
      <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{t('dei.dataCompleteness')}</h3>
      {(data || []).map((d) => (
        <div key={d.field} style={{ marginBottom: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 2 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{labels[d.field] || d.field}</span>
            <span style={{ color: d.percentage >= 80 ? 'var(--success)' : d.percentage >= 50 ? 'var(--accent)' : 'var(--danger)', fontWeight: 600 }}>
              {d.percentage}%
            </span>
          </div>
          <div style={{ height: 6, background: 'var(--bg-secondary)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${d.percentage}%`, background: d.percentage >= 80 ? 'var(--success)' : d.percentage >= 50 ? 'var(--accent)' : 'var(--danger)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DeiPage() {
  const { t } = useTranslation();
  const { data: demo, isLoading: loadingDemo, isError: demoError } = useDemographics();
  const { data: cycles } = useCycles();
  const token = useAuthStore((s) => s.token);
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [dimension, setDimension] = useState('gender');
  const { data: equity } = useEquityAnalysis(selectedCycleId);
  const { data: gap } = useGapReport(selectedCycleId, dimension);
  const [showGuide, setShowGuide] = useState(false);

  const [deiTab, setDeiTab] = useState<'demographics' | 'equity'>('demographics');

  // DEI Config state
  const [deiConfig, setDeiConfig] = useState({ privacyMin: 5, mediumThreshold: 1.5, highThreshold: 2.0 });
  const [configSaving, setConfigSaving] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Corrective actions state
  const [actions, setActions] = useState<any[]>([]);
  const [showActions, setShowActions] = useState(false);
  const [newAction, setNewAction] = useState({ alertType: '', severity: 'medium', alertMessage: '', action: '' });
  const [actionSaving, setActionSaving] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.dei.getConfig(token).then(setDeiConfig).catch(() => {});
    api.dei.listCorrectiveActions(token).then(setActions).catch(() => {});
  }, [token]);

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1100px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('dei.title')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {t('dei.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setShowGuide(!showGuide)} style={{ fontSize: '0.82rem' }}>
            {showGuide ? t('dei.hideGuide') : t('dei.howItWorks')}
          </button>
          <button className="btn-ghost" onClick={() => setShowConfig(!showConfig)} style={{ fontSize: '0.82rem' }}>
            {t('dei.configBtn')}
          </button>
        </div>
      </div>

      {/* Usage Guide */}
      {showGuide && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem', color: 'var(--accent)' }}>
            {t('dei.guide.title')}
          </h3>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('dei.guide.whatIs')}</div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{t('dei.guide.whatIsDesc')}</p>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('dei.guide.sections')}</div>
            <ol style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('dei.guide.section1')}</li>
              <li>{t('dei.guide.section2')}</li>
              <li>{t('dei.guide.section3')}</li>
              <li>{t('dei.guide.section4')}</li>
              <li>{t('dei.guide.section5')}</li>
            </ol>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('dei.guide.rules')}</div>
            <ul style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.8, margin: 0, paddingLeft: '1.2rem' }}>
              <li>{t('dei.guide.rule1')}</li>
              <li>{t('dei.guide.rule2')}</li>
              <li>{t('dei.guide.rule3')}</li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.5rem' }}>{t('dei.guide.permissions')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('dei.guide.permAdmin')}
              </div>
              <div style={{ padding: '0.6rem 0.75rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {t('dei.guide.permManager')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DEI Configuration (collapsible) */}
      {showConfig && (
        <div className="card animate-fade-up" style={{ padding: '1.5rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>{t('dei.configTitle')}</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>{t('dei.configDesc')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                {t('dei.configPrivacyMin')}
              </label>
              <input className="input" type="number" min={2} max={50} value={deiConfig.privacyMin}
                onChange={(e) => setDeiConfig({ ...deiConfig, privacyMin: Math.max(2, parseInt(e.target.value) || 5) })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                {t('dei.configMedium')}
              </label>
              <input className="input" type="number" min={0.5} max={5} step={0.1} value={deiConfig.mediumThreshold}
                onChange={(e) => setDeiConfig({ ...deiConfig, mediumThreshold: parseFloat(e.target.value) || 1.5 })} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.3rem', textTransform: 'uppercase' }}>
                {t('dei.configHigh')}
              </label>
              <input className="input" type="number" min={1} max={5} step={0.1} value={deiConfig.highThreshold}
                onChange={(e) => setDeiConfig({ ...deiConfig, highThreshold: parseFloat(e.target.value) || 2.0 })} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button className="btn-primary" disabled={configSaving}
              onClick={async () => {
                if (!token) return;
                setConfigSaving(true);
                try { const result = await api.dei.updateConfig(token, deiConfig); setDeiConfig(result); setConfigSaved(true); setTimeout(() => setConfigSaved(false), 3000); } catch {}
                setConfigSaving(false);
              }}>
              {configSaving ? t('common.saving') : t('common.save')}
            </button>
            {configSaved && <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>{t('dei.configSaved')}</span>}
          </div>
        </div>
      )}

      {loadingDemo && <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>}
      {demoError && (
        <div className="card" style={{ padding: '1.5rem', borderLeft: '4px solid var(--danger)' }}>
          <p style={{ color: 'var(--danger)', fontWeight: 600 }}>{t('dei.loadError')}</p>
        </div>
      )}

      {/* Tabs */}
      {!loadingDemo && !demoError && (
        <div style={{ display: 'flex', gap: '0.15rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)' }}>
          {[
            { id: 'demographics' as const, label: 'Demografía y Diversidad' },
            { id: 'equity' as const, label: 'Análisis de Equidad en Evaluaciones' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setDeiTab(tab.id)}
              style={{
                padding: '0.6rem 1rem', border: 'none', background: 'none', cursor: 'pointer',
                borderBottom: deiTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
                fontWeight: deiTab === tab.id ? 700 : 400,
                color: deiTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: '0.85rem',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {deiTab === 'demographics' && demo && demo.total > 0 && (
        <>
          {/* Overview Cards */}
          <div className="animate-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { value: demo.total, label: t('dei.totalEmployees'), color: 'var(--accent)' },
              { value: demo.gender?.length || 0, label: t('dei.genders'), color: 'var(--accent)' },
              { value: demo.nationality?.length || 0, label: t('dei.nationalities'), color: 'var(--accent)' },
              { value: demo.ageRanges?.length || 0, label: t('dei.ageRanges'), color: 'var(--accent)' },
            ].map((card) => (
              <div key={card.label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: card.color }}>{card.value}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{card.label}</div>
              </div>
            ))}
          </div>

          {/* Demographic Distributions */}
          <div className="animate-fade-up" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { title: t('dei.distGender'), data: demo.gender, dim: 'gender' },
              { title: t('dei.distSeniority'), data: demo.seniority, dim: 'seniority' },
              { title: t('dei.distAge'), data: demo.ageRanges, dim: '' },
              { title: t('dei.distTenure'), data: demo.tenureRanges, dim: '' },
              { title: t('dei.distContract'), data: demo.contractType, dim: '' },
              { title: t('dei.distLocation'), data: demo.workLocation, dim: '' },
            ].map((dist) => (
              <div key={dist.title} className="card" style={{ padding: '1.25rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.88rem', fontWeight: 700 }}>{dist.title}</h4>
                <DistributionBar items={dist.data} dimension={dist.dim} />
              </div>
            ))}
          </div>

          {/* Data Completeness */}
          <div className="card animate-fade-up" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <DataCompletenessBar data={demo.dataCompleteness} t={t} />
          </div>

          {/* Equity Analysis — hidden in demographics tab, shown in equity tab */}
          {deiTab === 'equity' && (
          <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.75rem' }}>{t('dei.equityTitle')}</h2>
            <select className="input" value={selectedCycleId || ''} onChange={(e) => setSelectedCycleId(e.target.value || null)}
              style={{ marginBottom: '1rem', minWidth: '300px' }}>
              <option value="">{t('dei.selectCycle')}</option>
              {(Array.isArray(cycles) ? cycles : []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} ({c.status})</option>
              ))}
            </select>

            {equity && selectedCycleId && (
              <>
                {/* Alerts */}
                {equity.alerts?.length > 0 && (
                  <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--danger)' }}>
                    <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', fontWeight: 700, color: 'var(--danger)' }}>
                      {t('dei.alertsTitle')} ({equity.alertCount})
                    </h4>
                    {equity.alerts.map((alert: any, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem', fontSize: '0.82rem' }}>
                        <span className={`badge ${alert.severity === 'high' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.7rem' }}>
                          {alert.severity === 'high' ? 'ALTA' : 'MEDIA'}
                        </span>
                        <span style={{ color: 'var(--text-secondary)' }}>{alert.message}</span>
                      </div>
                    ))}
                  </div>
                )}
                {equity.alerts?.length === 0 && (
                  <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem', borderLeft: '4px solid var(--success)' }}>
                    <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '0.88rem' }}>{t('dei.noAlerts')}</span>
                  </div>
                )}

                {/* Gap Report */}
                <div className="card" style={{ padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{t('dei.gapTitle')}</h4>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {[
                        { val: 'gender', label: t('dei.dimGender') }, { val: 'seniority', label: t('dei.dimSeniority') },
                        { val: 'department', label: t('dei.dimDepartment') }, { val: 'nationality', label: t('dei.dimNationality') },
                      ].map((d) => (
                        <button key={d.val} onClick={() => setDimension(d.val)}
                          className={dimension === d.val ? 'btn-primary' : 'btn-ghost'}
                          style={{ fontSize: '0.75rem', padding: '4px 10px' }}>
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {gap?.groups?.length > 0 ? (
                    <div className="table-wrapper">
                      <table>
                        <thead>
                          <tr>
                            <th style={{ textAlign: 'left' }}>{t('dei.colGroup')}</th>
                            <th style={{ textAlign: 'right' }}>{t('dei.colAvg')}</th>
                            <th style={{ textAlign: 'right' }}>Min</th>
                            <th style={{ textAlign: 'right' }}>Max</th>
                            <th style={{ textAlign: 'right' }}>{t('dei.colPeople')}</th>
                            <th style={{ textAlign: 'right' }}>{t('dei.colGap')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {gap.groups.map((g: any) => (
                            <tr key={g.group}>
                              <td style={{ fontWeight: 600 }}>{formatGroupLabel(g.group, dimension)}</td>
                              <td style={{ textAlign: 'right' }}>{g.avgScore}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{g.minScore}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{g.maxScore}</td>
                              <td style={{ textAlign: 'right' }}>{g.userCount}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600,
                                color: Math.abs(g.gapFromAvg) >= 1 ? 'var(--danger)' : Math.abs(g.gapFromAvg) >= 0.5 ? 'var(--accent)' : 'var(--success)' }}>
                                {g.gapFromAvg > 0 ? '+' : ''}{g.gapFromAvg}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {t('dei.noData')} ({t('dei.minPeople')} {gap?.privacyThreshold || 10})
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
          )}
        </>
      )}

      {/* Equity tab — visible even without demographics data */}
      {deiTab === 'equity' && (!demo || demo.total === 0) && (
        <div className="card" style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>Seleccione un ciclo de evaluación cerrado para ver el análisis de equidad.</p>
        </div>
      )}

      {demo && demo.total === 0 && deiTab === 'demographics' && (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p>{t('dei.emptyState')}</p>
        </div>
      )}

      {/* Corrective Actions */}
      <div className="animate-fade-up" style={{ marginTop: '1rem' }}>
        <button className="btn-ghost" onClick={() => setShowActions(!showActions)} style={{ fontSize: '0.82rem', marginBottom: '0.75rem' }}>
          {showActions ? t('dei.hideActions') : `${t('dei.showActions')} (${actions.length})`}
        </button>

        {showActions && (
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>{t('dei.actionsTitle')}</h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem', padding: '1rem', background: 'rgba(201,147,58,0.04)', borderRadius: 'var(--radius-sm)' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('dei.actionDimension')}</label>
                <select className="input" value={newAction.alertType} onChange={(e) => setNewAction({ ...newAction, alertType: e.target.value })} style={{ fontSize: '0.82rem' }}>
                  <option value="">{t('dei.actionSelect')}</option>
                  <option value="gender">{t('dei.dimGender')}</option>
                  <option value="seniority">{t('dei.dimSeniority')}</option>
                  <option value="age">{t('dei.dimAge')}</option>
                  <option value="tenure">{t('dei.dimTenure')}</option>
                  <option value="department">{t('dei.dimDepartment')}</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('dei.actionSeverity')}</label>
                <select className="input" value={newAction.severity} onChange={(e) => setNewAction({ ...newAction, severity: e.target.value })} style={{ fontSize: '0.82rem' }}>
                  <option value="medium">{t('dei.severityMedium')}</option>
                  <option value="high">{t('dei.severityHigh')}</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>{t('dei.actionDescription')}</label>
                <textarea className="input" value={newAction.action} onChange={(e) => setNewAction({ ...newAction, action: e.target.value })}
                  placeholder={t('dei.actionPlaceholder')} rows={2} style={{ fontSize: '0.82rem', resize: 'vertical' }} />
              </div>
              <div>
                <button className="btn-primary" disabled={actionSaving || !newAction.alertType || !newAction.action.trim()} style={{ fontSize: '0.82rem' }}
                  onClick={async () => {
                    if (!token) return;
                    setActionSaving(true);
                    try {
                      const created = await api.dei.createCorrectiveAction(token, { alertType: newAction.alertType, severity: newAction.severity, alertMessage: `Accion correctiva: ${newAction.alertType}`, action: newAction.action, cycleId: selectedCycleId || undefined });
                      setActions((prev) => [created, ...prev]);
                      setNewAction({ alertType: '', severity: 'medium', alertMessage: '', action: '' });
                    } catch {}
                    setActionSaving(false);
                  }}>
                  {actionSaving ? t('dei.actionSaving') : t('dei.actionCreate')}
                </button>
              </div>
            </div>

            {actions.length > 0 ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>{t('dei.actionDimension')}</th>
                      <th>{t('dei.actionCol')}</th>
                      <th>{t('dei.actionStatus')}</th>
                      <th>{t('dei.actionDate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {actions.map((a: any) => (
                      <tr key={a.id}>
                        <td>
                          <span className={`badge ${a.severity === 'high' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: '0.72rem', marginRight: '0.3rem' }}>
                            {a.severity === 'high' ? 'ALTA' : 'MEDIA'}
                          </span>
                          {a.alertType}
                        </td>
                        <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.action}</td>
                        <td>
                          <select className="input" value={a.status} style={{ fontSize: '0.78rem', padding: '0.25rem 0.4rem', width: 'auto' }}
                            onChange={async (e) => {
                              if (!token) return;
                              try { await api.dei.updateCorrectiveAction(token, a.id, { status: e.target.value }); setActions((prev) => prev.map((x) => x.id === a.id ? { ...x, status: e.target.value } : x)); } catch {}
                            }}>
                            <option value="pending">{t('dei.statusPending')}</option>
                            <option value="in_progress">{t('dei.statusInProgress')}</option>
                            <option value="completed">{t('dei.statusCompleted')}</option>
                            <option value="cancelled">{t('dei.statusCancelled')}</option>
                          </select>
                        </td>
                        <td style={{ color: 'var(--text-muted)' }}>{new Date(a.createdAt).toLocaleDateString('es-CL')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{t('dei.noActions')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
