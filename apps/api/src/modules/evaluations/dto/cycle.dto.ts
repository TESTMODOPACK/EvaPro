import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CycleType, CycleStatus, CyclePeriod } from '../entities/evaluation-cycle.entity';

export class CreateCycleDto {
  /**
   * Target tenant para super_admin que opera cross-tenant. Whitelist del
   * ValidationPipe strippea props no declaradas — al declararlo acá el
   * body lo conserva. El controller lo valida via resolveOperatingTenantId
   * (super_admin obligatorio; tenant_admin lo ignora si presente).
   */
  @IsUUID()
  @IsOptional()
  tenantId?: string;

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

  @IsEnum(CyclePeriod)
  @IsOptional()
  period?: CyclePeriod;

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

  @IsEnum(CyclePeriod)
  @IsOptional()
  period?: CyclePeriod;

  @IsUUID()
  @IsOptional()
  templateId?: string;

  @IsOptional()
  settings?: any;
}
