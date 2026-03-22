import { IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { Sentiment } from '../entities/quick-feedback.entity';

export class CreateQuickFeedbackDto {
  @IsUUID()
  toUserId: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsEnum(Sentiment)
  sentiment: Sentiment;

  @IsString()
  @IsOptional()
  category?: string;

  @IsBoolean()
  @IsOptional()
  isAnonymous?: boolean;
}
