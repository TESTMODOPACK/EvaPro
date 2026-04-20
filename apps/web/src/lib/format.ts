/**
 * Format a number as Chilean currency: $XX.XXX.XXX
 * Uses dot as thousands separator, no decimals (CLP has no cents)
 */
export function formatCLP(value: number | string | null | undefined): string {
  if (value == null || value === '') return '$0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';
  // Round to integer (CLP has no decimals)
  const rounded = Math.round(num);
  // Format with dots as thousands separator
  const formatted = rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$${formatted}`;
}

/**
 * P8-E: helpers de formato de fecha consistentes en español (es-CL).
 *
 * Problema antes: cada componente implementaba su propia función
 * formatDate con variaciones (es-ES vs es-CL, abreviado vs completo,
 * con/sin año, algunos parseaban dates sin timezone causando off-by-one
 * en hora local).
 *
 * Estas funciones unifican el formato y manejan correctamente el caso
 * "2026-04-08" (date-only) para no sufrir timezone shift al crear el
 * Date() (por defecto JS lo interpreta como UTC midnight y luego lo
 * convierte a local, causando que 2026-04-08 se vea como 2026-04-07
 * en husos horarios al oeste de UTC).
 */

function parseAsLocalDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;

  // Formato date-only "YYYY-MM-DD" → parse como local para evitar shift.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  // Cualquier otro formato ISO (con hora o timezone explícito) → OK por Date.
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * formatDateSpanish — "8 abr 2026" (corto, default).
 */
export function formatDateSpanish(value: string | Date | null | undefined): string {
  const d = parseAsLocalDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * formatDateLong — "8 de abril de 2026" (verboso, para headers).
 */
export function formatDateLong(value: string | Date | null | undefined): string {
  const d = parseAsLocalDate(value);
  if (!d) return '—';
  return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * formatDateTime — "8 abr 2026, 14:30" (con hora, para logs/eventos).
 */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = parseAsLocalDate(value);
  if (!d) return '—';
  return d.toLocaleString('es-CL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * formatTimeAgo — "hace 5 min" / "hace 2 h" / "hace 3 d" / fecha absoluta.
 * Útil para feeds de actividad, timestamps relativos.
 */
export function formatTimeAgo(value: string | Date | null | undefined): string {
  const d = parseAsLocalDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'hace instantes';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  // >30 días: fecha absoluta corta.
  return formatDateSpanish(value);
}
