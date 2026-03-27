"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore, decodeJwtPayload } from "@/store/auth.store";
import { getRoleLabel } from "@/lib/roles";
import { formatRutInput, validateRut, normalizeRut } from "@/lib/rut";

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [tenantRut, setTenantRut] = useState("");
  const [rutError, setRutError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryTenant, setRecoveryTenant] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryStep, setRecoveryStep] = useState<"email" | "code">("email");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMsg, setRecoveryMsg] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      const stored = localStorage.getItem("evapro-auth");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.state?.token && parsed.state.token !== "demo-token") {
            router.replace("/dashboard");
            return;
          }
        } catch { /* ignore */ }
      }
      useAuthStore.getState().logout();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!email || !password) { setError("Ingresa tu correo y contrasena"); return; }
    const rutValue = tenantRut.trim();
    if (rutValue && !validateRut(rutValue)) { setRutError("RUT invalido. Verifique el formato y digito verificador."); return; }
    setLoading(true);
    try {
      const tenantIdentifier = rutValue ? normalizeRut(rutValue) : undefined;
      const { access_token } = await api.auth.login(email.trim(), password, tenantIdentifier);
      const user = decodeJwtPayload(access_token);
      if (!user) throw new Error("Token invalido");
      setAuth(access_token, user);
      router.replace("/dashboard");
    } catch (err: any) {
      if (err?.message?.includes("fetch") || err?.message?.includes("network")) {
        setError("No se pudo conectar al servidor. Intenta mas tarde.");
      } else {
        setError("Credenciales incorrectas. Verifica tu correo y contrasena.");
      }
    } finally {
      setLoading(false);
    }
  }

  const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://evaluacion-desempeno-api.onrender.com";

  async function handleRequestCode() {
    if (!recoveryEmail) { setRecoveryMsg("Ingresa tu correo electronico"); return; }
    setRecoveryLoading(true); setRecoveryMsg("");
    try {
      const res = await fetch(`${BASE_URL}/auth/request-reset`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail, tenantSlug: recoveryTenant || undefined }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || "Error"); }
      setRecoveryStep("code");
      setRecoveryMsg("Se envio un codigo a tu correo electronico.");
    } catch (err: any) { setRecoveryMsg(err.message || "Error al solicitar recuperacion"); }
    finally { setRecoveryLoading(false); }
  }

  async function handleResetPassword() {
    if (!recoveryCode || !newPassword) { setRecoveryMsg("Completa todos los campos"); return; }
    if (newPassword.length < 6) { setRecoveryMsg("La contrasena debe tener al menos 6 caracteres"); return; }
    setRecoveryLoading(true); setRecoveryMsg("");
    try {
      const res = await fetch(`${BASE_URL}/auth/reset-password`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail, code: recoveryCode, newPassword, tenantSlug: recoveryTenant || undefined }),
      });
      if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || "Codigo invalido"); }
      setRecoveryMsg("Contrasena actualizada. Ya puedes iniciar sesion.");
      setTimeout(() => { setShowRecovery(false); setRecoveryStep("email"); setRecoveryCode(""); setNewPassword(""); setRecoveryMsg(""); }, 2000);
    } catch (err: any) { setRecoveryMsg(err.message || "Error al restablecer contrasena"); }
    finally { setRecoveryLoading(false); }
  }

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: "0.8rem", fontWeight: 600,
    color: "var(--text-secondary)", marginBottom: "0.4rem",
    textTransform: "uppercase", letterSpacing: "0.05em",
  };

  const features = [
    "Evaluaciones 90, 180, 270 y 360 grados",
    "OKRs y objetivos SMART con Key Results",
    "Reportes avanzados con IA",
    "Planes de desarrollo individual (PDI)",
    "Feedback continuo y check-ins 1:1",
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

        {/* Logo icon — 7 growing bars */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", marginBottom: "1.5rem" }}>
          {[10, 16, 22, 30, 38, 48, 58].map((h, i) => (
            <div key={i} style={{
              width: "5px", height: `${h}px`, borderRadius: "2px",
              background: "linear-gradient(180deg, #F5E4A8 0%, #C9933A 60%, #6B4A18 100%)",
              opacity: 0.35 + i * 0.1,
            }} />
          ))}
        </div>

        <h1 style={{
          fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1,
          marginBottom: "0.5rem",
        }}>
          <span style={{ color: "#F5E4A8" }}>Ascenda</span>{" "}
          <span style={{
            background: "linear-gradient(135deg, #E8C97A 0%, #C9933A 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>Performance</span>
        </h1>

        <p style={{
          fontSize: "1.05rem", color: "rgba(245,228,168,0.6)",
          lineHeight: 1.5, marginBottom: "2.5rem", maxWidth: "360px",
        }}>
          Plataforma integral de evaluacion de desempeno para empresas que impulsan el talento de sus equipos.
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
          &copy; {new Date().getFullYear()} Ascenda Performance
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
              <label style={labelStyle}>RUT Empresa</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
                  </svg>
                </span>
                <input className="input" type="text" placeholder="Ej: 76.123.456-7" value={tenantRut}
                  onChange={(e) => { setTenantRut(formatRutInput(e.target.value)); setRutError(""); }}
                  autoCapitalize="none" autoComplete="organization" maxLength={12}
                  style={{ paddingLeft: "2.5rem" }}
                />
              </div>
              {rutError && <p style={{ color: "var(--danger)", fontSize: "0.78rem", marginTop: "0.25rem" }}>{rutError}</p>}
            </div>

            <div>
              <label style={labelStyle}>Email</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  </svg>
                </span>
                <input className="input" type="email" placeholder="correo@empresa.com" value={email}
                  onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus
                  style={{ paddingLeft: "2.5rem" }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Contrasena</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                </span>
                <input className="input" type={showPassword ? "text" : "password"} placeholder="••••••••" value={password}
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
              {loading ? "Verificando..." : "Iniciar sesion"}
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
              Olvidaste tu contrasena?
            </button>
          </div>
        </div>
      </div>

      {/* ─── Password Recovery Modal ─── */}
      {showRecovery && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowRecovery(false); }}>
          <div className="card" style={{ padding: "2rem", width: "100%", maxWidth: "400px" }}>
            <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>Recuperar contrasena</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
              {recoveryStep === "email" ? "Ingresa tu correo para recibir un codigo de recuperacion" : "Ingresa el codigo y tu nueva contrasena"}
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
                <div><label style={labelStyle}>Correo electronico</label><input className="input" type="email" placeholder="correo@empresa.com" value={recoveryEmail} onChange={(e) => setRecoveryEmail(e.target.value)} required /></div>
                <button className="btn-primary" onClick={handleRequestCode} disabled={recoveryLoading} style={{ padding: "0.65rem 1.25rem" }}>
                  {recoveryLoading ? "Enviando..." : "Enviar codigo"}
                </button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div><label style={labelStyle}>Codigo de recuperacion</label><input className="input" type="text" placeholder="Ej: 482910" value={recoveryCode} onChange={(e) => setRecoveryCode(e.target.value)} maxLength={6} style={{ letterSpacing: "0.3em", textAlign: "center", fontSize: "1.2rem", fontWeight: 700 }} /></div>
                <div><label style={labelStyle}>Nueva contrasena</label><input className="input" type="password" placeholder="Minimo 6 caracteres" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} /></div>
                <button className="btn-primary" onClick={handleResetPassword} disabled={recoveryLoading} style={{ padding: "0.65rem 1.25rem" }}>
                  {recoveryLoading ? "Guardando..." : "Restablecer contrasena"}
                </button>
                <button className="btn-ghost" onClick={() => { setRecoveryStep("email"); setRecoveryMsg(""); }} style={{ fontSize: "0.82rem" }}>Volver a solicitar codigo</button>
              </div>
            )}
            <button onClick={() => setShowRecovery(false)} style={{ marginTop: "1rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "0.82rem", cursor: "pointer", width: "100%", textAlign: "center" }}>Cancelar</button>
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
