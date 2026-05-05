import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { MetricFrequency } from '../entities/recurring-metric.entity';

export class CreateRecurringMetricDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit: string;

  @IsNumber()
  @Type(() => Number)
  targetValue: number;

  @IsOptional()
  @IsBoolean()
  higherIsBetter?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  thresholdGreen?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  thresholdYellow?: number;

  @IsOptional()
  @IsEnum(MetricFrequency)
  frequency?: MetricFrequency;

  /** Owner. Si no se pasa, defaults a req.user.userId. Solo
   *  super_admin/tenant_admin/manager pueden asignar a otro user. */
  @IsOptional()
  @IsUUID()
  ownerUserId?: string;
}
