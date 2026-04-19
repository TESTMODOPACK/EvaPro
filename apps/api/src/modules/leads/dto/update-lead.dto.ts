import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { LeadStatus } from '../entities/lead.entity';

/**
 * DTO del endpoint admin PATCH /leads/:id — actualización del pipeline
 * por parte del super_admin (cambio de estado, asignación, notas internas).
 */
export class UpdateLeadDto {
  @IsOptional()
  @IsIn(['new', 'contacted', 'qualified', 'converted', 'discarded'])
  status?: LeadStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  internalNotes?: string;

  @IsOptional()
  @IsUUID()
  assignedTo?: string | null;

  @IsOptional()
  @IsUUID()
  convertedTenantId?: string | null;
}
