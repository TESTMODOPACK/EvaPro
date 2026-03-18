"use client";

import { useState } from "react";
import { useAuthStore } from "@/store/auth.store";

export default function AjustesPage() {
  const { user } = useAuthStore();
  const [saved, setSaved] = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <div style={{ padding: "2rem 2.5rem", maxWidth: "800px" }}>
      <div className="animate-fade-up" style={{ marginBottom: "2rem" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 800,
            marginBottom: "0.25rem",
          }}
        >
          Ajustes
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
          Configura tu perfil y preferencias de la plataforma
        </p>
      </div>

      {/* Profile Section */}
      <div
        className="card animate-fade-up"
        style={{ padding: "1.75rem", marginBottom: "1.5rem" }}
      >
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: "0.25rem",
          }}
        >
          Perfil de usuario
        </h2>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.82rem",
            marginBottom: "1.5rem",
          }}
        >
          Información de tu cuenta en EvaPro
        </p>

        <form
          onSubmit={handleSave}
          style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "1rem",
            }}
          >
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.78rem",
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
                defaultValue={user?.email ?? "admin@evapro.demo"}
                readOnly
                style={{ opacity: 0.7, cursor: "not-allowed" }}
              />
            </div>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  marginBottom: "0.4rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Rol
              </label>
              <input
                className="input"
                type="text"
                defaultValue={user?.role ?? "admin"}
                readOnly
                style={{ opacity: 0.7, cursor: "not-allowed" }}
              />
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.4rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Nombre completo
            </label>
            <input
              className="input"
              type="text"
              placeholder="Tu nombre completo"
              defaultValue="Administrador"
            />
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.4rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Cargo
            </label>
            <input
              className="input"
              type="text"
              placeholder="Ej. Director de RRHH"
              defaultValue="Director de Recursos Humanos"
            />
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              paddingTop: "0.5rem",
            }}
          >
            <button type="submit" className="btn-primary">
              Guardar cambios
            </button>
            {saved && (
              <span
                style={{
                  color: "var(--success)",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                }}
              >
                ✓ Cambios guardados
              </span>
            )}
          </div>
        </form>
      </div>

      {/* Notifications Section */}
      <div
        className="card animate-fade-up-delay-1"
        style={{ padding: "1.75rem", marginBottom: "1.5rem" }}
      >
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: "0.25rem",
          }}
        >
          Notificaciones
        </h2>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.82rem",
            marginBottom: "1.5rem",
          }}
        >
          Controla qué notificaciones recibes
        </p>

        {[
          { label: "Nuevas evaluaciones asignadas", defaultChecked: true },
          { label: "Recordatorios de evaluación pendiente", defaultChecked: true },
          { label: "Resultados de evaluación disponibles", defaultChecked: true },
          { label: "Resumen semanal de actividad", defaultChecked: false },
          { label: "Actualizaciones del sistema", defaultChecked: false },
        ].map((item) => (
          <label
            key={item.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.6rem 0",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              fontSize: "0.875rem",
              color: "var(--text-primary)",
            }}
          >
            <input
              type="checkbox"
              defaultChecked={item.defaultChecked}
              style={{
                width: "16px",
                height: "16px",
                accentColor: "var(--accent)",
              }}
            />
            {item.label}
          </label>
        ))}
      </div>

      {/* Security Section */}
      <div className="card animate-fade-up-delay-2" style={{ padding: "1.75rem" }}>
        <h2
          style={{
            fontSize: "1rem",
            fontWeight: 700,
            marginBottom: "0.25rem",
          }}
        >
          Seguridad
        </h2>
        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "0.82rem",
            marginBottom: "1.5rem",
          }}
        >
          Gestiona la seguridad de tu cuenta
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.4rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Nueva contraseña
            </label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label
              style={{
                display: "block",
                fontSize: "0.78rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.4rem",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Confirmar contraseña
            </label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
            />
          </div>
          <div>
            <button className="btn-primary">Cambiar contraseña</button>
          </div>
        </div>
      </div>
    </div>
  );
}
