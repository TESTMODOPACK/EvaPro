import { IsString, IsUUID, IsOptional, IsInt, Min, Max, MinLength, MaxLength, IsBoolean } from 'class-validator';

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

  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  points?: number;
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
  criteria?: any;

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
