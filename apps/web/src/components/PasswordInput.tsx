'use client';

/**
 * PasswordInput — input de contraseña con toggle show/hide (ojito).
 *
 * Uso:
 *   <PasswordInput value={pwd} onChange={(v) => setPwd(v)} placeholder="..." />
 *
 * Por defecto el campo arranca oculto. El ojito al lado derecho alterna
 * entre type="password" y type="text". Usa estilos inline para encajar
 * tanto en los forms inline del dashboard (adminForm) como en el login.
 *
 * Acepta `style` para override y `className` para usar la clase "input"
 * del design system cuando corresponda.
 */

import { useState } from 'react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  autoComplete?: string;
  maxLength?: number;
  className?: string;
  /** Estilos del `<input>` (no del wrapper). */
  style?: React.CSSProperties;
  /** Estilos del wrapper `<div>` (posicionamiento). */
  wrapperStyle?: React.CSSProperties;
  /** Arranca visible (ej. confirmación que el usuario quiere ver desde el inicio). */
  initiallyVisible?: boolean;
  id?: string;
  name?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}

export default function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  autoFocus,
  autoComplete = 'new-password',
  maxLength,
  className,
  style,
  wrapperStyle,
  initiallyVisible = false,
  id,
  name,
  onBlur,
  onFocus,
  onKeyDown,
}: Props) {
  const [visible, setVisible] = useState(initiallyVisible);

  return (
    <div style={{ position: 'relative', width: '100%', ...wrapperStyle }}>
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        maxLength={maxLength}
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        style={{ paddingRight: '2.5rem', ...style }}
      />
      <button
        type="button"
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        tabIndex={-1}
        style={{
          position: 'absolute',
          right: '0.6rem',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'transparent',
          border: 'none',
          padding: '0.2rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: 'var(--text-muted)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.05rem',
          lineHeight: 1,
        }}
      >
        {/* Emoji ojo: 👁 visible, 🙈 oculto. Simple, no depende de lib de iconos. */}
        <span aria-hidden="true">{visible ? '🙈' : '👁'}</span>
      </button>
    </div>
  );
}
