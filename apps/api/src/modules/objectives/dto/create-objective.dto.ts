import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ObjectiveType } from '../entities/objective.entity';

export class CreateObjectiveDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(ObjectiveType)
  @IsOptional()
  type?: ObjectiveType;

  @IsDateString()
  @IsOptional()
  targetDate?: string;

  @IsUUID()
  @IsOptional()
  cycleId?: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  weight?: number;

  @IsUUID()
  @IsOptional()
  parentObjectiveId?: string;

  // B3-18: declarar userId/tenantId como UUIDs validados para que el
  // ValidationPipe global (whitelist:true) NO los strippee. Antes el
  // controller los leía con `(dto as any).userId/tenantId` pero el
  // pipe ya los había descartado → la feature "asignar objetivo a
  // otro" para tenant_admin/manager estaba MUERTA y super_admin no
  // podía crear (resolveOperatingTenantId requiere dto.tenantId).
  // El controller decide cuándo honrarlos según el rol:
  //   - super_admin: ambos requeridos
  //   - tenant_admin/manager: userId opcional (assign-to-other)
  //   - employee: siempre crea para self (controller ignora userId)
  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsUUID()
  @IsOptional()
  tenantId?: string;
}
