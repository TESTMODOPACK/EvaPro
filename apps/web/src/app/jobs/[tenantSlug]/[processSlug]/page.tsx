/**
 * S7.1 — Job board publico.
 *
 * Pagina sin auth donde candidatos externos pueden auto-postular a un
 * proceso external + active publicado por su tenant_admin.
 *
 * Notas de implementacion:
 *   - Client component (`'use client'`) — cargamos via fetch al backend
 *     para que el render dependa de datos en runtime (proceso podria
 *     cambiar de status entre publish y view).
 *   - No expone APIs de auth — usa fetch directo a /public/jobs.
 *   - Form simple HTML5: required + email validation. CV opcional v1
 *     (se puede subir luego via admin desde el detalle).
 *   - Tras submit OK muestra mensaje de confirmacion en la misma vista
 *     (no redirige) para no perder contexto si el candidato quiere
 *     compartir el link de nuevo.
 */
'use client';

import { useEffect, useState } from 'react';
import { use } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://evaluacion-desempeno-api.onrender.com';

export default function PublicJobPage({ params }: { params: Promise<{ tenantSlug: string; processSlug: string }> }) {
  const { tenantSlug, processSlug } = use(params);
  const [job, setJob] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [linkedIn, setLinkedIn] = useState('');
  const [coverLetter, setCoverLetter] = useState('');
  const [cvBase64, setCvBase64] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch(`${API_URL}/public/jobs/${tenantSlug}/${processSlug}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({} as any));
          throw new Error(body.message || 'Esta postulacion no esta disponible.');
        }
        return r.json();
      })
      .then((j) => { if (mounted) setJob(j); })
      .catch((e: any) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [tenantSlug, processSlug]);

  const handleCvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setSubmitError('El CV no puede exceder 5MB.');
      return;
    }
    if (file.type !== 'application/pdf') {
      setSubmitError('Solo PDF permitido.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCvBase64(reader.result as string);
      setSubmitError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      setSubmitError('Debe aceptar el tratamiento de datos personales para postular.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(`${API_URL}/public/jobs/${tenantSlug}/${processSlug}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          linkedIn: linkedIn.trim() || undefined,
          coverLetter: coverLetter.trim() || undefined,
          cvUrl: cvBase64 || undefined,
        }),
      });
      const body = await r.json().catch(() => ({} as any));
      if (!r.ok) throw new Error(body.message || 'No se pudo enviar la postulacion.');
      setSubmitted(true);
    } catch (err: any) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <p>Cargando…</p>
        </div>
      </main>
    );
  }
  if (error || !job) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Postulación no disponible</h1>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>{error || 'Esta postulación ya cerró o no existe.'}</p>
        </div>
      </main>
    );
  }
  if (submitted) {
    return (
      <main style={pageStyle}>
        <div style={cardStyle}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: '#10b981' }}>✓ Postulación recibida</h1>
          <p style={{ color: '#444', fontSize: '0.95rem', lineHeight: 1.5 }}>
            Gracias <strong>{firstName}</strong>. Hemos recibido tu postulación para el cargo de
            <strong> {job.title} </strong>en {job.tenantName}. Revisaremos tu CV y te contactaremos
            pronto si avanzas en el proceso.
          </p>
          <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '1rem' }}>
            Confirmación enviada a <strong>{email}</strong>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        <h1 style={{ fontSize: '1.6rem', marginBottom: '0.3rem' }}>{job.title}</h1>
        <div style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.7rem' }}>
          {job.tenantName} · {job.position}
          {job.department ? ` · ${job.department}` : ''}
        </div>
        {job.description && (
          <div style={{ fontSize: '0.9rem', color: '#333', lineHeight: 1.6, marginBottom: '1.2rem', whiteSpace: 'pre-wrap' }}>
            {job.description}
          </div>
        )}
        {Array.isArray(job.requirements) && job.requirements.length > 0 && (
          <div style={{ marginBottom: '1.2rem' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>Requisitos</h2>
            <ul style={{ paddingLeft: '1.2rem', fontSize: '0.88rem', color: '#444' }}>
              {job.requirements.map((r: any, i: number) => (
                <li key={i} style={{ marginBottom: '0.2rem' }}>{r.text || r}</li>
              ))}
            </ul>
          </div>
        )}
        <hr style={{ margin: '1rem 0', border: 'none', borderTop: '1px solid #eee' }} />
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.6rem' }}>Postular</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <Field label="Nombres" required>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required style={inputStyle} />
            </Field>
            <Field label="Apellidos" required>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} required style={inputStyle} />
            </Field>
          </div>
          <Field label="Email" required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={inputStyle} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <Field label="Teléfono">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="LinkedIn">
              <input type="url" placeholder="https://linkedin.com/in/..." value={linkedIn} onChange={(e) => setLinkedIn(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Field label="Carta de presentación (opcional)">
            <textarea
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              rows={4}
              maxLength={4000}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="Cuéntanos por qué te interesa este cargo..."
            />
          </Field>
          <Field label="CV en PDF (opcional, max 5MB)">
            <input type="file" accept=".pdf" onChange={handleCvUpload} />
            {cvBase64 && <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '0.2rem' }}>✓ CV cargado</div>}
          </Field>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', fontSize: '0.78rem', color: '#444', marginTop: '0.5rem' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Acepto el tratamiento de mis datos personales para fines de evaluación de esta postulación,
              en cumplimiento de la Ley 19.628 (Chile). Los datos se conservan por 24 meses post-cierre del proceso.
            </span>
          </label>
          {submitError && (
            <div style={{ padding: '0.5rem 0.7rem', background: '#fee', color: '#c00', borderRadius: 6, fontSize: '0.85rem' }}>
              {submitError}
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !consent}
            style={{
              padding: '0.7rem 1rem',
              background: submitting || !consent ? '#ccc' : '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: submitting || !consent ? 'default' : 'pointer',
              marginTop: '0.5rem',
            }}
          >
            {submitting ? 'Enviando…' : 'Enviar postulación'}
          </button>
        </form>
      </div>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f5f5f7',
  padding: '2rem 1rem',
  display: 'flex',
  justifyContent: 'center',
};
const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 720,
  background: '#fff',
  padding: '2rem',
  borderRadius: 12,
  boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.7rem',
  fontSize: '0.92rem',
  border: '1px solid #ddd',
  borderRadius: 6,
  outline: 'none',
};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem' }}>
      <span style={{ fontWeight: 600, color: '#444' }}>
        {label}
        {required && <span style={{ color: '#c00', marginLeft: 2 }}>*</span>}
      </span>
      {children}
    </label>
  );
}
