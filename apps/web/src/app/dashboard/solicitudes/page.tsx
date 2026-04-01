'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';

const CATEGORIES = [
  { value: 'nuevo_desarrollo', icon: '🚀' },
  { value: 'mejora_funcionalidad', icon: '✨' },
  { value: 'soporte_tecnico', icon: '🔧' },
  { value: 'ampliacion_plan', icon: '📈' },
  { value: 'reporte_error', icon: '🐛' },
  { value: 'consulta_general', icon: '💬' },
];

const STATUS_BADGE: Record<string, string> = {
  open: 'badge-warning', in_review: 'badge-accent', responded: 'badge-success', closed: 'badge-ghost',
};

export default function SolicitudesPage() {
  const { t } = useTranslation();
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const isSuperAdmin = role === 'super_admin';

  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ category: 'consulta_general', subject: '', description: '', priority: 'normal' });
  const [saving, setSaving] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [responseText, setResponseText] = useState('');
  const [responding, setResponding] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ name: string; size?: number; type?: string; data?: string; url?: string }>>([]);
  const [responseAttachments, setResponseAttachments] = useState<Array<{ name: string; size?: number; type?: string; data?: string; url?: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit for base64 in DB

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, target: 'ticket' | 'response') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      setUploadError(`El archivo excede el límite de 5MB (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
      setTimeout(() => setUploadError(''), 5000);
      e.target.value = '';
      return;
    }

    setUploading(true);
    try {
      // Convert file to base64 and store in DB (no Cloudinary dependency)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Error al leer el archivo'));
        reader.readAsDataURL(file);
      });

      const attachment = {
        name: file.name,
        size: file.size,
        type: file.type,
        data: base64, // data:application/pdf;base64,... or data:image/png;base64,...
      };

      if (target === 'ticket') {
        setAttachments(prev => [...prev, attachment]);
      } else {
        setResponseAttachments(prev => [...prev, attachment]);
      }
      setUploadError('');
    } catch (err: any) {
      setUploadError(err.message || 'Error al procesar el archivo');
      setTimeout(() => setUploadError(''), 5000);
    }
    e.target.value = '';
    setUploading(false);
  };

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const loadFn = isSuperAdmin ? api.tenants.listAllTickets : api.tenants.listTickets;
    loadFn(token).then(setTickets).catch(() => []).finally(() => setLoading(false));
  }, [token, isSuperAdmin]);

  const handleCreate = async () => {
    if (!token || !form.subject.trim() || !form.description.trim()) return;
    setSaving(true);
    try {
      const created = await api.tenants.createTicket(token, { ...form, attachments: attachments.length > 0 ? attachments : undefined });
      setTickets(prev => [created, ...prev]);
      setForm({ category: 'consulta_general', subject: '', description: '', priority: 'normal' });
      setAttachments([]);
      setShowCreate(false);
    } catch {}
    setSaving(false);
  };

  const handleRespond = async () => {
    if (!token || !selectedTicket || !responseText.trim()) return;
    setResponding(true);
    try {
      const updated = await api.tenants.respondTicket(token, selectedTicket.id, responseText, 'responded', responseAttachments.length > 0 ? responseAttachments : undefined);
      setTickets(prev => prev.map(t => t.id === updated.id ? updated : t));
      setSelectedTicket(updated);
      setResponseText('');
      setResponseAttachments([]);
    } catch {}
    setResponding(false);
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1000px' }}>
      {/* Header */}
      <div className="animate-fade-up" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>
            {t('solicitudes.title')}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            {isSuperAdmin ? t('solicitudes.subtitleAdmin') : t('solicitudes.subtitle')}
          </p>
        </div>
        {!isSuperAdmin && (
          <button className="btn-primary" style={{ fontSize: '0.85rem' }} onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? t('common.cancel') : t('solicitudes.newTicket')}
          </button>
        )}
      </div>

      {/* Create form (tenant_admin only) */}
      {showCreate && !isSuperAdmin && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <h3 style={{ fontWeight: 700, fontSize: '1rem', margin: '0 0 1rem' }}>{t('solicitudes.createTitle')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('solicitudes.category')}
              </label>
              <select className="input" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.icon} {t(`solicitudes.cat.${c.value}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {t('solicitudes.priority')}
              </label>
              <select className="input" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
                <option value="low">{t('solicitudes.priorityLow')}</option>
                <option value="normal">{t('solicitudes.priorityNormal')}</option>
                <option value="high">{t('solicitudes.priorityHigh')}</option>
                <option value="urgent">{t('solicitudes.priorityUrgent')}</option>
              </select>
            </div>
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('solicitudes.subject')}
            </label>
            <input className="input" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}
              placeholder={t('solicitudes.subjectPlaceholder')} />
          </div>
          <div style={{ marginBottom: '0.75rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.35rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t('solicitudes.description')}
            </label>
            <textarea className="input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder={t('solicitudes.descriptionPlaceholder')} rows={4} style={{ resize: 'vertical' }} />
          </div>
          {/* Attachments */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <label style={{
                padding: '0.35rem 0.85rem', borderRadius: 'var(--radius-sm)', fontSize: '0.78rem',
                border: '1px dashed var(--border)', cursor: 'pointer', color: 'var(--text-secondary)',
              }}>
                {uploading ? 'Subiendo...' : '📎 Adjuntar archivo'}
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={e => handleFileUpload(e, 'ticket')} style={{ display: 'none' }} />
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>PDF, Word, Excel, imágenes</span>
            </div>
            {attachments.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {attachments.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', padding: '0.3rem 0.6rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)' }}>
                    <a href={a.data || a.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', flex: 1 }}>{a.name}</a>
                    <button type="button" onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn-primary" disabled={saving || !form.subject.trim() || !form.description.trim()} onClick={handleCreate}>
            {saving ? t('common.saving') : t('solicitudes.send')}
          </button>
        </div>
      )}

      {/* Ticket detail (selected) */}
      {selectedTicket && (
        <div className="card animate-fade-up" style={{ padding: '1.75rem', marginBottom: '1.5rem', borderLeft: '4px solid var(--accent)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <h3 style={{ fontWeight: 700, fontSize: '1rem', margin: '0 0 0.25rem' }}>{selectedTicket.subject}</h3>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`badge ${STATUS_BADGE[selectedTicket.status] || 'badge-ghost'}`} style={{ fontSize: '0.72rem' }}>
                  {t(`solicitudes.status.${selectedTicket.status}`)}
                </span>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {t(`solicitudes.cat.${selectedTicket.category}`)}
                </span>
                {isSuperAdmin && selectedTicket.tenant && (
                  <span style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 600 }}>{selectedTicket.tenant.name}</span>
                )}
              </div>
            </div>
            <button className="btn-ghost" style={{ fontSize: '0.82rem' }} onClick={() => setSelectedTicket(null)}>
              {t('common.close')}
            </button>
          </div>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.6, marginBottom: '1rem', whiteSpace: 'pre-wrap' }}>
            {selectedTicket.description}
          </p>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            {t('solicitudes.createdBy')}: {selectedTicket.creator?.firstName} {selectedTicket.creator?.lastName} · {new Date(selectedTicket.createdAt).toLocaleDateString('es-CL')}
          </div>

          {/* Ticket attachments */}
          {selectedTicket.attachments?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
              {selectedTicket.attachments.map((a: any, i: number) => (
                <a key={i} href={a.data || a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.6rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>
                  {'📎'} {a.name}
                </a>
              ))}
            </div>
          )}

          {/* Response */}
          {selectedTicket.response && (
            <div style={{ padding: '1rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', borderLeft: '3px solid var(--success)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.3rem' }}>{t('solicitudes.responseLabel')}</div>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap' }}>{selectedTicket.response}</p>
              {selectedTicket.responseAttachments?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                  {selectedTicket.responseAttachments.map((a: any, i: number) => (
                    <a key={i} href={a.data || a.url} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.6rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', color: 'var(--success)', textDecoration: 'none' }}>
                      {'📎'} {a.name}
                    </a>
                  ))}
                </div>
              )}
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                {selectedTicket.respondedAt && new Date(selectedTicket.respondedAt).toLocaleDateString('es-CL')}
              </div>
            </div>
          )}

          {/* Super admin: respond form */}
          {isSuperAdmin && selectedTicket.status !== 'closed' && (
            <div>
              <textarea className="input" value={responseText} onChange={e => setResponseText(e.target.value)}
                placeholder={t('solicitudes.responsePlaceholder')} rows={3} style={{ resize: 'vertical', marginBottom: '0.5rem' }} />
              {/* Response attachments */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <label style={{
                  padding: '0.3rem 0.7rem', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem',
                  border: '1px dashed var(--border)', cursor: 'pointer', color: 'var(--text-secondary)',
                }}>
                  {uploading ? 'Subiendo...' : '📎 Adjuntar'}
                  <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" onChange={e => handleFileUpload(e, 'response')} style={{ display: 'none' }} />
                </label>
                {responseAttachments.map((a, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.5rem', background: 'rgba(201,147,58,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', color: 'var(--accent)' }}>
                    {a.name}
                    <button type="button" onClick={() => setResponseAttachments(prev => prev.filter((_, idx) => idx !== i))}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.8rem' }}>×</button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-primary" disabled={responding || !responseText.trim()} onClick={handleRespond}>
                  {responding ? t('common.saving') : t('solicitudes.respond')}
                </button>
                <button className="btn-ghost" onClick={async () => {
                  if (!token) return;
                  try {
                    // Use status-only update if no response was given, otherwise close with existing response
                    const closeResponse = selectedTicket.response || 'Solicitud cerrada sin respuesta adicional.';
                    await api.tenants.respondTicket(token, selectedTicket.id, closeResponse, 'closed');
                    setTickets(prev => prev.map(t => t.id === selectedTicket.id ? { ...t, status: 'closed' } : t));
                    setSelectedTicket({ ...selectedTicket, status: 'closed' });
                  } catch {}
                }}>
                  {t('solicitudes.closeTicket')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tickets list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}><span className="spinner" /></div>
      ) : tickets.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{'📋'}</p>
          <p>{t('solicitudes.empty')}</p>
        </div>
      ) : (
        <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {tickets.filter((ticket: any) => ticket.id !== selectedTicket?.id).map((ticket: any) => (
            <div key={ticket.id} className="card" onClick={() => { setSelectedTicket(ticket); setResponseText(''); setResponseAttachments([]); setUploadError(''); }}
              style={{ padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'box-shadow 0.15s' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                  <span>{CATEGORIES.find(c => c.value === ticket.category)?.icon || '📋'}</span>
                  <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{ticket.subject}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {t(`solicitudes.cat.${ticket.category}`)}
                  {isSuperAdmin && ticket.tenant && ` · ${ticket.tenant.name}`}
                  {` · ${new Date(ticket.createdAt).toLocaleDateString('es-CL')}`}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {ticket.response && <span style={{ color: 'var(--success)', fontSize: '0.78rem' }}>{'✓'}</span>}
                <span className={`badge ${STATUS_BADGE[ticket.status] || 'badge-ghost'}`} style={{ fontSize: '0.7rem' }}>
                  {t(`solicitudes.status.${ticket.status}`)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
