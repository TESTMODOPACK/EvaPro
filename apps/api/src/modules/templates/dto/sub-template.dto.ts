/**
 * sub-template.dto.ts — DTOs de Fase 3 (Opción A) para CRUD de
 * form_sub_templates.
 */
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RelationType } from '../../evaluations/entities/evaluation-assignment.entity';

const RELATION_TYPE_VALUES = Object.values(RelationType);

export class CreateSubTemplateDto {
  @IsString()
  @IsIn(RELATION_TYPE_VALUES)
  @IsNotEmpty()
  relationType: RelationType;

  @IsArray()
  @IsOptional()
  sections?: any[];

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  weight?: number;

  @IsInt()
  @IsOptional()
  displayOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class UpdateSubTemplateDto {
  @IsArray()
  @IsOptional()
  sections?: any[];

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  weight?: number;

  @IsInt()
  @IsOptional()
  displayOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * Update batch de pesos — usado por el slider del editor para guardar
 * los 4-5 pesos en una sola request (evita races + valida suma == 1.0).
 */
export class UpdateWeightsDto {
  /**
   * Mapa relationType → weight. Solo se actualizan los relationTypes
   * incluidos. La suma de TODOS los pesos activos (no solo los del DTO)
   * debe quedar en 1.0 ± tolerancia (validado en service).
   */
  @IsNotEmpty()
  weights: Partial<Record<RelationType, number>>;
}

/**
 * Save-all batch: actualiza TODAS las subs + pesos en una sola
 * transaccion atomica. Hace snapshot del estado actual ANTES de
 * modificar (versionHistory). Mejor que N llamadas separadas por:
 *   - Atomicidad: si una sub falla, ninguna se persiste
 *   - Snapshot consistente: 1 version por save (no N+1)
 *   - Race-safety: no hay 2-tier modificaciones
 */
export class SaveAllSubTemplatesDto {
  /**
   * Subs a actualizar (todas las que el editor controla). Cada item
   * debe incluir `id` para identificar la sub. Los demas campos son
   * opcionales — solo se actualizan si están presentes.
   */
  @IsNotEmpty()
  subTemplates: Array<{
    id: string;
    sections?: any[];
    weight?: number;
    displayOrder?: number;
    isActive?: boolean;
  }>;

  /** Nota de cambio opcional (queda en versionHistory.changeNote). */
  @IsString()
  @IsOptional()
  changeNote?: string;
}
