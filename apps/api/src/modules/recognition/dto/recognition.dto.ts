import { IsString, IsUUID, IsOptional, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreateRecognitionDto {
  @IsUUID()
  toUserId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  message: string;

  @IsUUID()
  @IsOptional()
  valueId?: string;

  // Points are server-controlled (DEFAULT_RECOGNITION_POINTS), not user-settable
}

export class CreateBadgeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  icon?: string;

  @IsString()
  @IsOptional()
  color?: string;

  @IsOptional()
  criteria?: { type: string; threshold: number } | null;

  @IsInt()
  @Min(0)
  @Max(1000)
  @IsOptional()
  pointsReward?: number;
}

export class AwardBadgeDto {
  @IsUUID()
  userId: string;

  @IsUUID()
  badgeId: string;
}

export class AddReactionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  emoji: string;
}
