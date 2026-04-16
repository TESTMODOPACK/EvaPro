import { IsString, IsNotEmpty, MaxLength, IsObject, ValidateNested, IsOptional } from 'class-validator';

/**
 * Partial update of per-user notification preferences. Keys not present are
 * left unchanged server-side. Only the known categories (see
 * `NOTIFICATION_CATEGORIES` in `jsonb-schemas.ts`) are honored; unknown keys
 * are silently dropped to avoid the UI injecting arbitrary junk into JSONB.
 */
export class UpdatePreferencesDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024)
  token: string;

  @IsObject()
  @ValidateNested()
  @IsOptional()
  preferences?: Record<string, boolean>;
}
