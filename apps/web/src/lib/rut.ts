/** Remove dots and spaces, uppercase, keep hyphen */
export function normalizeRut(rut: string): string {
  return rut.replace(/\./g, '').replace(/\s/g, '').toUpperCase().trim();
}

/** Calculate the verification digit using modulo 11 */
function calculateDv(body: string): string {
  const digits = body.split('').reverse().map(Number);
  const series = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * series[i % series.length];
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/** Validate a Chilean RUT (format + verification digit) */
export function validateRut(rut: string): boolean {
  const normalized = normalizeRut(rut);
  const match = normalized.match(/^(\d{7,8})-([0-9K])$/);
  if (!match) return false;
  const [, body, dv] = match;
  return calculateDv(body) === dv;
}

/** Format RUT for display: XX.XXX.XXX-V */
export function formatRut(rut: string): string {
  const normalized = normalizeRut(rut);
  const match = normalized.match(/^(\d+)-([0-9K])$/);
  if (!match) return rut;
  const [, body, dv] = match;
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted}-${dv}`;
}

/** Auto-format as the user types: adds dots and hyphen */
export function formatRutInput(value: string): string {
  // Remove everything except digits and K
  let clean = value.replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length === 0) return '';

  // Separate body and DV
  if (clean.length > 1) {
    const body = clean.slice(0, -1);
    const dv = clean.slice(-1);
    const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${formatted}-${dv}`;
  }
  return clean;
}
