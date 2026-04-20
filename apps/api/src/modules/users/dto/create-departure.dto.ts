import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DepartureType, DepartureReasonCategory } from '../entities/user-departure.entity';

/**
 * DTO para registrar la desvinculación de un usuario.
 *
 * IMPORTANTE: los decoradores `@IsX()` son obligatorios. El
 * `ValidationPipe` global (main.ts) tiene `whitelist: true` — si un DTO
 * no tiene decoradores, TypeScript type annotations no generan fields
 * en runtime y el body llega **vacío** al controller (bug: dto.X es
 * undefined → new Date(undefined) → "0NaN-aN-aN" al insertar).
 */
export class CreateDepartureDto {
  @IsEnum(DepartureType)
  departureType: DepartureType;

  /** Fecha ISO (YYYY-MM-DD) desde el `<input type="date">` del frontend. */
  @IsDateString()
  departureDate: string;

  @IsBoolean()
  isVoluntary: boolean;

  @IsOptional()
  @IsEnum(DepartureReasonCategory)
  reasonCategory?: DepartureReasonCategory;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reasonDetail?: string;

  @IsOptional()
  @IsBoolean()
  wouldRehire?: boolean | null;

  /**
   * (Opcional) id del nuevo manager al cual reasignar los reportes directos
   * del usuario que se está desvinculando. Si se omite, sus reportes quedan
   * con managerId = null (sin jefatura hasta nueva asignación manual).
   */
  @IsOptional()
  @IsUUID()
  reassignToManagerId?: string | null;
}
