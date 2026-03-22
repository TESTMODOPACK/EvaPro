import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';

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
}
