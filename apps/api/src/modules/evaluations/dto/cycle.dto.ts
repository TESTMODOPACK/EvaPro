import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CycleType, CycleStatus } from '../entities/evaluation-cycle.entity';

export class CreateCycleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(CycleType)
  @IsOptional()
  type?: CycleType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsOptional()
  settings?: any;
}

export class UpdateCycleDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEnum(CycleType)
  @IsOptional()
  type?: CycleType;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(CycleStatus)
  @IsOptional()
  status?: CycleStatus;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsOptional()
  settings?: any;
}
