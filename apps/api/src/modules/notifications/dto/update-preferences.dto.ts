import { IsBoolean, IsOptional } from 'class-validator';

/**
 * B2-05 — Whitelist explícita de las categorías que se pueden tocar vía
 * PATCH /notifications/preferences. Antes el endpoint recibía
 * `Record<string, boolean>` crudo y hacía un spread en
 * users.notification_preferences (JSONB) → un user podía inyectar
 * claves arbitrarias (p.ej. `__password_expiry_sent`) y alterar
 * comportamientos internos del sistema. Con esta DTO + el
 * ValidationPipe global (whitelist:true) las claves desconocidas se
 * descartan silenciosamente.
 *
 * Las categorías DEBEN coincidir con NOTIFICATION_CATEGORIES en
 * common/types/jsonb-schemas.ts (fuente única). El service además
 * filtra una segunda vez como defensa en profundidad.
 */
export class UpdatePreferencesDto {
  @IsBoolean()
  @IsOptional()
  evaluations?: boolean;

  @IsBoolean()
  @IsOptional()
  feedback?: boolean;

  @IsBoolean()
  @IsOptional()
  objectives?: boolean;

  @IsBoolean()
  @IsOptional()
  recognitions?: boolean;

  @IsBoolean()
  @IsOptional()
  development?: boolean;

  @IsBoolean()
  @IsOptional()
  surveys?: boolean;

  @IsBoolean()
  @IsOptional()
  digests?: boolean;

  @IsBoolean()
  @IsOptional()
  pending_reviews?: boolean;
}
