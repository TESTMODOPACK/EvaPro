import {
  IsString,
  IsNotEmpty,
  IsOptional,
  ValidateNested,
  IsObject,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Shape del PushSubscription.toJSON() del browser:
 *   { endpoint, keys: { p256dh, auth } }
 *
 * SECURITY (v3.0): el endpoint DEBE ser de un push service conocido
 * (FCM, Mozilla, Apple, Windows). No aceptamos URL arbitraria porque:
 *   - Prevención de SSRF: attacker suscribiría endpoint=http://internal-host
 *     y el backend haría requests internas al intentar enviar push.
 *   - Prevención de port scanning de red interna.
 *   - Prevención de DoS a terceros via nuestro servidor.
 *
 * Los hosts listados cubren los 4 push services que los principales
 * browsers (Chrome, Firefox, Safari, Edge) usan internamente. Si un
 * browser nuevo emerge, se agrega aquí.
 */
const ALLOWED_PUSH_HOSTS_REGEX =
  /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|web\.push\.apple\.com|[\w-]+\.notify\.windows\.com|wns[0-9-]*\.notify\.windows\.com)\//i;

class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  auth: string;
}

export class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @Matches(ALLOWED_PUSH_HOSTS_REGEX, {
    message:
      'endpoint debe ser de un push service válido (FCM, Mozilla, Apple, Windows)',
  })
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  userAgent?: string;
}
