import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class CreateCheckInDto {
  @IsUUID()
  employeeId: string;

  @IsDateString()
  scheduledDate: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'scheduledTime debe tener formato HH:mm' })
  scheduledTime: string;

  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsUUID()
  @IsOptional()
  locationId?: string;

  @IsUUID()
  @IsOptional()
  developmentPlanId?: string;
}

export class UpdateCheckInDto {
  @IsString()
  @IsOptional()
  topic?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'scheduledTime debe tener formato HH:mm' })
  @IsOptional()
  scheduledTime?: string;

  @IsUUID()
  @IsOptional()
  locationId?: string;

  @IsOptional()
  actionItems?: { text: string; completed: boolean }[];
}

export class RejectCheckInDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
