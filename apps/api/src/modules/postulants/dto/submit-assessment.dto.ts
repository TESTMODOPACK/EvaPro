import { IsUUID, IsArray, ValidateNested, IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CompetencyScoreDto {
  @IsUUID()
  competencyId: string;

  @IsInt()
  @Min(1)
  @Max(10)
  score: number;

  @IsString()
  @IsOptional()
  comment?: string;
}

export class SubmitAssessmentDto {
  @IsUUID()
  entryId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompetencyScoreDto)
  scores: CompetencyScoreDto[];
}
