"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore, decodeJwtPayload } from "@/store/auth.store";
import { getRoleLabel } from "@/lib/roles";

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [tenantSlug, setTenantSlug] = useState("");
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

  // If already authenticated with a real token, go straight to dashboard
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
      // Clear stale demo tokens
      useAuthStore.getState().logout();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Ingresa tu correo y contraseña");
      return;
    }

    setLoading(true);
    try {
      const { access_token } = await api.auth.login(
        email.trim(),
        password,
        tenantSlug.trim() || undefined,
      );
      const user = decodeJwtPayload(access_token);
      if (!user) throw new Error("Token inválido");
      setAuth(access_token, user);
      router.replace("/dashboard");
    } catch (err: any) {
      if (err?.message?.includes("fetch") || err?.message?.includes("network")) {
        setError("No se pudo conectar al servidor. Intenta más tarde.");
      } else {
        setError("Credenciales incorrectas. Verifica tu correo y contraseña.");
      }
    } finally {
      setLoading(false);
    }
  }

  const BASE_URL =
    process.env.NEXT_PUBLIC_API_URL ||
    "https://evaluacion-desempeno-api.onrender.com";

  async function handleRequestCode() {
    if (!recoveryEmail) { setRecoveryMsg("Ingresa tu correo electrónico"); return; }
    setRecoveryLoading(true);
    setRecoveryMsg("");
    try {
      const res = await fetch(`${BASE_URL}/auth/request-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail, tenantSlug: recoveryTenant || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Error al solicitar recuperación");
      }
      setRecoveryStep("code");
      setRecoveryMsg("Se envió un código a tu correo electrónico.");
    } catch (err: any) {
      setRecoveryMsg(err.message || "Error al solicitar recuperación");
    } finally {
      setRecoveryLoading(false);
    }
  }

  async function handleResetPassword() {
    if (!recoveryCode || !newPassword) { setRecoveryMsg("Completa todos los campos"); return; }
    if (newPassword.length < 6) { setRecoveryMsg("La contraseña debe tener al menos 6 caracteres"); return; }
    setRecoveryLoading(true);
    setRecoveryMsg("");
    try {
      const res = await fetch(`${BASE_URL}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recoveryEmail, code: recoveryCode, newPassword, tenantSlug: recoveryTenant || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || "Código inválido o expirado");
      }
      setRecoveryMsg("Contraseña actualizada. Ya puedes iniciar sesión.");
      setTimeout(() => {
        setShowRecovery(false);
        setRecoveryStep("email");
        setRecoveryCode("");
        setNewPassword("");
        setRecoveryMsg("");
      }, 2000);
    } catch (err: any) {
      setRecoveryMsg(err.message || "Error al restablecer contraseña");
    } finally {
      setRecoveryLoading(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.4rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Background gradient blobs */}
      <div
        style={{
          position: "absolute",
          top: "-15%",
          left: "-10%",
          width: "600px",
          height: "600px",
          background:
            "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-20%",
          right: "-10%",
          width: "500px",
          height: "500px",
          background:
            "radial-gradient(circle, rgba(16,185,129,0.1) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div className="animate-fade-up" style={{ width: "100%", maxWidth: "420px" }}>
        {/* Logo / Header */}
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "56px",
              height: "56px",
              borderRadius: "1rem",
              background:
                "linear-gradient(135deg, var(--accent), var(--accent-hover))",
              marginBottom: "1rem",
              boxShadow: "var(--shadow-glow)",
            }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "var(--text-primary)",
            }}
          >
            Eva<span style={{ color: "var(--accent-hover)" }}>Pro</span>
          </h1>
          <p
            style={{
              color: "var(--text-secondary)",
              marginTop: "0.25rem",
              fontSize: "0.9rem",
            }}
          >
            Evaluación de Desempeño
          </p>
        </div>

        {/* Card */}
        <div className="card glass" style={{ padding: "2rem" }}>
          <h2
            style={{
              fontWeight: 700,
              marginBottom: "0.25rem",
              fontSize: "1.15rem",
            }}
          >
            Iniciar sesión
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.85rem",
              marginBottom: "1.75rem",
            }}
          >
            Ingresa tus credenciales para acceder al sistema
          </p>

          {error && (
            <div
              style={{
                padding: "0.75rem 1rem",
                background: "rgba(239,68,68,0.12)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "var(--radius-sm)",
                color: "var(--danger)",
                fontSize: "0.85rem",
                marginBottom: "1.25rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div>
              <label style={labelStyle}>Empresa</label>
              <input
                className="input"
                type="text"
                placeholder="slug de tu empresa (ej: demo)"
                value={tenantSlug}
                onChange={(e) => setTenantSlug(e.target.value)}
                autoCapitalize="none"
                autoComplete="organization"
              />
            </div>

            <div>
              <label style={labelStyle}>Correo electrónico</label>
              <input
                className="input"
                type="email"
                placeholder="correo@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div>
              <label style={labelStyle}>Contraseña</label>
              <div style={{ position: "relative" }}>
                <input
                  className="input"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ paddingRight: "2.5rem" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "0.6rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    padding: "0.25rem",
                    display: "flex",
                    alignItems: "center",
                  }}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
              style={{
                marginTop: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.925rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
              }}
            >
              {loading && <span className="spinner" style={{ width: "18px", height: "18px" }} />}
              {loading ? "Verificando…" : "Ingresar"}
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: "1rem" }}>
            <button
              type="button"
              onClick={() => { setShowRecovery(true); setRecoveryMsg(""); setRecoveryStep("email"); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--accent)",
                fontSize: "0.85rem",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </div>
        </div>

        {/* Password Recovery Modal */}
        {showRecovery && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "1rem",
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowRecovery(false); }}
          >
            <div className="card" style={{ padding: "2rem", width: "100%", maxWidth: "400px" }}>
              <h3 style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: "0.25rem" }}>
                Recuperar contraseña
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>
                {recoveryStep === "email"
                  ? "Ingresa tu correo para recibir un código de recuperación"
                  : "Ingresa el código que recibiste y tu nueva contraseña"}
              </p>

              {recoveryMsg && (
                <div style={{
                  padding: "0.6rem 0.8rem",
                  background: recoveryMsg.includes("envió") || recoveryMsg.includes("actualizada")
                    ? "rgba(16,185,129,0.12)"
                    : "rgba(239,68,68,0.12)",
                  border: `1px solid ${recoveryMsg.includes("envió") || recoveryMsg.includes("actualizada") ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`,
                  borderRadius: "var(--radius-sm)",
                  color: recoveryMsg.includes("envió") || recoveryMsg.includes("actualizada") ? "#10b981" : "var(--danger)",
                  fontSize: "0.82rem",
                  marginBottom: "1rem",
                }}>
                  {recoveryMsg}
                </div>
              )}

              {recoveryStep === "email" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={labelStyle}>Empresa</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="slug de tu empresa"
                      value={recoveryTenant}
                      onChange={(e) => setRecoveryTenant(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Correo electrónico</label>
                    <input
                      className="input"
                      type="email"
                      placeholder="correo@empresa.com"
                      value={recoveryEmail}
                      onChange={(e) => setRecoveryEmail(e.target.value)}
                      required
                    />
                  </div>
                  <button
                    className="btn-primary"
                    onClick={handleRequestCode}
                    disabled={recoveryLoading}
                    style={{ padding: "0.65rem 1.25rem" }}
                  >
                    {recoveryLoading ? "Enviando..." : "Enviar código"}
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={labelStyle}>Código de recuperación</label>
                    <input
                      className="input"
                      type="text"
                      placeholder="Ej: 482910"
                      value={recoveryCode}
                      onChange={(e) => setRecoveryCode(e.target.value)}
                      maxLength={6}
                      style={{ letterSpacing: "0.3em", textAlign: "center", fontSize: "1.2rem", fontWeight: 700 }}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Nueva contraseña</label>
                    <input
                      className="input"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      minLength={6}
                    />
                  </div>
                  <button
                    className="btn-primary"
                    onClick={handleResetPassword}
                    disabled={recoveryLoading}
                    style={{ padding: "0.65rem 1.25rem" }}
                  >
                    {recoveryLoading ? "Guardando..." : "Restablecer contraseña"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => { setRecoveryStep("email"); setRecoveryMsg(""); }}
                    style={{ fontSize: "0.82rem" }}
                  >
                    Volver a solicitar código
                  </button>
                </div>
              )}

              <button
                onClick={() => setShowRecovery(false)}
                style={{
                  marginTop: "1rem",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  width: "100%",
                  textAlign: "center",
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        <p
          style={{
            textAlign: "center",
            marginTop: "1.5rem",
            fontSize: "0.8rem",
            color: "var(--text-muted)",
          }}
        >
          © {new Date().getFullYear()} EvaPro · Todos los derechos reservados
        </p>
      </div>
    </main>
  );
}
