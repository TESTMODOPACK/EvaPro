import { IsString, IsOptional, IsUUID, IsArray, IsDateString } from 'class-validator';

export class CreateProcessDto {
  @IsString()
  title: string;

  @IsString()
  position: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  evaluatorIds?: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  postulantIds?: string[];
}
