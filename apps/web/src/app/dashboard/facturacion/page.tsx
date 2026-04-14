'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';
import { PageSkeleton } from '@/components/LoadingSkeleton';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8', sent: '#f59e0b', paid: '#10b981', overdue: '#ef4444', cancelled: '#6b7280',
};
const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador', sent: 'Enviada', paid: 'Pagada', overdue: 'Vencida', cancelled: 'Cancelada',
};

type Tab = 'invoices' | 'stats' | 'config';

export default function FacturacionPage() {
  const token = useAuthStore((s) => s.token);
  const toast = useToastStore((s) => s.toast);
  const [tab, setTab] = useState<Tab>('invoices');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterTenant, setFilterTenant] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');

  // Actions
  const [generating, setGenerating] = useState(false);
  const [payModal, setPayModal] = useState<any>(null);
  const [payForm, setPayForm] = useState({ paymentMethod: 'transferencia', transactionRef: '', notes: '' });
  const [paying, setPaying] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const loadData = async () => {
    if (!token) return;
    try {
      const [invs, st, ts, ss] = await Promise.all([
        api.invoices.list(token, { status: filterStatus || undefined, tenantId: filterTenant || undefined, period: filterPeriod || undefined }),
        api.invoices.stats(token),
        api.tenants.list(token),
        api.subscriptions.list(token),
      ]);
      setInvoices(invs);
      setStats(st);
      setTenants(ts);
      setSubs(ss);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [token, filterStatus, filterTenant, filterPeriod]);

  if (loading) return <PageSkeleton cards={4} tableRows={6} />;

  const activeSubs = (subs || []).filter((s: any) => s.status === 'active' || s.status === 'trial');

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1200px' }}>
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Facturación</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Gestión de facturas, cobros y estadísticas de ingresos.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="animate-fade-up" style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        {([
          { id: 'invoices' as Tab, label: 'Facturas' },
          { id: 'stats' as Tab, label: 'Estadísticas' },
          { id: 'config' as Tab, label: 'Configuración' },
        ]).map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '0.6rem 1rem', fontSize: '0.82rem', fontWeight: tab === t.id ? 700 : 500,
            color: tab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
            background: 'none', border: 'none', cursor: 'pointer',
            borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
            marginBottom: '-1px',
          }}>{t.label}</button>
        ))}
      </div>

      {/* ═══════ TAB: FACTURAS ═══════ */}
      {tab === 'invoices' && (
        <div className="animate-fade-up">
          {/* KPIs */}
          {stats && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
              {[
                { label: 'Facturado (mes)', value: `${stats.totalInvoiced} ${stats.currency}`, color: 'var(--text-primary)' },
                { label: 'Cobrado', value: `${stats.totalPaid} ${stats.currency}`, color: 'var(--success)' },
                { label: 'Pendiente', value: `${stats.totalPending} ${stats.currency}`, color: 'var(--warning)' },
                { label: 'Vencido', value: `${stats.totalOverdue} ${stats.currency}`, color: 'var(--danger)' },
              ].map((kpi) => (
                <div key={kpi.label} className="card" style={{ padding: '1rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>{kpi.label}</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: kpi.color }}>{kpi.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Actions bar */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="btn-primary" disabled={generating} style={{ fontSize: '0.82rem' }}
              onClick={async () => {
                if (!token) return;
                setGenerating(true);
                try {
                  const result = await api.invoices.generateBulk(token);
                  const hasErrors = (result.errors?.length ?? 0) > 0;
                  const toastType = hasErrors && result.generated === 0 ? 'error' : hasErrors ? 'warning' : 'success';
                  toast(`Facturas generadas: ${result.generated}, omitidas: ${result.skipped}${hasErrors ? `, errores: ${result.errors.length}` : ''}`, toastType as any);
                  if (hasErrors) {
                    // Mostrar el detalle de errores para poder diagnosticar
                    const detail = result.errors.map((e: string, i: number) => `${i + 1}. ${e}`).join('\n');
                    alert(`Se detectaron ${result.errors.length} error(es) al generar facturas:\n\n${detail}\n\nRevisa que cada suscripción tenga plan asignado, tenant activo y un precio de plan > 0.`);
                  }
                  loadData();
                } catch (e: any) { toast(e.message || 'Error', 'error'); }
                setGenerating(false);
              }}>
              {generating ? 'Generando...' : 'Generar facturas del período'}
            </button>
            <button className="btn-ghost" style={{ fontSize: '0.82rem' }}
              onClick={async () => {
                if (!token) return;
                try {
                  const result = await api.invoices.sendReminders(token);
                  toast(`Recordatorios enviados: ${result.sent}`, 'success');
                } catch (e: any) { toast(e.message || 'Error', 'error'); }
              }}>
              Enviar recordatorios de vencimiento
            </button>
          </div>

          {/* Filters */}
          <div className="card" style={{ padding: '0.75rem', marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} style={{ fontSize: '0.82rem', maxWidth: '160px' }}>
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input" value={filterTenant} onChange={(e) => setFilterTenant(e.target.value)} style={{ fontSize: '0.82rem', maxWidth: '220px' }}>
              <option value="">Todas las organizaciones</option>
              {tenants.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input type="month" className="input" value={filterPeriod} onChange={(e) => setFilterPeriod(e.target.value)} style={{ fontSize: '0.82rem', maxWidth: '160px' }} />
            {(filterStatus || filterTenant || filterPeriod) && (
              <button className="btn-ghost" onClick={() => { setFilterStatus(''); setFilterTenant(''); setFilterPeriod(''); }} style={{ fontSize: '0.78rem', color: 'var(--danger)' }}>Limpiar</button>
            )}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>{invoices.length} factura(s)</span>
          </div>

          {/* Invoice table */}
          {invoices.length > 0 ? (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrapper" style={{ margin: 0 }}>
                <table>
                  <thead>
                    <tr>
                      <th>N° Factura</th>
                      <th>Organización</th>
                      <th>Período</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                      <th style={{ textAlign: 'right' }}>IVA</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      <th>Estado</th>
                      <th>Vencimiento</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv: any) => (
                      <tr key={inv.id}>
                        <td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: '0.82rem' }}>{inv.invoiceNumber}</td>
                        <td style={{ fontSize: '0.82rem' }}>{inv.tenant?.name || '—'}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {inv.periodStart ? new Date(inv.periodStart).toLocaleDateString('es-CL', { month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', fontSize: '0.82rem' }}>{Number(inv.subtotal).toFixed(2)}</td>
                        <td style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{Number(inv.taxAmount).toFixed(2)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.88rem' }}>{Number(inv.total).toFixed(2)} {inv.currency}</td>
                        <td>
                          <span style={{
                            fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                            background: `${STATUS_COLORS[inv.status] || '#94a3b8'}20`,
                            color: STATUS_COLORS[inv.status] || '#94a3b8',
                          }}>{STATUS_LABELS[inv.status] || inv.status}</span>
                        </td>
                        <td style={{ fontSize: '0.78rem', color: inv.status === 'overdue' ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('es-CL') : '—'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {/* Download PDF */}
                            <button className="btn-ghost" style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                              onClick={async () => {
                                if (!token) return;
                                try {
                                  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com'}/invoices/${inv.id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
                                  if (!res.ok) throw new Error('Error');
                                  const blob = await res.blob();
                                  const a = document.createElement('a');
                                  a.href = URL.createObjectURL(blob);
                                  a.download = `factura-${inv.invoiceNumber}.pdf`;
                                  a.click();
                                  URL.revokeObjectURL(a.href);
                                } catch { toast('Error al descargar PDF', 'error'); }
                              }}>PDF</button>
                            {/* Send email */}
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                              <button className="btn-ghost" style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                                disabled={sendingId === inv.id}
                                onClick={async () => {
                                  if (!token) return;
                                  setSendingId(inv.id);
                                  try {
                                    await api.invoices.send(token, inv.id);
                                    toast('Factura enviada por email', 'success');
                                    loadData();
                                  } catch (e: any) { toast(e.message || 'Error', 'error'); }
                                  setSendingId(null);
                                }}>{sendingId === inv.id ? '...' : 'Enviar'}</button>
                            )}
                            {/* Mark as paid */}
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                              <button style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                                onClick={() => { setPayModal(inv); setPayForm({ paymentMethod: 'transferencia', transactionRef: '', notes: '' }); }}>
                                Pagar
                              </button>
                            )}
                            {/* Cancel */}
                            {inv.status !== 'paid' && inv.status !== 'cancelled' && (
                              <button style={{ fontSize: '0.7rem', padding: '2px 6px', background: 'none', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 4, cursor: 'pointer' }}
                                onClick={async () => {
                                  if (!token || !confirm(`¿Cancelar factura ${inv.invoiceNumber}?`)) return;
                                  try {
                                    await api.invoices.cancel(token, inv.id);
                                    toast('Factura cancelada', 'success');
                                    loadData();
                                  } catch (e: any) { toast(e.message || 'Error', 'error'); }
                                }}>Anular</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'📄'}</p>
              <p>No hay facturas{filterStatus || filterTenant || filterPeriod ? ' con los filtros seleccionados' : '. Genere las facturas del período actual.'}.</p>
            </div>
          )}

          {/* Generate individual invoice */}
          {activeSubs.length > 0 && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Generar factura individual
              </summary>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                {activeSubs.map((s: any) => (
                  <button key={s.id} className="btn-ghost" style={{ fontSize: '0.78rem' }}
                    onClick={async () => {
                      if (!token) return;
                      try {
                        const inv = await api.invoices.generate(token, s.id);
                        toast(`Factura ${inv.invoiceNumber} generada`, 'success');
                        loadData();
                      } catch (e: any) { toast(e.message || 'Error', 'error'); }
                    }}>
                    {s.tenant?.name || s.tenantId?.slice(0, 8)} — {s.plan?.name || 'Plan'}
                  </button>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {/* ═══════ TAB: ESTADÍSTICAS ═══════ */}
      {tab === 'stats' && stats && (
        <div className="animate-fade-up">
          {/* KPIs grandes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Total Facturado (mes)', value: `${stats.totalInvoiced} ${stats.currency}`, icon: '📊' },
              { label: 'Total Cobrado', value: `${stats.totalPaid} ${stats.currency}`, icon: '✅' },
              { label: 'Pendiente de Cobro', value: `${stats.totalPending} ${stats.currency}`, icon: '⏳' },
              { label: 'Vencido', value: `${stats.totalOverdue} ${stats.currency}`, icon: '⚠️' },
              { label: 'Facturas del Mes', value: `${stats.invoiceCount}`, icon: '📄' },
            ].map((kpi) => (
              <div key={kpi.label} className="card" style={{ padding: '1.25rem' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '0.3rem' }}>{kpi.icon}</div>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>{kpi.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Evolution chart */}
          {stats.evolution?.length > 0 && (
            <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '1rem' }}>Evolución de Facturación (6 meses)</h3>
              <div style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.evolution}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="invoiced" name="Facturado" fill="#C9933A" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="paid" name="Cobrado" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Revenue breakdown */}
          {stats.revenueBreakdown && (
            <div className="card" style={{ padding: '1.25rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem' }}>Desglose de Ingresos (mes actual)</h3>
              <div style={{ display: 'flex', gap: '2rem' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Planes</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{stats.revenueBreakdown.plan} {stats.currency}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Add-ons IA</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent)' }}>{stats.revenueBreakdown.addon} {stats.currency}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: CONFIGURACIÓN ═══════ */}
      {tab === 'config' && (
        <div className="animate-fade-up">
          <div className="card" style={{ padding: '1.5rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>Datos del Emisor</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Razón Social</div>
                <div style={{ fontWeight: 600 }}>Eva360</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>RUT</div>
                <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>77.XXX.XXX-X</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Dirección</div>
                <div>Santiago, Chile</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Email</div>
                <div>facturacion@ascenda.cl</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '1.5rem', marginTop: '1rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '1rem' }}>Parámetros de Facturación</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Prefijo Numeración</div>
                <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>EVA-{new Date().getFullYear()}-XXXX</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Tasa IVA</div>
                <div style={{ fontWeight: 600 }}>19%</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Días de Vencimiento</div>
                <div style={{ fontWeight: 600 }}>15 días</div>
              </div>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
              Estos parámetros se aplican automáticamente al generar facturas. Para modificarlos, contacte al equipo de desarrollo.
            </p>
          </div>
        </div>
      )}

      {/* ═══════ MODAL: Marcar como pagada ═══════ */}
      {payModal && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div className="card" style={{ padding: '1.5rem', maxWidth: '460px', width: '90%' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>
              Registrar pago — {payModal.invoiceNumber}
            </h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Total: <strong>{Number(payModal.total).toFixed(2)} {payModal.currency}</strong> — {payModal.tenant?.name}
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Método de pago</label>
                <select className="input" value={payForm.paymentMethod} onChange={(e) => setPayForm({ ...payForm, paymentMethod: e.target.value })} style={{ fontSize: '0.82rem' }}>
                  <option value="transferencia">Transferencia bancaria</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="efectivo">Efectivo</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Referencia de transacción</label>
                <input className="input" value={payForm.transactionRef} onChange={(e) => setPayForm({ ...payForm, transactionRef: e.target.value })} placeholder="N° comprobante o referencia" style={{ fontSize: '0.82rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.2rem', textTransform: 'uppercase' }}>Notas</label>
                <input className="input" value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} placeholder="Opcional" style={{ fontSize: '0.82rem' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button className="btn-primary" disabled={paying}
                onClick={async () => {
                  if (!token) return;
                  setPaying(true);
                  try {
                    await api.invoices.markAsPaid(token, payModal.id, payForm);
                    toast('Pago registrado correctamente', 'success');
                    setPayModal(null);
                    loadData();
                  } catch (e: any) { toast(e.message || 'Error', 'error'); }
                  setPaying(false);
                }}
                style={{ fontSize: '0.82rem' }}>
                {paying ? 'Registrando...' : 'Confirmar pago'}
              </button>
              <button className="btn-ghost" onClick={() => setPayModal(null)} style={{ fontSize: '0.82rem' }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
