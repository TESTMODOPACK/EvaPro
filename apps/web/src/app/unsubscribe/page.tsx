"use client";

/**
 * Public unsubscribe page — reached via email footer link
 * `/unsubscribe?token=xxx`. No auth required; identity comes from the
 * signed HMAC token in the URL.
 *
 * States rendered (in order of validation):
 *   1. `loading`   — spinner while POST /public/unsubscribe/validate runs
 *   2. `error`     — invalid / expired token (generic CTA to log in)
 *   3. `form`      — toggles per category + "save" / "unsubscribe all"
 *   4. `saved`     — confirmation with link back to the app
 *   5. `all`       — confirmation after "unsubscribe all"
 */

import { useEffect, useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

// Must match NOTIFICATION_CATEGORIES in apps/api/src/common/types/jsonb-schemas.ts.
// Order controls display order in the UI; descriptions are user-visible.
const CATEGORIES: Array<{ key: string; label: string; description: string }> = [
  {
    key: "evaluations",
    label: "Evaluaciones",
    description: "Ciclos lanzados, recordatorios y resultados disponibles.",
  },
  {
    key: "feedback",
    label: "Feedback y check-ins",
    description: "Feedback recibido, check-ins agendados, rechazos.",
  },
  {
    key: "objectives",
    label: "Objetivos (OKR)",
    description: "Objetivos asignados, en riesgo y completados.",
  },
  {
    key: "recognitions",
    label: "Reconocimientos",
    description: "Reconocimientos públicos que te envían tus compañeros.",
  },
  {
    key: "development",
    label: "Desarrollo",
    description: "PDI asignado, acciones vencidas, iniciativas organizacionales.",
  },
  {
    key: "surveys",
    label: "Encuestas de clima",
    description: "Invitaciones a responder encuestas de clima organizacional.",
  },
  {
    key: "digests",
    label: "Resúmenes semanales",
    description: "Resumen cada lunes con pendientes de tu semana.",
  },
  {
    key: "pending_reviews",
    label: "Revisiones pendientes",
    description: "Aprobaciones de plantillas y competencias propuestas.",
  },
];

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "form";
      email: string;
      firstName: string;
      orgName: string;
      preferences: Record<string, boolean>;
      saving: boolean;
      message: string | null;
    }
  | { kind: "saved"; message: string };

function UnsubscribePageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setState({ kind: "error", message: "Este enlace no es válido." });
        return;
      }
      try {
        const res = await api.publicUnsubscribe.validate(token);
        if (cancelled) return;
        setState({
          kind: "form",
          email: res.email,
          firstName: res.firstName,
          orgName: res.orgName,
          // Defensive: coerce anything non-boolean to a boolean. `true` is the
          // default per our contract; the backend should already return
          // fully-populated preferences, but we do not trust it blindly.
          preferences: Object.fromEntries(
            CATEGORIES.map((c) => [c.key, res.preferences?.[c.key] !== false]),
          ),
          saving: false,
          message: null,
        });
      } catch (err: any) {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            err?.message && typeof err.message === "string"
              ? err.message
              : "Este enlace ha expirado o no es válido.",
        });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        padding: "2rem 1rem",
      }}
    >
      <div
        style={{
          maxWidth: 560,
          width: "100%",
          background: "#ffffff",
          borderRadius: 16,
          boxShadow: "0 10px 40px rgba(15,23,42,0.08)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg,#0a0b0e 0%,#1a1208 100%)",
            padding: "24px 32px",
            textAlign: "center",
          }}
        >
          <span
            style={{
              color: "#E8C97A",
              fontSize: "1.3rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
            }}
          >
            Eva
            <span style={{ color: "#ffffff", fontWeight: 400 }}>360</span>
          </span>
        </div>

        <div style={{ padding: "32px 36px 36px" }}>
          {state.kind === "loading" && <LoadingView />}
          {state.kind === "error" && <ErrorView message={state.message} />}
          {state.kind === "form" && (
            <FormView state={state} token={token} setState={setState} />
          )}
          {state.kind === "saved" && <SavedView message={state.message} />}
        </div>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  // Next.js App Router requires useSearchParams() to be wrapped in a Suspense
  // boundary at the page level.
  return (
    <Suspense fallback={null}>
      <UnsubscribePageInner />
    </Suspense>
  );
}

function LoadingView() {
  return (
    <div style={{ textAlign: "center", padding: "2rem 0" }}>
      <p style={{ color: "#64748b", fontSize: "0.9rem" }}>Validando enlace…</p>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <h1
        style={{
          fontSize: "1.35rem",
          fontWeight: 700,
          color: "#0f172a",
          margin: "0 0 0.75rem",
        }}
      >
        Enlace inválido o expirado
      </h1>
      <p
        style={{
          color: "#64748b",
          fontSize: "0.92rem",
          lineHeight: 1.6,
          margin: "0 0 1.5rem",
        }}
      >
        {message} Para gestionar tus preferencias de notificación, inicia sesión
        en la plataforma.
      </p>
      <a
        href="/login"
        style={{
          display: "inline-block",
          background: "#C9933A",
          color: "#ffffff",
          textDecoration: "none",
          padding: "12px 28px",
          borderRadius: 10,
          fontSize: "0.9rem",
          fontWeight: 600,
        }}
      >
        Ir a Eva360 →
      </a>
    </div>
  );
}

function SavedView({ message }: { message: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontSize: "2.2rem",
          marginBottom: "0.5rem",
        }}
      >
        ✓
      </div>
      <h1
        style={{
          fontSize: "1.25rem",
          fontWeight: 700,
          color: "#0f172a",
          margin: "0 0 0.75rem",
        }}
      >
        {message}
      </h1>
      <p
        style={{
          color: "#64748b",
          fontSize: "0.9rem",
          lineHeight: 1.6,
          margin: "0 0 1.5rem",
        }}
      >
        Seguirás recibiendo correos transaccionales necesarios (recuperación de
        contraseña, firmas, invitaciones).
      </p>
      <a
        href="/login"
        style={{
          display: "inline-block",
          background: "#C9933A",
          color: "#ffffff",
          textDecoration: "none",
          padding: "12px 28px",
          borderRadius: 10,
          fontSize: "0.9rem",
          fontWeight: 600,
        }}
      >
        Ir a Eva360 →
      </a>
    </div>
  );
}

function FormView({
  state,
  token,
  setState,
}: {
  state: Extract<State, { kind: "form" }>;
  token: string;
  setState: (s: State) => void;
}) {
  const orgLine = useMemo(
    () =>
      state.orgName ? `en ${state.orgName}` : "en Eva360",
    [state.orgName],
  );

  function toggle(key: string) {
    setState({
      ...state,
      preferences: { ...state.preferences, [key]: !state.preferences[key] },
      message: null,
    });
  }

  async function onSave() {
    setState({ ...state, saving: true, message: null });
    try {
      await api.publicUnsubscribe.update(token, state.preferences);
      setState({
        kind: "saved",
        message: "Preferencias actualizadas",
      });
    } catch (err: any) {
      setState({
        ...state,
        saving: false,
        message:
          err?.message && typeof err.message === "string"
            ? err.message
            : "No pudimos guardar tus preferencias. Intenta más tarde.",
      });
    }
  }

  async function onUnsubscribeAll() {
    if (
      !confirm(
        "¿Confirmas que quieres darte de baja de TODOS los correos opcionales? Seguirás recibiendo correos transaccionales necesarios.",
      )
    ) {
      return;
    }
    setState({ ...state, saving: true, message: null });
    try {
      await api.publicUnsubscribe.unsubscribeAll(token);
      setState({
        kind: "saved",
        message: "Te has dado de baja de todos los correos opcionales",
      });
    } catch (err: any) {
      setState({
        ...state,
        saving: false,
        message:
          err?.message && typeof err.message === "string"
            ? err.message
            : "No pudimos procesar tu solicitud. Intenta más tarde.",
      });
    }
  }

  return (
    <>
      <h1
        style={{
          fontSize: "1.35rem",
          fontWeight: 700,
          color: "#0f172a",
          margin: "0 0 0.35rem",
        }}
      >
        Preferencias de notificaciones
      </h1>
      <p
        style={{
          color: "#64748b",
          fontSize: "0.88rem",
          lineHeight: 1.6,
          margin: "0 0 1.5rem",
        }}
      >
        Hola <strong>{state.firstName || state.email}</strong>, elige qué correos
        quieres seguir recibiendo {orgLine}.
      </p>

      <div
        style={{
          background: "#f8fafc",
          borderRadius: 10,
          padding: "12px 14px",
          marginBottom: "1.5rem",
          fontSize: "0.82rem",
          color: "#334155",
          border: "1px solid #e2e8f0",
        }}
      >
        Cuenta: <strong>{state.email}</strong>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {CATEGORIES.map((cat) => {
          const checked = state.preferences[cat.key] !== false;
          return (
            <label
              key={cat.key}
              style={{
                display: "flex",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                background: checked ? "#ffffff" : "#f8fafc",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(cat.key)}
                style={{ marginTop: 3, accentColor: "#C9933A", width: 18, height: 18 }}
              />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: "#0f172a",
                    fontSize: "0.9rem",
                    marginBottom: 2,
                  }}
                >
                  {cat.label}
                </div>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "#64748b",
                    lineHeight: 1.5,
                  }}
                >
                  {cat.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      {state.message && (
        <div
          style={{
            marginTop: "1.25rem",
            background: "rgba(239,68,68,0.08)",
            borderLeft: "4px solid #ef4444",
            padding: "10px 14px",
            borderRadius: "0 8px 8px 0",
            color: "#991b1b",
            fontSize: "0.85rem",
          }}
        >
          {state.message}
        </div>
      )}

      <div
        style={{
          marginTop: "1.75rem",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button
          onClick={onUnsubscribeAll}
          disabled={state.saving}
          style={{
            background: "transparent",
            color: "#64748b",
            border: "none",
            padding: "10px 14px",
            fontSize: "0.82rem",
            cursor: state.saving ? "not-allowed" : "pointer",
            textDecoration: "underline",
          }}
        >
          Darse de baja de todo
        </button>
        <button
          onClick={onSave}
          disabled={state.saving}
          style={{
            background: state.saving ? "#cbd5e1" : "#C9933A",
            color: "#ffffff",
            border: "none",
            padding: "12px 28px",
            borderRadius: 10,
            fontSize: "0.9rem",
            fontWeight: 600,
            cursor: state.saving ? "not-allowed" : "pointer",
          }}
        >
          {state.saving ? "Guardando…" : "Guardar preferencias"}
        </button>
      </div>

      <p
        style={{
          marginTop: "1.75rem",
          fontSize: "0.72rem",
          color: "#94a3b8",
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Seguirás recibiendo correos transaccionales necesarios (recuperación de
        contraseña, códigos de firma, invitaciones a tu cuenta).
      </p>
    </>
  );
}
