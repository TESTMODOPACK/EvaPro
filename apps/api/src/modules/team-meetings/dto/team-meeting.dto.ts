import {
  ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt,
  IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export class CreateTeamMeetingDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  scheduledDate: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, { message: 'scheduledTime debe ser HH:mm' })
  scheduledTime?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Debes invitar al menos 1 participante' })
  @ArrayUnique()
  @IsUUID('all', { each: true })
  participantIds: string[];
}

export class UpdateTeamMeetingDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/)
  scheduledTime?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  participantIds?: string[];
}

export class AddAgendaTopicDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  text: string;
}

export class RespondInvitationDto {
  @IsIn(['accepted', 'declined'])
  status: 'accepted' | 'declined';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  declineReason?: string;
}

export class CompleteTeamMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  minutes?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsArray()
  actionItems?: Array<{
    text: string;
    completed?: boolean;
    assigneeId?: string;
    assigneeName?: string;
    dueDate?: string;
  }>;
}

export class CancelTeamMeetingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
