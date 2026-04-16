import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SsoConfigDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  issuerUrl: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clientId: string;

  /**
   * Plaintext secret provided by the admin on creation or rotation. We
   * encrypt + persist; never returned. Optional on edit when the row
   * already has a secret stored — the service keeps the existing ciphertext.
   */
  @IsString()
  @IsOptional()
  @MinLength(8)
  @MaxLength(500)
  clientSecret?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  requireSso?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedEmailDomains?: string[];

  @IsOptional()
  @IsObject()
  roleMapping?: Record<string, string[]>;
}

export class SsoDiscoverDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  /** Optional: narrow the tenant if the email matches more than one. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tenantSlug?: string;
}
