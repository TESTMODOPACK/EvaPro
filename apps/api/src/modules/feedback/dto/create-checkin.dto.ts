import { IsDateString, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateCheckInDto {
  @IsUUID()
  employeeId: string;

  @IsDateString()
  scheduledDate: string;

  @IsString()
  @IsNotEmpty()
  topic: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateCheckInDto {
  @IsString()
  @IsOptional()
  topic?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsOptional()
  actionItems?: { text: string; completed: boolean }[];
}
