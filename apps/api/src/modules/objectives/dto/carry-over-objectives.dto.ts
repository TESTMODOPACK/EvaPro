import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * DTO para POST /objectives/carry-over (T11 — Audit P2).
 *
 * Carry-over: continuar objetivos no terminados al siguiente ciclo,
 * preservando linaje (`carriedFromObjectiveId`) sin perder histórico.
 *
 * Cap de 100 ids por batch — la UI rara vez excede 50 objetivos a
 * llevar al próximo ciclo.
 */
export class CarryOverObjectivesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  objectiveIds: string[];

  /** Ciclo destino. Debe estar abierto (active/draft). */
  @IsUUID()
  targetCycleId: string;

  /**
   * Si `true`, los objetivos source se cancelan automáticamente con la
   * razón especificada (require `sourceCancelReason`). Si `false`,
   * los source quedan intactos y el usuario los gestiona aparte.
   */
  @IsOptional()
  @IsBoolean()
  cancelSource?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  sourceCancelReason?: string;
}
