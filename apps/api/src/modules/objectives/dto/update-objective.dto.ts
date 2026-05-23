import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ObjectiveType } from '../entities/objective.entity';

export class UpdateObjectiveDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(ObjectiveType)
  @IsOptional()
  type?: ObjectiveType;

  // B3-17: `status` y `progress` REMOVIDOS del DTO. Antes PATCH /:id
  // {status:'completed'} saltaba el workflow submitForApproval→approve
  // y PATCH {progress:100} saltaba addProgressUpdate (que valida KR
  // OKR, exige notas para admin override, dispara gamificación). Los
  // cambios de estado van por submitForApproval/approve/complete/
  // cancel/carryOver; el progreso por POST /:id/progress. Con
  // ValidationPipe global (whitelist:true) cualquier `status`/`progress`
  // en el body se descarta silenciosamente.

  @IsDateString()
  @IsOptional()
  targetDate?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  weight?: number;

  @IsUUID()
  @IsOptional()
  parentObjectiveId?: string;

  @IsUUID()
  @IsOptional()
  cycleId?: string;
}

export class CreateObjectiveUpdateDto {
  @IsInt()
  @Min(0)
  @Max(100)
  progressValue: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
