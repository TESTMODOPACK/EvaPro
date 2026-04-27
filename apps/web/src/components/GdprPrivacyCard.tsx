"use client";

/**
 * "Privacidad y datos personales" card for /perfil.
 *
 * Two flows:
 *   1. Download my data — one-click, produces a ZIP delivered by email.
 *   2. Delete my account — 2 steps (type-to-confirm + email code), then the
 *      client logs out and redirects to /login?deleted=1.
 *
 * The download link is ALSO shown inline under the button if an export has
 * completed in the last 7 days, so the user doesn't have to dig through
 * their inbox.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useGdprMyRequests,
  useRequestGdprExport,
  useRequestAccountDeletion,
  useConfirmAccountDeletion,
} from "@/hooks/useGdpr";
import { useToastStore } from "@/store/toast.store";
import { useAuthStore } from "@/store/auth.store";
import ConfirmModal from "./ConfirmModal";
import DestructiveModal from "./DestructiveModal";

type DeleteStep = "idle" | "confirm" | "code";

export default function GdprPrivacyCard() {
  const router = useRouter();
  const toast = useToastStore((s) => s.toast);
  const logout = useAuthStore((s) => s.logout);
  const currentUser = useAuthStore((s) => s.user);

  const { data: myRequests } = useGdprMyRequests();
  const requestExport = useRequestGdprExport();
  const requestDelete = useRequestAccountDeletion();
  const confirmDelete = useConfirmAccountDeletion();

  // Self-delete restringido a super_admin y external (Opción B):
  // los empleados de tenants (employee/manager/tenant_admin) deben
  // canalizar la solicitud por su admin de RRHH (compliance B2B +
  // GDPR/Ley 19.628). El backend tambien rechaza con 403 — esto es
  // defense-in-depth UX para no mostrar un boton que falle.
  const canSelfDelete =
    currentUser?.role === 'super_admin' || currentUser?.role === 'external';

  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState<DeleteStep>("idle");
  const [deleteRequestId, setDeleteRequestId] = useState<string | null>(null);
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteError, setDeleteError] = useState("");

  // Most recent export (if any).
  const activeExport = myRequests?.find(
    (r) =>
      r.type === "export_user" &&
      (r.status === "processing" ||
        (r.status === "completed" &&
          r.fileUrl &&
          r.fileExpiresAt &&
          new Date(r.fileExpiresAt) > new Date())),
  );
  const inFlightExport = activeExport?.status === "processing";
  const readyExport =
    activeExport && activeExport.status === "completed" ? activeExport : null;

  async function handleExport() {
    setShowExportConfirm(false);
    try {
      await requestExport.mutateAsync();
      toast(
        "Estamos generando tu archivo. Te enviaremos un email cuando esté listo.",
        "success",
      );
    } catch (err: any) {
      toast(err?.message || "No pudimos generar tu export.", "error");
    }
  }

  async function handleRequestDelete() {
    setDeleteError("");
    try {
      const res = await requestDelete.mutateAsync();
      setDeleteRequestId(res.requestId);
      setDeleteStep("code");
      toast(
        `Te enviamos un código por email. Expira en ${res.expiresInMinutes} minutos.`,
        "info",
      );
    } catch (err: any) {
      setDeleteStep("idle");
      toast(err?.message || "No pudimos enviar el código.", "error");
    }
  }

  async function handleConfirmDelete() {
    if (!deleteRequestId) return;
    if (!/^\d{6}$/.test(deleteCode)) {
      setDeleteError("Ingresa los 6 dígitos del código.");
      return;
    }
    setDeleteError("");
    try {
      await confirmDelete.mutateAsync({
        requestId: deleteRequestId,
        code: deleteCode,
      });
      // Server already invalidated our JWT. Clear auth store and redirect.
      logout();
      router.replace("/login?deleted=1");
    } catch (err: any) {
      setDeleteError(err?.message || "Código inválido.");
    }
  }

  return (
    <div className="card" style={{ padding: "1.5rem" }}>
      <h2
        style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.35rem" }}
      >
        Privacidad y datos personales
      </h2>
      <p
        style={{
          fontSize: "0.8rem",
          color: "var(--text-muted)",
          marginBottom: "1.25rem",
        }}
      >
        Ejerce tus derechos de portabilidad y eliminación conforme al RGPD, la
        Ley 19.628 (Chile) y normativas equivalentes.
      </p>

      {/* ─── Exportar mis datos ─────────────────────────────────────────── */}
      <div
        style={{
          padding: "1rem 1.1rem",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-sm)",
          marginBottom: "1rem",
          background: "var(--bg-surface)",
        }}
      >
        <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: 4 }}>
          📦 Descargar mis datos
        </div>
        <p
          style={{
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            lineHeight: 1.5,
            marginBottom: "0.75rem",
          }}
        >
          Genera un archivo ZIP con todos tus datos: perfil, evaluaciones,
          feedback, objetivos, reconocimientos, plan de desarrollo y auditoría.
          Te enviaremos el link por email.
        </p>

        {readyExport && readyExport.fileUrl && (
          <div
            style={{
              padding: "8px 12px",
              background: "rgba(16,185,129,0.08)",
              border: "1px solid rgba(16,185,129,0.2)",
              borderRadius: "var(--radius-sm)",
              marginBottom: "0.75rem",
              fontSize: "0.82rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <span>Archivo disponible:</span>
            <a
              href={readyExport.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--accent)", fontWeight: 600 }}
            >
              Descargar ZIP →
            </a>
            {readyExport.fileExpiresAt && (
              <span style={{ color: "var(--text-muted)", fontSize: "0.72rem" }}>
                (expira{" "}
                {new Date(readyExport.fileExpiresAt).toLocaleDateString(
                  "es-CL",
                )}
                )
              </span>
            )}
          </div>
        )}

        <button
          className="btn-ghost"
          disabled={requestExport.isPending || inFlightExport}
          onClick={() => setShowExportConfirm(true)}
          style={{ fontSize: "0.82rem" }}
        >
          {inFlightExport
            ? "Generando archivo…"
            : requestExport.isPending
              ? "Enviando solicitud…"
              : "Solicitar export de mis datos"}
        </button>
      </div>

      {/* ─── Eliminar mi cuenta ─────────────────────────────────────────── */}
      {canSelfDelete ? (
        <div
          style={{
            padding: "1rem 1.1rem",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "var(--radius-sm)",
            background: "rgba(239,68,68,0.04)",
          }}
        >
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: 4,
              color: "var(--danger)",
            }}
          >
            🗑 Eliminar mi cuenta permanentemente
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              marginBottom: "0.75rem",
            }}
          >
            Tu cuenta será desactivada y tus datos personales anonimizados. Las
            evaluaciones históricas, firmas y auditoría se conservan por
            obligación legal sin datos identificables asociados. Esta acción es
            irreversible.
          </p>
          <button
            type="button"
            onClick={() => setDeleteStep("confirm")}
            disabled={requestDelete.isPending || confirmDelete.isPending}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--danger)",
              background: "transparent",
              color: "var(--danger)",
              fontSize: "0.82rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Eliminar mi cuenta
          </button>
        </div>
      ) : (
        // Empleados con tenantId (employee/manager/tenant_admin) deben
        // canalizar la solicitud por su admin de RRHH. Cumplimos GDPR /
        // Ley 19.628 (el derecho sigue existiendo) pero respetamos el
        // proceso B2B de offboarding.
        <div
          style={{
            padding: "1rem 1.1rem",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface)",
          }}
        >
          <div
            style={{
              fontSize: "0.9rem",
              fontWeight: 600,
              marginBottom: 4,
              color: "var(--text-primary)",
            }}
          >
            🗑 Eliminar mis datos personales
          </div>
          <p
            style={{
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Para ejercer tu derecho a la eliminación de datos personales
            (GDPR / Ley 19.628), contacta a tu <strong>administrador de
            RRHH</strong> de la empresa. Tu solicitud será procesada en hasta
            30 días hábiles. Las evaluaciones históricas, firmas y auditoría
            se conservan por obligación legal sin datos identificables
            asociados.
          </p>
        </div>
      )}

      {/* ─── Modals ─────────────────────────────────────────────────────── */}
      {showExportConfirm && (
        <ConfirmModal
          message="¿Generar export de tus datos?"
          detail="Crearemos un archivo ZIP con toda tu información y te enviaremos un email con el link de descarga cuando esté listo. Puede tardar algunos minutos."
          confirmLabel="Generar export"
          onConfirm={handleExport}
          onCancel={() => setShowExportConfirm(false)}
        />
      )}

      {deleteStep === "confirm" && (
        <DestructiveModal
          title="Eliminar mi cuenta permanentemente"
          description={
            <>
              <p style={{ margin: "0 0 0.5rem" }}>
                Esta acción es <strong>irreversible</strong>. Al confirmar:
              </p>
              <ul
                style={{
                  margin: "0 0 0.75rem",
                  paddingLeft: "1.2rem",
                  fontSize: "0.82rem",
                }}
              >
                <li>Tu acceso quedará revocado inmediatamente.</li>
                <li>
                  Tus datos personales (nombre, email, RUT) serán anonimizados.
                </li>
                <li>
                  Las evaluaciones históricas y auditoría se conservan por
                  obligación legal sin datos identificables.
                </li>
                <li>
                  Te enviaremos un código por email para confirmar el siguiente
                  paso.
                </li>
              </ul>
            </>
          }
          confirmationPhrase="ELIMINAR MIS DATOS"
          confirmLabel="Enviar código de confirmación"
          isLoading={requestDelete.isPending}
          onConfirm={handleRequestDelete}
          onCancel={() => setDeleteStep("idle")}
        />
      )}

      {deleteStep === "code" && (
        <div
          onClick={() => !confirmDelete.isPending && setDeleteStep("idle")}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card animate-fade-up"
            style={{
              padding: "1.75rem",
              maxWidth: 440,
              width: "100%",
              boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "rgba(239,68,68,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.4rem",
                marginBottom: "1rem",
              }}
            >
              ✉️
            </div>
            <h2
              style={{
                fontSize: "1.1rem",
                fontWeight: 700,
                margin: "0 0 0.5rem",
              }}
            >
              Confirma con el código enviado
            </h2>
            <p
              style={{
                fontSize: "0.88rem",
                color: "var(--text-secondary)",
                lineHeight: 1.55,
                marginBottom: "1.25rem",
              }}
            >
              Te enviamos un código de 6 dígitos a tu email. Ingrésalo aquí para
              eliminar tu cuenta. El código expira en 30 minutos.
            </p>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={deleteCode}
              onChange={(e) =>
                setDeleteCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              disabled={confirmDelete.isPending}
              placeholder="123456"
              style={{
                fontFamily: "monospace",
                letterSpacing: "0.5em",
                fontSize: "1.2rem",
                textAlign: "center",
              }}
            />
            {deleteError && (
              <div
                style={{
                  marginTop: "0.75rem",
                  color: "var(--danger)",
                  fontSize: "0.82rem",
                }}
              >
                {deleteError}
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: "0.75rem",
                justifyContent: "flex-end",
                marginTop: "1.5rem",
              }}
            >
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setDeleteStep("idle")}
                disabled={confirmDelete.isPending}
                style={{ fontSize: "0.875rem" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={
                  confirmDelete.isPending || !/^\d{6}$/.test(deleteCode)
                }
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  cursor: confirmDelete.isPending ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  background: "var(--danger)",
                  color: "#fff",
                  opacity: confirmDelete.isPending ? 0.6 : 1,
                }}
              >
                {confirmDelete.isPending
                  ? "Eliminando…"
                  : "Eliminar mi cuenta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
