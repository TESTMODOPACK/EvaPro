'use client';

import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useCurrentUser, useUpdateUser } from '@/hooks/useUsers';
import { getRoleLabel } from '@/lib/roles';
import { formatRut } from '@/lib/rut';
import { useLocaleStore, SupportedLocale } from '@/store/locale.store';
import { useAuthStore } from '@/store/auth.store';
import { api } from '@/lib/api';
import { useToastStore } from '@/store/toast.store';

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.78rem', fontWeight: 600,
  color: 'var(--text-secondary)', marginBottom: '0.4rem',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};

const readOnlyStyle: React.CSSProperties = { opacity: 0.7, cursor: 'not-allowed' };

export default function PerfilPage() {
  const { t } = useTranslation();
  const { data: user, isLoading, refetch } = useCurrentUser();
  const updateUser = useUpdateUser();
  const { locale, setLocale } = useLocaleStore();
  const token = useAuthStore((s) => s.token);

  const [langSaved, setLangSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [cvUploading, setCvUploading] = useState(false);
  const [cvDeleting, setCvDeleting] = useState(false);
  const cvInputRef = useRef<HTMLInputElement>(null);
  const toast = useToastStore((s) => s.toast);

  const handleLanguageChange = async (lang: SupportedLocale) => {
    setLocale(lang);
    if (user?.id && token) {
      try { await api.users.update(token, user.id, { language: lang }); } catch {}
    }
    setLangSaved(true);
    setTimeout(() => setLangSaved(false), 2000);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    if (!user?.id || !newPassword) return;
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPasswordError('Debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.');
      return;
    }
    try {
      await updateUser.mutateAsync({ id: user.id, data: { currentPassword, newPassword } });
      setPasswordSaved(true);
      setCurrentPassword('');
      setNewPassword('');
      setTimeout(() => setPasswordSaved(false), 3000);
    } catch (err: any) {
      setPasswordError(err.message || 'Error al cambiar contraseña');
    }
  };

  if (isLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '900px' }}>
      <div className="animate-fade-up" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.25rem' }}>Mi Perfil</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Información personal y preferencias de tu cuenta.
        </p>
      </div>

      <div className="animate-fade-up" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Language */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            {t('settings.language.title')}
          </h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {(['es', 'en', 'pt'] as SupportedLocale[]).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => handleLanguageChange(lang)}
                style={{
                  padding: '0.5rem 1rem', borderRadius: 'var(--radius-sm, 6px)', fontSize: '0.85rem',
                  fontWeight: locale === lang ? 700 : 500, cursor: 'pointer',
                  background: locale === lang ? 'var(--accent)' : 'var(--bg-surface)',
                  color: locale === lang ? '#fff' : 'var(--text-secondary)',
                  border: locale === lang ? 'none' : '1px solid var(--border)',
                  transition: 'all 0.15s',
                }}
              >
                {{ es: '🇨🇱 Español', en: '🇺🇸 English', pt: '🇧🇷 Português' }[lang]}
              </button>
            ))}
          </div>
          {langSaved && (
            <p style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600, marginTop: '0.5rem' }}>
              {t('settings.language.saved')}
            </p>
          )}
        </div>

        {/* Profile info — all read-only */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '1rem' }}>
            {t('settings.profile.title')}
          </h2>
          <div className="mobile-single-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={labelStyle}>Nombres</label>
              <input className="input" type="text" value={user?.firstName || ''} readOnly style={readOnlyStyle} />
            </div>
            <div>
              <label style={labelStyle}>Apellidos</label>
              <input className="input" type="text" value={user?.lastName || ''} readOnly style={readOnlyStyle} />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.profile.email')}</label>
              <input className="input" type="email" value={user?.email || ''} readOnly style={readOnlyStyle} />
            </div>
            <div>
              <label style={labelStyle}>RUT</label>
              <input className="input" type="text"
                value={(user as any)?.rut ? formatRut((user as any).rut) : 'No registrado'}
                readOnly style={{ ...readOnlyStyle, fontFamily: 'monospace' }} />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.profile.role')}</label>
              <input className="input" type="text" value={user?.role ? getRoleLabel(user.role) : ''} readOnly style={readOnlyStyle} />
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              <input className="input" type="text" value={user?.position || 'Sin cargo asignado'} readOnly style={readOnlyStyle} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                El cargo es gestionado por el administrador de tu organización.
              </span>
            </div>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '1rem 0 0' }}>
            Los datos personales (nombres, apellidos, RUT, cargo) son gestionados por el administrador de tu organización.
          </p>
        </div>

        {/* CV Upload */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>Curriculum Vitae</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Sube tu CV en formato PDF o Word. Es opcional y se usa en procesos de selección interna.
          </p>
          {user?.cvUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.65rem 0.85rem', background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.15)', borderRadius: 'var(--radius-sm)' }}>
              <span style={{ fontSize: '1.2rem' }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.cvFileName || 'CV adjunto'}</div>
                <a href={user.cvUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>
                  Ver / Descargar →
                </a>
              </div>
              <button
                className="btn-ghost"
                disabled={cvDeleting}
                style={{ fontSize: '0.75rem', color: 'var(--danger)' }}
                onClick={async () => {
                  setCvDeleting(true);
                  try {
                    await api.users.deleteCv(token!);
                    toast('CV eliminado', 'success');
                    refetch();
                  } catch { toast('Error al eliminar', 'error'); }
                  setCvDeleting(false);
                }}
              >
                {cvDeleting ? '...' : 'Eliminar'}
              </button>
            </div>
          ) : (
            <div>
              <input
                ref={cvInputRef}
                type="file"
                accept=".pdf,.doc,.docx"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file || !token) return;
                  setCvUploading(true);
                  try {
                    await api.users.uploadCv(token, file);
                    toast('CV subido correctamente', 'success');
                    refetch();
                  } catch (err: any) { toast(err.message || 'Error al subir', 'error'); }
                  setCvUploading(false);
                  if (cvInputRef.current) cvInputRef.current.value = '';
                }}
              />
              <button
                className="btn-ghost"
                disabled={cvUploading}
                onClick={() => cvInputRef.current?.click()}
                style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <span>📎</span> {cvUploading ? 'Subiendo...' : 'Subir CV (PDF o Word)'}
              </button>
            </div>
          )}
        </div>

        {/* Change password */}
        <div className="card" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            {t('settings.security.title')}
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
            {t('settings.security.subtitle')}
          </p>
          <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '400px' }}>
            <div>
              <label style={labelStyle}>{t('settings.security.currentPassword')}</label>
              <input className="input" type="password" placeholder="••••••••" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('settings.security.newPassword')}</label>
              <input className="input" type="password" placeholder="••••••••" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button type="submit" className="btn-primary" disabled={!currentPassword || !newPassword} style={{ opacity: !currentPassword || !newPassword ? 0.5 : 1 }}>
                {t('settings.security.changePassword')}
              </button>
              {passwordSaved && <span style={{ color: 'var(--success)', fontSize: '0.82rem', fontWeight: 600 }}>{t('settings.security.passwordSaved')}</span>}
              {passwordError && <span style={{ color: 'var(--danger)', fontSize: '0.82rem', fontWeight: 600 }}>{passwordError}</span>}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
