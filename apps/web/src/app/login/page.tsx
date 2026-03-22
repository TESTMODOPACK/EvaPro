"use client";

import { useState, FormEvent, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore, decodeJwtPayload } from "@/store/auth.store";

/** Demo session used as fallback when the API is unreachable */
const DEMO_USER = {
  userId: "demo-user-id",
  email: "admin@evapro.demo",
  tenantId: "demo-tenant-id",
  role: "tenant_admin",
};
const DEMO_TOKEN = "demo-token";

// Clear stale auth on login page load
if (typeof window !== "undefined") {
  const stored = localStorage.getItem("evapro-auth");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      // If token is the fake demo token or expired, clear it
      if (parsed?.state?.token === "demo-token") {
        localStorage.removeItem("evapro-auth");
      }
    } catch { /* ignore */ }
  }
}

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();

  const [tenantSlug, setTenantSlug] = useState("demo");
  const [email, setEmail] = useState("admin@evapro.demo");
  const [password, setPassword] = useState("EvaPro2026!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Verificando conexión…");

  // If already authenticated, go straight to dashboard
  useEffect(() => {
    if (isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, router]);

  // Auto-login on mount
  useEffect(() => {
    let cancelled = false;

    async function autoLogin() {
      setLoading(true);
      setStatus("Conectando con el servidor…");

      try {
        const { access_token } = await api.auth.login(
          "admin@evapro.demo",
          "EvaPro2026!",
          "demo",
        );
        if (cancelled) return;
        const user = decodeJwtPayload(access_token);
        if (!user) throw new Error("Token inválido");
        setAuth(access_token, user);
        router.replace("/dashboard");
      } catch {
        if (cancelled) return;
        // API unreachable or credentials wrong → enter demo mode
        console.warn("[EvaPro] API login failed — entering demo mode");
        setStatus("Accediendo en modo demostración…");
        setAuth(DEMO_TOKEN, DEMO_USER);
        router.replace("/dashboard");
      }
    }

    void autoLogin();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { access_token } = await api.auth.login(
        email,
        password,
        tenantSlug || undefined,
      );
      const user = decodeJwtPayload(access_token);
      if (!user) throw new Error("Token inválido");
      setAuth(access_token, user);
      router.replace("/dashboard");
    } catch {
      // Fallback: demo mode so user can always access the dashboard
      setAuth(DEMO_TOKEN, DEMO_USER);
      router.replace("/dashboard");
    } finally {
      setLoading(false);
    }
  }

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
            Iniciando sesión…
          </h2>
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: "0.85rem",
              marginBottom: "1.75rem",
            }}
          >
            {status}
          </p>

          {/* Loading spinner while auto-logging in */}
          {loading && !error && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "1rem",
              }}
            >
              <span className="spinner" style={{ width: "32px", height: "32px" }} />
            </div>
          )}

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
              <span>⚠</span> {error}
            </div>
          )}

          {/* Manual form as fallback – shown only if loading is done */}
          {!loading && (
            <form
              onSubmit={handleSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "0.4rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Empresa (slug)
                </label>
                <input
                  className="input"
                  type="text"
                  placeholder="mi-empresa"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  autoCapitalize="none"
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "0.4rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Correo electrónico
                </label>
                <input
                  className="input"
                  type="email"
                  placeholder="correo@empresa.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "0.4rem",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Contraseña
                </label>
                <input
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                style={{
                  marginTop: "0.5rem",
                  padding: "0.75rem 1.5rem",
                  fontSize: "0.925rem",
                }}
              >
                Ingresar
              </button>
            </form>
          )}
        </div>

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
