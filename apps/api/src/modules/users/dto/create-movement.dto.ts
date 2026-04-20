import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MovementType } from '../entities/user-movement.entity';

/**
 * DTO para registrar un movimiento interno (promoción, traslado, etc.).
 *
 * Nota sobre decoradores: ver nota en CreateDepartureDto — sin decoradores
 * el body se queda vacío con whitelist:true en el ValidationPipe global.
 */
export class CreateMovementDto {
  @IsEnum(MovementType)
  movementType: MovementType;

  /** Fecha ISO (YYYY-MM-DD) */
  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromDepartment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  toDepartment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromPosition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  toPosition?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
