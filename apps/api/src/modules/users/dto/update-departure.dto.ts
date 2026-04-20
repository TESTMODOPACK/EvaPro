import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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
 *
 * Nota sobre decoradores: ver nota en CreateDepartureDto — sin decoradores
 * el body se queda vacío con whitelist:true.
 */
export class UpdateDepartureDto {
  @IsOptional()
  @IsEnum(DepartureReasonCategory)
  reasonCategory?: DepartureReasonCategory | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reasonDetail?: string | null;

  @IsOptional()
  @IsBoolean()
  wouldRehire?: boolean | null;
}
