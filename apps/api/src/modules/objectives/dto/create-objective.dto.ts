import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ObjectiveType } from '../entities/objective.entity';

export class CreateObjectiveDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(ObjectiveType)
  @IsOptional()
  type?: ObjectiveType;

  @IsDateString()
  @IsOptional()
  targetDate?: string;

  @IsUUID()
  @IsOptional()
  cycleId?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  weight?: number;
}
