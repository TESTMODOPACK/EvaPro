import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class ValidateTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  token: string;
}
