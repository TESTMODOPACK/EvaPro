import { DepartureReasonCategory } from '../entities/user-departure.entity';

/**
 * DTO para editar un registro de desvinculación existente.
 *
 * **Campos inmutables** (no incluidos en este DTO, nunca editables):
 *   userId, tenantId, processedBy, departureDate, departureType,
 *   isVoluntary, lastDepartment, lastPosition.
 *
 * **Motivo de la restricción**: la desvinculación es un evento legal con
 * consecuencias documentadas (type, date, voluntary). Sólo se permite
 * corregir los campos de diagnóstico/seguimiento post-salida (categoría
 * de razón, detalle textual, elegibilidad de recontratación).
 */
export class UpdateDepartureDto {
  reasonCategory?: DepartureReasonCategory | null;
  reasonDetail?: string | null;
  wouldRehire?: boolean | null;
}
