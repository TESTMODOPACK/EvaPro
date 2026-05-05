import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ObjectiveStatus, ObjectiveType } from '../entities/objective.entity';

/**
 * DTO para GET /objectives/list (T12 — Audit P2).
 *
 * Query params para listado paginado con filtros server-side. Reemplaza
 * el patrón legacy de "traer 200 + filtrar client-side" — ahora el
 * backend maneja la paginación y los filtros, garantizando que el cliente
 * vea datos consistentes con el `total` reportado.
 *
 * Defaults: page=1, pageSize=50. pageSize máximo 200 para evitar abuse.
 */
export class ListObjectivesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;

  /** Filtra por owner específico. Solo respetado para admin/super_admin —
   *  managers y employees ya están scopeados por rol. */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(ObjectiveStatus)
  status?: ObjectiveStatus;

  @IsOptional()
  @IsEnum(ObjectiveType)
  type?: ObjectiveType;

  @IsOptional()
  @IsUUID()
  cycleId?: string;

  /** Búsqueda case-insensitive sobre title + nombre/apellido del owner. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  /** Departamento del owner (filtro post-join). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  department?: string;
}
