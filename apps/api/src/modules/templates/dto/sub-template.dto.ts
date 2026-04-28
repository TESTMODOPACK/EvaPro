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
