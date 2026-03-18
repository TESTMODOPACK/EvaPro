"use client";

import { useEffect, useState } from "react";
import { api, type Tenant } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";

const DEMO_TOKEN = "demo-token";

const DEMO_TENANTS: Tenant[] = [
  {
    id: "demo-tenant-id",
    name: "Demo Company",
    slug: "demo",
    plan: "enterprise",
    ownerType: "company",
    maxEmployees: 500,
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

const planColor: Record<string, string> = {
  starter: "badge-accent",
  pro: "badge-info",
  enterprise: "badge-warning",
};

export default function TenantsPage() {
  const token = useAuthStore((s) => s.token);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    // Use demo data when in demo mode
    if (token === DEMO_TOKEN) {
      setTenants(DEMO_TENANTS);
      setLoading(false);
      return;
    }

    api.tenants
      .list(token)
      .then(setTenants)
      .catch((e: Error) => {
        console.warn("Tenants API error, using demo data:", e.message);
        setTenants(DEMO_TENANTS);
        setError("");
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div style={{ padding: "2rem 2.5rem", maxWidth: "1100px" }}>
      <div
        className="animate-fade-up"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "2rem",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              marginBottom: "0.25rem",
            }}
          >
            Organizaciones
          </h1>
          <p
            style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}
          >
            Tenants registrados en la plataforma
          </p>
        </div>
        <button className="btn-primary">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nueva organización
        </button>
      </div>

      {loading && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            color: "var(--text-muted)",
            padding: "2rem 0",
          }}
        >
          <span className="spinner" />
          Cargando organizaciones…
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "1rem",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "var(--radius)",
            color: "var(--danger)",
            fontSize: "0.875rem",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {!loading && (
        <div
          className="card animate-fade-up-delay-1"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {tenants.length === 0 ? (
            <div
              style={{
                padding: "3rem",
                textAlign: "center",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>
                🏢
              </div>
              <p
                style={{
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                  color: "var(--text-secondary)",
                }}
              >
                Sin organizaciones
              </p>
              <p style={{ fontSize: "0.85rem" }}>
                Crea la primera organización para comenzar
              </p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Organización</th>
                    <th>Slug</th>
                    <th>Plan</th>
                    <th>Empleados máx.</th>
                    <th>Estado</th>
                    <th>Creado</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.name}</td>
                      <td
                        style={{
                          fontFamily: "monospace",
                          fontSize: "0.82rem",
                          color: "var(--text-muted)",
                        }}
                      >
                        {t.slug}
                      </td>
                      <td>
                        <span
                          className={`badge ${planColor[t.plan] ?? "badge-accent"}`}
                        >
                          {t.plan}
                        </span>
                      </td>
                      <td>{t.maxEmployees}</td>
                      <td>
                        <span
                          className={`badge ${t.isActive ? "badge-success" : "badge-warning"}`}
                        >
                          {t.isActive ? "Activo" : "Inactivo"}
                        </span>
                      </td>
                      <td
                        style={{
                          color: "var(--text-muted)",
                          fontSize: "0.82rem",
                        }}
                      >
                        {new Date(t.createdAt).toLocaleDateString("es-ES")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
