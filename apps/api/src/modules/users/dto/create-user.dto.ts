import { IsEmail, IsEnum, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, IsDateString, IsInt } from 'class-validator';

export enum UserRole {
  SUPER_ADMIN = 'super_admin',       // Super Admin (multi-tenant)
  TENANT_ADMIN = 'tenant_admin',     // Encargado del Sistema (RRHH / Gerente)
  MANAGER = 'manager',               // Encargado de Equipo
  EMPLOYEE = 'employee',             // Colaborador
  EXTERNAL = 'external',             // Asesor Externo (read-only reviews)
}

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsNotEmpty()
  password: string;

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

  @IsInt()
  @IsOptional()
  hierarchyLevel?: number;

  // ─── Demographic fields (for DEI analytics) ───────────────────
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
}
