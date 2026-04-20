'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Texto adicional para búsqueda y/o mostrar (ej. cargo, departamento). */
  hint?: string;
  /** Si se provee, se renderiza el inicial circular tipo avatar. */
  initials?: string;
}

/**
 * SearchableSelect — combobox con búsqueda incremental que reemplaza
 * `<select>` cuando hay 30+ opciones y el `<select>` nativo se vuelve
 * inmanejable. Útil para selectores de colaborador, ciclo, manager, etc.
 *
 * Características:
 *   · Filtro client-side por label + hint (case-insensitive)
 *   · Navegación con teclado (Arrow Up/Down, Enter, Escape)
 *   · Cierra al perder foco (click fuera)
 *   · ARIA: combobox + listbox + selected
 *   · Value vacío permitido (option "—")
 */
export interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  /** Texto del item "Sin selección" (value=''). Si se omite, no se muestra. */
  clearLabel?: string;
  disabled?: boolean;
  required?: boolean;
  /** Inputs CSS — para integrarse con .input className del proyecto. */
  className?: string;
  style?: React.CSSProperties;
  /** Aria label para lectores de pantalla. */
  ariaLabel?: string;
  id?: string;
}

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecciona una opción...',
  emptyLabel = 'Sin coincidencias',
  clearLabel,
  disabled = false,
  required = false,
  className = 'input',
  style,
  ariaLabel,
  id,
}: SearchableSelectProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // P8-D: IDs estables para vincular listbox↔options con aria-activedescendant.
  // Generamos un id único por instancia (mount-time) para no colisionar.
  const instanceIdRef = useRef<string>(`ss-${Math.random().toString(36).slice(2, 9)}`);
  const listboxId = `${instanceIdRef.current}-listbox`;
  const optionId = (idx: number) => `${instanceIdRef.current}-opt-${idx}`;

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.toLowerCase().trim();
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || (o.hint || '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // P8-D: total de opciones focuseables para evitar aria-activedescendant
  // apuntando a ID inexistente cuando la búsqueda no arroja resultados.
  const totalFocusable = (clearLabel ? 1 : 0) + filtered.length;

  // Cerrar al click fuera — devuelve foco al trigger (a11y)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
        // Devolver foco al trigger para que el keyboard user pueda seguir
        // navegando por Tab sin perder la posición en el formulario.
        setTimeout(() => triggerRef.current?.focus(), 0);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset highlight cuando filtra
  useEffect(() => {
    setHighlightIndex(0);
  }, [query]);

  // Focus input al abrir
  useEffect(() => {
    if (open && inputRef.current) {
      // microdelay para evitar conflict con el click handler que abrió el dropdown
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // P8-D: scroll al item highlighted con teclado para que el usuario
  // visual vea la selección cuando navega por listas largas.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.children;
    const target = items[highlightIndex] as HTMLElement | undefined;
    target?.scrollIntoView({ block: 'nearest' });
  }, [open, highlightIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
      setTimeout(() => triggerRef.current?.focus(), 0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1 + (clearLabel ? 1 : 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const items: Array<SearchableSelectOption | { value: '' }> = clearLabel
        ? [{ value: '' }, ...filtered]
        : filtered;
      const item = items[highlightIndex];
      if (item) {
        onChange(item.value);
        setOpen(false);
        setQuery('');
      }
    }
  };

  const triggerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: '100%',
    minHeight: '36px',
    opacity: disabled ? 0.6 : 1,
    ...style,
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger (read-only display) — recibe foco al cerrar (a11y) */}
      <div
        ref={triggerRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required}
        aria-label={ariaLabel}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && totalFocusable > 0 ? optionId(highlightIndex) : undefined}
        aria-autocomplete="list"
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        className={className}
        style={triggerStyle}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
      >
        <span style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: selectedOption ? 'var(--text-primary)' : 'var(--text-muted)',
        }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: 'var(--bg-card, var(--bg-surface))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm, 8px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 50,
            maxHeight: '320px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Search input */}
          <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--border)' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('components.searchableSelect.searchPlaceholder')}
              aria-label={t('components.searchableSelect.filterLabel')}
              style={{
                width: '100%',
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm, 6px)',
                fontSize: '0.85rem',
                outline: 'none',
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* List */}
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel || 'Opciones'}
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              overflow: 'auto',
              flex: 1,
            }}
          >
            {clearLabel && (
              <Item
                id={optionId(0)}
                isHighlighted={highlightIndex === 0}
                isSelected={value === ''}
                onClick={() => {
                  onChange('');
                  setOpen(false);
                  setQuery('');
                }}
                onMouseEnter={() => setHighlightIndex(0)}
                muted
              >
                {clearLabel}
              </Item>
            )}
            {filtered.length === 0 ? (
              <li role="option" aria-selected={false} style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem', textAlign: 'center' }}>
                {emptyLabel}
              </li>
            ) : (
              filtered.map((opt, idx) => {
                const adjustedIdx = clearLabel ? idx + 1 : idx;
                return (
                  <Item
                    key={opt.value}
                    id={optionId(adjustedIdx)}
                    isHighlighted={highlightIndex === adjustedIdx}
                    isSelected={opt.value === value}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                      setQuery('');
                    }}
                    onMouseEnter={() => setHighlightIndex(adjustedIdx)}
                    initials={opt.initials}
                  >
                    <div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>{opt.label}</div>
                      {opt.hint && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{opt.hint}</div>
                      )}
                    </div>
                  </Item>
                );
              })
            )}
          </ul>

          {/* Footer count */}
          <div style={{ padding: '0.4rem 0.75rem', borderTop: '1px solid var(--border)', fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'right', background: 'var(--bg-surface)' }}>
            {filtered.length} de {options.length}
          </div>
        </div>
      )}
    </div>
  );
}

function Item({
  id,
  children,
  isHighlighted,
  isSelected,
  onClick,
  onMouseEnter,
  initials,
  muted,
}: {
  id?: string;
  children: React.ReactNode;
  isHighlighted: boolean;
  isSelected: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  initials?: string;
  muted?: boolean;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={isSelected}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.5rem 0.75rem',
        cursor: 'pointer',
        background: isHighlighted ? 'var(--bg-hover, rgba(0,0,0,0.04))' : 'transparent',
        borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
        color: muted ? 'var(--text-muted)' : 'inherit',
        fontStyle: muted ? 'italic' : 'normal',
      }}
    >
      {initials && (
        <span
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: 'var(--accent)',
            color: '#fff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.7rem',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      {isSelected && (
        <span aria-hidden="true" style={{ color: 'var(--accent)', fontSize: '0.85rem' }}>✓</span>
      )}
    </li>
  );
}
