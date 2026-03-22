import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
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
}
