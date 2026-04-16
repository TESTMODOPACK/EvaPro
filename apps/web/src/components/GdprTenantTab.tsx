"use client";

/**
 * "Privacidad y datos" tab for /ajustes (tenant_admin). Provides:
 *   - One-click tenant-wide export (optionally anonymized).
 *   - Read-only audit of GDPR activity in the tenant (last 90 days).
 */

import { useState } from "react";
import {
  useGdprTenantRequests,
  useRequestTenantExport,
} from "@/hooks/useGdpr";
import { useToastStore } from "@/store/toast.store";
import ConfirmModal from "./ConfirmModal";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TYPE_LABEL: Record<string, string> = {
  export_user: "Export personal",
  export_tenant: "Export tenant",
  delete_user: "Eliminación de cuenta",
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendiente", color: "#64748b" },
  processing: { label: "Procesando", color: "#f59e0b" },
  confirmed_pending: { label: "Esperando confirmación", color: "#f59e0b" },
  completed: { label: "Completado", color: "#10b981" },
  failed: { label: "Fallido", color: "#ef4444" },
};

export default function GdprTenantTab() {
  const toast = useToastStore((s) => s.toast);
  const { data: requests, isLoading } = useGdprTenantRequests();
  const requestExport = useRequestTenantExport();

  const [showConfirm, setShowConfirm] = useState(false);
  const [anonymize, setAnonymize] = useState(false);

  async function handleExport() {
    setShowConfirm(false);
    try {
      await requestExport.mutateAsync({ anonymize });
      toast(
        "Generando export del tenant. Recibirás un email con el link de descarga cuando esté listo.",
        "success",
      );
    } catch (err: any) {
      toast(err?.message || "No pudimos generar el export.", "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div className="card" style={{ padding: "1.5rem" }}>
        <h3
          style={{
            fontSize: "0.95rem",
            fontWeight: 700,
            marginBottom: "0.35rem",
          }}
        >
          Exportar datos del tenant
        </h3>
        <p
          style={{
            fontSize: "0.82rem",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            marginBottom: "1rem",
          }}
        >
          Genera un ZIP con todos los datos operacionales del tenant: usuarios,
          ciclos de evaluación, feedback, objetivos, reconocimientos,
          contratos, facturas y auditoría. Para tenants grandes puede tardar
          varios minutos; algunas tablas se truncan a 5.000 filas.
        </p>

        <label
          style={{
            display: "flex",
            gap: "0.6rem",
            alignItems: "center",
            marginBottom: "1rem",
            padding: "0.75rem",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={anonymize}
            onChange={(e) => setAnonymize(e.target.checked)}
            style={{ marginTop: 2 }}
          />
          <div>
            <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              Anonimizar datos de empleados
            </div>
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-muted)",
                lineHeight: 1.4,
              }}
            >
              Reemplaza nombres, emails y RUTs por pseudónimos (ej. &ldquo;Usuario
              1&rdquo;). Útil si el archivo saldrá fuera de la organización
              (consultorías, auditorías externas).
            </div>
          </div>
        </label>

        <button
          className="btn-primary"
          disabled={requestExport.isPending}
          onClick={() => setShowConfirm(true)}
          style={{ fontSize: "0.85rem" }}
        >
          {requestExport.isPending
            ? "Enviando solicitud…"
            : "Generar export del tenant"}
        </button>
      </div>

      <div className="card" style={{ padding: "1.5rem" }}>
        <h3
          style={{
            fontSize: "0.95rem",
            fontWeight: 700,
            marginBottom: "1rem",
          }}
        >
          Historial de solicitudes GDPR (últimos 90 días)
        </h3>
        {isLoading ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Cargando…
          </p>
        ) : !requests || requests.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
            Aún no hay solicitudes GDPR en este tenant.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.82rem",
              }}
            >
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Tipo
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Usuario
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Estado
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Solicitado
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.72rem",
                      textTransform: "uppercase",
                      color: "var(--text-muted)",
                    }}
                  >
                    Completado
                  </th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const s = STATUS_LABEL[r.status] || {
                    label: r.status,
                    color: "#64748b",
                  };
                  return (
                    <tr
                      key={r.id}
                      style={{ borderBottom: "1px solid var(--border)" }}
                    >
                      <td style={{ padding: "8px 10px" }}>
                        {TYPE_LABEL[r.type] || r.type}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          fontFamily: "monospace",
                          fontSize: "0.75rem",
                        }}
                      >
                        {r.userId.slice(0, 8)}…
                      </td>
                      <td style={{ padding: "8px 10px", color: s.color, fontWeight: 600 }}>
                        {s.label}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {formatDate(r.requestedAt)}
                      </td>
                      <td
                        style={{
                          padding: "8px 10px",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {formatDate(r.completedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmModal
          message={
            anonymize
              ? "Generar export anonimizado del tenant"
              : "Generar export completo del tenant"
          }
          detail={
            anonymize
              ? "El archivo no contendrá nombres, emails ni RUTs identificables."
              : "El archivo contendrá datos personales identificables. Manéjalo de acuerdo a tu política interna de protección de datos."
          }
          confirmLabel="Generar export"
          onConfirm={handleExport}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
