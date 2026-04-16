"use client";

import { useState, useEffect, useRef } from "react";

/**
 * Type-to-confirm modal for irreversible actions (e.g. GDPR account
 * deletion). Button stays disabled until the user types the exact phrase.
 *
 * Intentionally separate from ConfirmModal so the regular "Cancel/Confirm"
 * flow isn't accidentally used for destructive actions.
 */

interface DestructiveModalProps {
  title: string;
  description: React.ReactNode;
  confirmationPhrase: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DestructiveModal({
  title,
  description,
  confirmationPhrase,
  confirmLabel = "Continuar",
  cancelLabel = "Cancelar",
  isLoading = false,
  onConfirm,
  onCancel,
}: DestructiveModalProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const matches =
    input.trim().toUpperCase() === confirmationPhrase.trim().toUpperCase();

  // Autofocus the input for accessibility; let users abort with Escape.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel, isLoading]);

  return (
    <div
      onClick={() => !isLoading && onCancel()}
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="destructive-modal-title"
        style={{
          padding: "1.75rem",
          maxWidth: 480,
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
          ⚠️
        </div>

        <h2
          id="destructive-modal-title"
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "var(--text-primary)",
            margin: "0 0 0.5rem",
          }}
        >
          {title}
        </h2>

        <div
          style={{
            fontSize: "0.88rem",
            color: "var(--text-secondary)",
            lineHeight: 1.55,
            marginBottom: "1.25rem",
          }}
        >
          {description}
        </div>

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
          Escribe &ldquo;{confirmationPhrase}&rdquo; para continuar
        </label>
        <input
          ref={inputRef}
          className="input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          style={{ fontFamily: "monospace", letterSpacing: "0.05em" }}
        />

        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "flex-end",
            marginTop: "1.5rem",
          }}
        >
          <button
            className="btn-ghost"
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            style={{ fontSize: "0.875rem" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || isLoading}
            style={{
              padding: "0.5rem 1.25rem",
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: matches && !isLoading ? "pointer" : "not-allowed",
              fontWeight: 700,
              fontSize: "0.875rem",
              background: matches ? "var(--danger)" : "#cbd5e1",
              color: "#fff",
              transition: "var(--transition)",
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? "Procesando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
