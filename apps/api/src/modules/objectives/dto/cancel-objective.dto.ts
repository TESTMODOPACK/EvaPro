import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para POST /objectives/:id/cancel (T7.2).
 *
 * `reason` es obligatorio — la razón es la diferencia clave con el viejo
 * "delete" que iba a ABANDONED sin trazabilidad. Min 5 caracteres para
 * evitar razones vacías o triviales tipo "x".
 */
export class CancelObjectiveDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5, {
    message: 'La razón de cancelación debe tener al menos 5 caracteres',
  })
  @MaxLength(1000)
  reason: string;
}
