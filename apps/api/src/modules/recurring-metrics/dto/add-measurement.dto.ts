import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class AddMeasurementDto {
  @IsNumber()
  @Type(() => Number)
  value: number;

  /** Cuándo ocurrió la medición. Si no se pasa, defaults a NOW.
   *  Permite cargas retroactivas (mediciones del mes pasado). */
  @IsOptional()
  @IsDateString()
  observedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
