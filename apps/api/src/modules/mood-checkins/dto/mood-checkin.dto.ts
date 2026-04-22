import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class SubmitMoodCheckinDto {
  @IsInt()
  @Min(1, { message: 'score debe estar entre 1 y 5' })
  @Max(5, { message: 'score debe estar entre 1 y 5' })
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
