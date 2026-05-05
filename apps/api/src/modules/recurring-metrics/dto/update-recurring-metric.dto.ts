import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MetricFrequency } from '../entities/recurring-metric.entity';

export class UpdateRecurringMetricDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  targetValue?: number;

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

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
