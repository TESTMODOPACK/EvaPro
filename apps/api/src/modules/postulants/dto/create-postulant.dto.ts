import { IsString, IsEmail, IsOptional, IsUUID, IsIn } from 'class-validator';

export class CreatePostulantDto {
  @IsIn(['external', 'internal'])
  type: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
