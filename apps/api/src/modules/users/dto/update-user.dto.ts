import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { UserRole } from './create-user.dto';

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  rut?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsUUID()
  @IsOptional()
  managerId?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  position?: string;

  @IsDateString()
  @IsOptional()
  hireDate?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  // ─── Demographic fields ───────────────────────────────────────
  @IsIn(['masculino', 'femenino', 'no_binario', 'prefiero_no_decir'])
  @IsOptional()
  gender?: string;

  @IsDateString()
  @IsOptional()
  birthDate?: string;

  @IsString()
  @IsOptional()
  nationality?: string;

  @IsIn(['junior', 'mid', 'senior', 'lead', 'director', 'executive'])
  @IsOptional()
  seniorityLevel?: string;

  @IsIn(['indefinido', 'plazo_fijo', 'honorarios', 'practicante'])
  @IsOptional()
  contractType?: string;

  @IsIn(['oficina', 'remoto', 'hibrido'])
  @IsOptional()
  workLocation?: string;

  @IsIn(['es', 'en', 'pt'])
  @IsOptional()
  language?: string;

  @IsInt()
  @IsOptional()
  hierarchyLevel?: number;
}
