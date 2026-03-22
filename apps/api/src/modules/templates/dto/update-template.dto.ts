import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateTemplateDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsOptional()
  sections?: any[];

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
