import { IsString, IsUUID, Matches } from 'class-validator';

export class DeleteConfirmDto {
  @IsUUID()
  requestId: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'El código debe ser de 6 dígitos.' })
  code: string;
}
