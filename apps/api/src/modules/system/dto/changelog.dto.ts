import { IsString, IsEnum, IsOptional, IsBoolean, MaxLength, MinLength } from 'class-validator';
import { ChangelogType } from '../entities/system-changelog.entity';

export class CreateChangelogDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  version: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsEnum(ChangelogType)
  @IsOptional()
  type?: ChangelogType;
}

export class UpdateChangelogDto {
  @IsString()
  @MaxLength(20)
  @IsOptional()
  version?: string;

  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string;

  @IsEnum(ChangelogType)
  @IsOptional()
  type?: ChangelogType;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
