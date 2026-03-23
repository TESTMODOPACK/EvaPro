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
