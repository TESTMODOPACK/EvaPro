/**
 * ascenda-company.config.ts — Datos legales del Proveedor (Ascenda).
 *
 * Antes estos datos estaban hardcoded dentro de los templates del
 * contrato de prestación de servicios ("ASCENDA PERFORMANCE SpA, RUT
 * 78.396.131-8... Ricardo Morales Olate, RUT 12.121.896-8"). Esto
 * tenía 2 problemas:
 *
 *   1. Cambios al nombre de la empresa o representante legal requerían
 *      recompilar el código y redeploy.
 *   2. Solo el contrato de servicios mencionaba al representante legal;
 *      los otros 5 contratos (DPA, T&C, SLA, NDA, privacy) no lo hacían.
 *      Eso los dejaba débiles legalmente (contrato firmado sin identificar
 *      quién firma por cada parte).
 *
 * Ahora: una única fuente de verdad leída primero de env vars, con
 * fallback a los valores actuales para backwards-compat. Los 6 templates
 * usan placeholders que se resuelven desde este objeto.
 *
 * Para cambiar CEO / razón social en prod: editar el `.env` del VPS y
 * reiniciar el container. Los contratos YA firmados quedan inmutables
 * (su contenido quedó snapshotted al firmar). Solo los nuevos bulk-create
 * muestran el nuevo valor.
 */

export const ASCENDA_COMPANY = {
  legalName: process.env.ASCENDA_COMPANY_NAME || 'ASCENDA PERFORMANCE SpA',
  rut: process.env.ASCENDA_COMPANY_RUT || '78.396.131-8',
  address: process.env.ASCENDA_COMPANY_ADDRESS || 'Fresia 2020, La Pintana, Santiago',
  legalRepName: process.env.ASCENDA_LEGAL_REP_NAME || 'Ricardo Morales Olate',
  legalRepRut: process.env.ASCENDA_LEGAL_REP_RUT || '12.121.896-8',
  supportEmail: process.env.ASCENDA_SUPPORT_EMAIL || 'soporte@ascenda.cl',
  supportPhone: process.env.ASCENDA_SUPPORT_PHONE || '',
  productName: 'EVA360',
  productDomain: 'eva360.ascenda.cl',
} as const;

export type AscendaCompany = typeof ASCENDA_COMPANY;
