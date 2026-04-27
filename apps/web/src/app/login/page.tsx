"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { useAuthStore, decodeJwtPayload, decodeJwtExpMs } from "@/store/auth.store";
import { formatRutInput, validateRut, normalizeRut } from "@/lib/rut";
import PasswordStrengthMeter from "@/components/PasswordStrengthMeter";
import PasswordInput from "@/components/PasswordInput";
import { usePasswordPolicyForEmail } from "@/hooks/usePasswordPolicy";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [tenantRut, setTenantRut] = useState("");
  const [rutError, setRutError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [showForceChange, setShowForceChange] = useState(false);
  const [show2FA, setShow2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  // Campo editable "Contraseña actual" dentro del modal de cambio forzado.
  // Arranca prellenado con el password que el usuario usó para loguearse
  // (state `password`), pero puede corregirse si fuera distinto — p. ej.
  // si la entidad que creó al usuario puso una temporal diferente.
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [changePwdLoading, setChangePwdLoading] = useState(false);
  const [changePwdMsg, setChangePwdMsg] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryTenant, setRecoveryTenant] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryStep, setRecoveryStep] = useState<"email" | "code">("email");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState("");

  // Fetch the tenant-scoped password policy when the force-change modal opens.
  // Keyed by email so the modal shows the ACTIVE rules (not defaults) even
  // before the user has a session token.
  const { policy: forceChangePolicy } = usePasswordPolicyForEmail(
    showForceChange ? email : null,
    tenantRut.trim() ? normalizeRut(tenantRut.trim()) : undefined,
  );

  // SSO discovery state — populated when the user types an email that maps
  // to a tenant with SSO enabled. When `ssoLoginUrl` is set we show a "Login
  // with SSO" button instead of the password field.
  const [ssoDiscoverUrl, setSsoDiscoverUrl] = useState<string | null>(null);
  const [ssoDiscoverOrg, setSsoDiscoverOrg] = useState<string>('');

  useEffect(() => {
    // Debounce the discover call so we don't hit the backend on every
    // keystroke. 500ms feels natural for an email field.
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setSsoDiscoverUrl(null);
      setSsoDiscoverOrg('');
      return;
    }
    const handle = setTimeout(() => {
      const tenantIdentifier = tenantRut.trim() ? normalizeRut(tenantRut.trim()) : undefined;
      api.sso
        .discover(trimmed.toLowerCase(), tenantIdentifier)
        .then((res) => {
          if (res.ssoEnabled && res.ssoLoginUrl) {
            setSsoDiscoverUrl(res.ssoLoginUrl);
            setSsoDiscoverOrg(res.tenantName || '');
          } else {
            setSsoDiscoverUrl(null);
            setSsoDiscoverOrg('');
          }
        })
        .catch(() => {
          setSsoDiscoverUrl(null);
        });
    }, 500);
    return () => clearTimeout(handle);
  }, [email, tenantRut]);

  // SSO callback: the IdP redirects to /login?sso_token=xxx. If present,
  // finish the session client-side and navigate to the dashboard.
  // F3 Fase 2: el SSO callback en backend YA seteo la cookie httpOnly
  // antes del redirect. El token en la URL se usa SOLO para extraer
  // user info (decodeJwtPayload) — no se guarda en localStorage.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('sso_token');
    if (!token) return;
    const user = decodeJwtPayload(token);
    const expMs = decodeJwtExpMs(token);
    if (user && expMs) {
      setAuth(user, expMs);
      router.replace('/dashboard');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError(t('login.errors.required')); return; }
    const rutValue = tenantRut.trim();
    if (rutValue && !validateRut(rutValue)) { setRutError(t('login.errors.invalidRut')); return; }
    setLoading(true);
    try {
      const tenantIdentifier = rutValue ? normalizeRut(rutValue) : undefined;
      const loginPayload: any = { email: email.trim(), password, tenantSlug: tenantIdentifier };
      if (show2FA && twoFactorCode) loginPayload.twoFactorCode = twoFactorCode;

      const result = await api.auth.login(loginPayload.email, loginPayload.password, loginPayload.tenantSlug, loginPayload.twoFactorCode);
      const { access_token, mustChangePassword, requires2FA, requiresSso, loginUrl } = result as any;

      // Tenant forces SSO — redirect to the provider immediately.
      if (requiresSso && loginUrl) {
        window.location.href = loginUrl;
        return;
      }

      // 2FA required — show code input
      if (requires2FA) {
        setShow2FA(true);
        setLoading(false);
        return;
      }

      // F3 Fase 2: la cookie httpOnly ya esta seteada por el backend.
      // El access_token del body se usa SOLO para extraer user info y
      // exp — NO se persiste en JS.
      const user = decodeJwtPayload(access_token);
      const expMs = decodeJwtExpMs(access_token);
      if (!user) {
        // mustChangePassword path: no token issued, we still want the modal.
        if (mustChangePassword) {
          setCurrentPwd(password);
          setShowForceChange(true);
          setLoading(false);
          return;
        }
        throw new Error("Token inválido");
      }

      if (mustChangePassword) {
        // Prefill el campo "Contraseña actual" con lo que el usuario acaba
        // de tipear para loguearse — es lo esperado en la UX normal, pero
        // queda editable por si la temporal era distinta.
        setCurrentPwd(password);
        setShowForceChange(true);
        setLoading(false);
        return;
      }

      if (!expMs) {
        throw new Error("Token sin claim exp");
      }
      setAuth(user, expMs);
      router.replace("/dashboard");
    } catch (err: any) {
      if (err?.message?.includes("fetch") || err?.message?.includes("network")) {
        setError("No se pudo conectar al servidor. Intenta más tarde.");
      } else {
        setError(t('login.errors.invalidCredentials'));
      }
    } finally {
      setLoading(false);
    }
  }

  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://evaluacion-desempeno-api.onrender.com";

  async function handleRequestCode() {
    if (!recoveryEmail) { setRecoveryMsg("Ingresa tu correo electrónico"); return; }
    setRecoveryLoading(true); setRecoveryMsg("");
    try {
      const res = await fetch(`${BASE_URL}/auth/request-reset`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail, tenantSlug: recoveryTenant || undefined }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || "Error"); }
      setRecoveryStep("code");
      setRecoveryMsg("Se envió un código a tu correo electrónico.");
    } catch (err: any) { setRecoveryMsg(err.message || "Error al solicitar recuperación"); }
    finally { setRecoveryLoading(false); }
  }

  async function handleResetPassword() {
    if (!recoveryCode || !newPassword) { setRecoveryMsg("Completa todos los campos"); return; }
    if (newPassword.length < 6) { setRecoveryMsg("La contraseña debe tener al menos 6 caracteres"); return; }
    setRecoveryLoading(true); setRecoveryMsg("");
    try {
      const res = await fetch(`${BASE_URL}/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail, code: recoveryCode, newPassword, tenantSlug: recoveryTenant || undefined }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || "Código inválido"); }
      setRecoveryMsg("Contraseña actualizada. Ya puedes iniciar sesión.");
      setTimeout(() => { setShowRecovery(false); setRecoveryStep("email"); setRecoveryCode(""); setNewPassword(""); setRecoveryMsg(""); }, 2000);
    } catch (err: any) { setRecoveryMsg(err.message || "Error al restablecer contraseña"); }
    finally { setRecoveryLoading(false); }
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.8rem", fontWeight: 600,
    color: "var(--text-secondary)", marginBottom: "0.4rem",
    textTransform: "uppercase", letterSpacing: "0.05em",
  };

  const features = [
    "Evaluaciones de desempeño 90°, 180°, 270° y 360°",
    "Objetivos y OKRs con seguimiento de Key Results",
    "Análisis e informes con Inteligencia Artificial",
    "Encuestas de clima laboral y eNPS",
    "Selección de personal con análisis de CV por IA",
    "Planes de desarrollo individual (PDI) y organizacional",
    "Reconocimientos, gamificación e insignias",
    "Dashboard ejecutivo con indicadores estratégicos",
  ];

  return (
    <main style={{ minHeight: "100vh", display: "flex" }}>
      {/* ─── Left Panel: Branding ─── */}
      <div style={{
        width: "45%", minHeight: "100vh",
        background: "linear-gradient(160deg, #08090B 0%, #1a1206 50%, #0d0d0d 100%)",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "3rem 3.5rem", position: "relative", overflow: "hidden",
      }}
        className="login-left-panel"
      >
        {/* Subtle gold glow */}
        <div style={{
          position: "absolute", top: "-20%", right: "-30%",
          width: "500px", height: "500px",
          background: "radial-gradient(circle, rgba(201,147,58,0.08) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{
          position: "absolute", bottom: "-10%", left: "-20%",
          width: "400px", height: "400px",
          background: "radial-gradient(circle, rgba(201,147,58,0.05) 0%, transparent 70%)",
          pointerEvents: "none",
        }} />

        {/* Eva360 logo */}
        <img
          src="/eva360-logo.png"
          alt="Eva360"
          style={{ height: '150px', width: 'auto', objectFit: 'contain', marginBottom: '1.5rem' }}
        />

        <p style={{
          fontSize: "1.05rem", color: "rgba(245,228,168,0.6)",
          lineHeight: 1.5, marginBottom: "2.5rem", maxWidth: "360px",
        }}>
          Plataforma integral de evaluación de desempeño para empresas que impulsan el talento de sus equipos.
        </p>

        {/* Features list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          {features.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <div style={{
                width: "20px", height: "20px", borderRadius: "50%",
                background: "rgba(201,147,58,0.15)", border: "1px solid rgba(201,147,58,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#C9933A" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <span style={{ fontSize: "0.88rem", color: "rgba(245,228,168,0.75)" }}>{f}</span>
            </div>
          ))}
        </div>

        {/* Bottom copyright */}
        <p style={{
          position: "absolute", bottom: "2rem", left: "3.5rem",
          fontSize: "0.72rem", color: "rgba(201,147,58,0.35)",
        }}>
          &copy; {new Date().getFullYear()} Eva360
        </p>
      </div>

      {/* ─── Right Panel: Login Form ─── */}
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: "2rem", background: "var(--bg-base)", position: "relative",
      }}>
        <div className="animate-fade-up" style={{ width: "100%", maxWidth: "400px" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.25rem", color: "var(--text-primary)" }}>
            Acceso seguro
          </h2>
          <p style={{ color: "var(--text-muted)", fontSize: "0.88rem", marginBottom: "2rem" }}>
            Ingresa tus credenciales para continuar.
          </p>

          {error && (
            <div style={{
              padding: "0.75rem 1rem", background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius-sm)",
              color: "var(--danger)", fontSize: "0.85rem", marginBottom: "1.25rem",
              display: "flex", alignItems: "center", gap: "0.5rem",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.15rem" }}>
            <div>
              <label htmlFor="login-email" style={labelStyle}>{t('login.email')}</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </span>
                <input id="login-email" className="input" type="email" placeholder="correo@empresa.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus
                  style={{ paddingLeft: "2.5rem" }}
                />
              </div>
            </div>

            {/* SSO discovery banner — shown when the email's domain has an
                 active IdP configured for the tenant. Offers a one-click
                 redirect instead of asking for a password. */}
            {ssoDiscoverUrl && (
              <div
                style={{
                  padding: '0.75rem 1rem',
                  background: 'rgba(201,147,58,0.08)',
                  border: '1px solid rgba(201,147,58,0.3)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', flex: 1, minWidth: 0 }}>
                  {ssoDiscoverOrg
                    ? `${ssoDiscoverOrg} usa inicio de sesión único (SSO).`
                    : 'Tu organización tiene SSO configurado.'}
                </div>
                <a
                  href={ssoDiscoverUrl}
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                    textDecoration: 'none',
                    padding: '0.45rem 0.9rem',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                  }}
                >
                  Iniciar con SSO →
                </a>
              </div>
            )}

            <div>
              <label htmlFor="login-password" style={labelStyle}>{t('login.password')}</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input id="login-password" className="input" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password}
                  onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
                  style={{ paddingLeft: "2.5rem", paddingRight: "2.5rem" }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}
                  style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: "0.25rem", display: "flex", alignItems: "center" }}>
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* 2FA Code input — shown when server requires it */}
            {show2FA && (
              <div>
                <label htmlFor="login-2fa" style={labelStyle}>Código de autenticación (2FA)</label>
                <input id="login-2fa" className="input" type="text" placeholder="123456" value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  maxLength={6} autoComplete="one-time-code" autoFocus
                  style={{ letterSpacing: '0.3em', textAlign: 'center', fontSize: '1.1rem', fontWeight: 700 }}
                />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Ingresa el código de 6 dígitos de tu app autenticadora (Google Authenticator, Authy, etc.)
                </p>
              </div>
            )}

            <button type="submit" disabled={loading} style={{
              marginTop: "0.5rem", padding: "0.8rem 1.5rem", fontSize: "0.925rem",
              display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
              background: "linear-gradient(135deg, var(--gold) 0%, var(--gold-light) 100%)",
              color: "#1a1206", fontWeight: 700, border: "none", borderRadius: "var(--radius)",
              cursor: loading ? "wait" : "pointer", transition: "var(--transition)",
              boxShadow: "0 2px 12px rgba(201,147,58,0.25)",
              opacity: loading ? 0.7 : 1,
            }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.boxShadow = "0 4px 20px rgba(201,147,58,0.4)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 2px 12px rgba(201,147,58,0.25)"; }}
            >
              {loading && <span className="spinner" style={{ width: "18px", height: "18px", borderColor: "rgba(26,18,6,0.3)", borderTopColor: "#1a1206" }} />}
              {loading ? t('login.loggingIn') : t('login.loginBtn')}
              {!loading && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                </svg>
              )}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: "1.25rem" }}>
            <button type="button"
              onClick={() => { setShowRecovery(true); setRecoveryMsg(""); setRecoveryStep("email"); }}
              style={{ background: "none", border: "none", color: "var(--gold)", fontSize: "0.85rem", cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
            >
              {t('login.forgotPassword')}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Password Recovery Modal ─── */}
      {showRecovery && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowRecovery(false); }}>
          <div className="card" style={{ padding: "2rem", width: "100%", maxWidth: "400px" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Recuperar contraseña</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              {recoveryStep === "email" ? "Ingresa tu correo para recibir un código de recuperación" : "Ingresa el código y tu nueva contraseña"}
            </p>
            {recoveryMsg && (
              <div style={{
                padding: "0.6rem 0.8rem",
                background: recoveryMsg.includes("envio") || recoveryMsg.includes("actualizada") ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${recoveryMsg.includes("envio") || recoveryMsg.includes("actualizada") ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                borderRadius: "var(--radius-sm)",
                color: recoveryMsg.includes("envio") || recoveryMsg.includes("actualizada") ? "#10b981" : "var(--danger)",
                fontSize: "0.82rem", marginBottom: "1rem",
              }}>{recoveryMsg}</div>
            )}
            {recoveryStep === "email" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div><label style={labelStyle}>RUT Empresa</label><input className="input" type="text" placeholder="Ej: 76.123.456-7" value={recoveryTenant} onChange={(e) => setRecoveryTenant(formatRutInput(e.target.value))} maxLength={12} /></div>
                <div><label style={labelStyle}>Correo electrónico</label><input className="input" type="email" placeholder="correo@empresa.com" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} required /></div>
                <button className="btn-primary" onClick={handleRequestCode} disabled={recoveryLoading} style={{ padding: "0.65rem 1.25rem" }}>
                  {recoveryLoading ? "Enviando..." : "Enviar código"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div><label style={labelStyle}>Código de recuperación</label><input className="input" type="text" placeholder="Ej: 482910" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} maxLength={6} style={{ letterSpacing: "0.3em", textAlign: "center", fontSize: "1.2rem", fontWeight: 700 }} /></div>
                <div><label style={labelStyle}>Nueva contraseña</label><input className="input" type="password" placeholder="Mínimo 6 caracteres" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} /></div>
                <button className="btn-primary" onClick={handleResetPassword} disabled={recoveryLoading} style={{ padding: "0.65rem 1.25rem" }}>
                  {recoveryLoading ? "Guardando..." : "Restablecer contraseña"}
                </button>
                <button className="btn-ghost" onClick={() => { setRecoveryStep("email"); setRecoveryMsg(""); }} style={{ fontSize: "0.82rem" }}>Volver a solicitar código</button>
              </div>
            )}
            <button onClick={() => setShowRecovery(false)} style={{ marginTop: "1rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.82rem", cursor: "pointer", width: "100%", textAlign: "center" }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ─── Force Password Change Modal ─── */}
      {showForceChange && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}>
          <div className="card" style={{ padding: "2rem", width: "100%", maxWidth: "420px" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Cambiar contraseña</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              Por seguridad, debes cambiar tu contraseña temporal antes de continuar.
            </p>
            {changePwdMsg && (
              <div style={{
                padding: "0.6rem 0.8rem", marginBottom: "1rem", borderRadius: "var(--radius-sm)",
                background: changePwdMsg.includes("exitosa") ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)",
                border: `1px solid ${changePwdMsg.includes("exitosa") ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                color: changePwdMsg.includes("exitosa") ? "#10b981" : "var(--danger)",
                fontSize: "0.82rem",
              }}>{changePwdMsg}</div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={labelStyle}>Contraseña actual</label>
                <PasswordInput
                  className="input"
                  value={currentPwd}
                  onChange={setCurrentPwd}
                  placeholder="La que usaste para entrar"
                  autoComplete="current-password"
                  disabled={changePwdLoading}
                />
                <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Verificamos que coincida con la que tienes guardada antes de cambiarla.
                </p>
              </div>
              <div>
                <label style={labelStyle}>Nueva contraseña</label>
                <PasswordInput
                  className="input"
                  value={newPwd}
                  onChange={setNewPwd}
                  placeholder="Escribe tu nueva contraseña"
                  autoComplete="new-password"
                  disabled={changePwdLoading}
                />
                {/* Authoritative rules come from the backend per-tenant
                    policy; client-side rendering is purely informative. */}
                <PasswordStrengthMeter password={newPwd} policy={forceChangePolicy} />
              </div>
              <div>
                <label style={labelStyle}>Confirmar contraseña</label>
                <PasswordInput
                  className="input"
                  value={confirmPwd}
                  onChange={setConfirmPwd}
                  placeholder="Repetir nueva contraseña"
                  autoComplete="new-password"
                  disabled={changePwdLoading}
                />
                {newPwd && confirmPwd && newPwd !== confirmPwd && (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--danger)' }}>
                    Las contraseñas no coinciden.
                  </div>
                )}
              </div>
              <button className="btn-primary" disabled={changePwdLoading || !currentPwd || !newPwd || !confirmPwd}
                style={{ padding: "0.7rem 1.5rem", opacity: changePwdLoading ? 0.6 : 1 }}
                onClick={async () => {
                  setChangePwdMsg('');
                  if (!currentPwd) { setChangePwdMsg('Ingresa tu contraseña actual'); return; }
                  if (newPwd !== confirmPwd) { setChangePwdMsg('Las contraseñas no coinciden'); return; }
                  // Policy validation on the server is authoritative — we
                  // just catch obvious empty-input UX issues here.
                  if (newPwd.length < forceChangePolicy.minLength) {
                    setChangePwdMsg(`La contraseña debe tener al menos ${forceChangePolicy.minLength} caracteres.`);
                    return;
                  }
                  setChangePwdLoading(true);
                  try {
                    const tenantIdentifier = tenantRut.trim() ? normalizeRut(tenantRut.trim()) : undefined;
                    await api.auth.changePassword(email.trim(), currentPwd, newPwd, tenantIdentifier);
                    setChangePwdMsg('Contraseña actualizada exitosamente. Iniciando sesión...');
                    // Now login again with new password
                    setTimeout(async () => {
                      try {
                        const result = await api.auth.login(email.trim(), newPwd, tenantIdentifier);
                        const { access_token } = result as any;
                        const user = decodeJwtPayload(access_token);
                        const expMs = decodeJwtExpMs(access_token);
                        if (user && expMs) { setAuth(user, expMs); router.replace("/dashboard"); }
                      } catch { setChangePwdMsg('Contraseña cambiada. Por favor inicia sesión nuevamente.'); setShowForceChange(false); }
                    }, 1500);
                  } catch (err: any) {
                    setChangePwdMsg(err.message || 'Error al cambiar contraseña');
                  } finally {
                    setChangePwdLoading(false);
                  }
                }}
              >
                {changePwdLoading ? "Guardando..." : "Cambiar contraseña"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Responsive: hide left panel on mobile */}
      <style>{`
        @media (max-width: 768px) {
          .login-left-panel { display: none !important; }
        }
      `}</style>
    </main>
  );
}
