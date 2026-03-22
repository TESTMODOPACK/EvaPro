import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsNotEmpty()
  sections: any[];

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
