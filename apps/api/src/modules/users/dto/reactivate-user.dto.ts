import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * DTO para reactivar un usuario previamente desvinculado (boomerang rehire).
 *
 * Todos los campos son opcionales; el comportamiento por defecto es:
 *   - Forzar password reset (mustChangePassword = true) + temp password
 *   - Bump tokenVersion (invalidar cualquier JWT residual)
 *   - Limpiar departureDate
 *   - Mantener 2FA desactivado (fue limpiado al desvincular)
 *   - Enviar email "welcome back" con la temp password
 *
 * Nota sobre decoradores: ver nota en CreateDepartureDto — sin decoradores
 * el body se queda vacío con whitelist:true en el ValidationPipe global.
 */
export class ReactivateUserDto {
  /** Nota administrativa opcional documentando el motivo de reactivación.
   *  Se registra en el audit log, no se persiste en User. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reasonForReactivation?: string;

  /** Si se provee, asigna este manager al reactivado. Útil cuando el user
   *  vuelve a una estructura distinta a la que tenía. Si se omite, se
   *  mantiene managerId = null (admin debe asignar manualmente). */
  @IsOptional()
  @IsUUID()
  managerId?: string | null;
}
