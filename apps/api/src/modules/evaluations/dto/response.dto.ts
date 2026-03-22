import { IsNotEmpty, IsOptional } from 'class-validator';

export class SaveResponseDto {
  @IsNotEmpty()
  answers: any;
}

export class SubmitResponseDto {
  @IsNotEmpty()
  answers: any;

  @IsOptional()
  comments?: string;
}
