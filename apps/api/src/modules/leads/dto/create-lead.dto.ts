import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO del endpoint PUBLIC (sin auth) de captura de leads.
 * Todos los strings se trimmean y se validan tanto longitud como contenido
 * para evitar inyección de payloads excesivos desde bots.
 */
export class CreateLeadDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(2, 150, { message: 'El nombre debe tener entre 2 y 150 caracteres' })
  name: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(2, 150, { message: 'La empresa debe tener entre 2 y 150 caracteres' })
  company: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MaxLength(120)
  role?: string;

  @IsEmail({}, { message: 'Email inválido' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @MaxLength(200)
  email: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(6, 40, { message: 'Teléfono inválido' })
  phone: string;

  @IsOptional()
  @IsIn(['1-50', '51-200', '201-1000', '1000+'])
  companySize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(15, { message: 'El mensaje debe tener al menos 15 caracteres' })
  @MaxLength(2000)
  message: string;

  /**
   * Token del widget Turnstile emitido en el cliente. El backend lo verifica
   * contra https://challenges.cloudflare.com/turnstile/v0/siteverify antes
   * de aceptar el lead. Si TURNSTILE_SECRET_KEY no está seteado (dev),
   * el backend registra 'bypassed_dev' y acepta el lead igual para no
   * bloquear desarrollo local.
   */
  @IsString()
  @IsNotEmpty({ message: 'Captcha requerido' })
  captchaToken: string;

  /** 'ascenda.cl' | 'eva360.ascenda.cl' | 'other'. El backend valida el valor. */
  @IsOptional()
  @IsIn(['ascenda.cl', 'eva360.ascenda.cl', 'other'])
  origin?: string;
}
