import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ObjectiveStatus, ObjectiveType } from '../entities/objective.entity';

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

  @IsEnum(ObjectiveStatus)
  @IsOptional()
  status?: ObjectiveStatus;

  @IsDateString()
  @IsOptional()
  targetDate?: string;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  progress?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  weight?: number;
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
