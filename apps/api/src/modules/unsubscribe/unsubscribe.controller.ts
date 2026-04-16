import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  HttpException,
  BadRequestException,
} from '@nestjs/common';
import { UnsubscribeService } from './unsubscribe.service';
import { ValidateTokenDto } from './dto/validate-token.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

// ─── Rate limiting (in-memory, mismo patrón que auth.controller.ts) ──────
//
// Limite conservador para un endpoint PÚBLICO sin auth. Clave = IP. Esperamos
// volumen bajo (usuarios manejando preferencias, no bots). El patrón Redis
// queda para P0-6 del roadmap.

interface AttemptRecord {
  count: number;
  blockedUntil: number;
  lastAttempt: number;
}
const attempts = new Map<string, AttemptRecord>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000; // 5 min
const BLOCK_MS = 15 * 60 * 1000; // 15 min cooldown

function checkRate(ip: string): void {
  const rec = attempts.get(ip);
  if (!rec) return;
  if (rec.blockedUntil > Date.now()) {
    const minutes = Math.ceil((rec.blockedUntil - Date.now()) / 60000);
    // Mensaje genérico — no revela si la rate-limit es por IP o por token.
    throw new HttpException(
      `Demasiadas solicitudes. Inténtalo de nuevo en ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

function recordAttempt(ip: string): void {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.lastAttempt > WINDOW_MS) {
    attempts.set(ip, { count: 1, blockedUntil: 0, lastAttempt: now });
    return;
  }
  rec.count++;
  rec.lastAttempt = now;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.blockedUntil = now + BLOCK_MS;
  }
}

// GC periódico para no acumular entradas muertas.
setInterval(() => {
  const now = Date.now();
  attempts.forEach((v, k) => {
    if (v.blockedUntil < now && now - v.lastAttempt > WINDOW_MS) {
      attempts.delete(k);
    }
  });
}, 30 * 60 * 1000);

function getClientIp(req: any): string {
  const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
  if (typeof ip === 'string') return ip.split(',')[0].trim();
  if (Array.isArray(ip) && ip.length > 0) return ip[0];
  return 'unknown';
}

/**
 * Public endpoints for email unsubscribe. NO auth — authentication is done via
 * the signed HMAC token embedded in the email link. Prefix `/public/...` makes
 * it obvious that these bypass JWT.
 */
@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(private readonly svc: UnsubscribeService) {}

  /**
   * First call from the `/unsubscribe?token=xxx` page. Validates the token and
   * returns the user's email + current preferences so the UI can render.
   */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validate(@Body() dto: ValidateTokenDto, @Req() req: any) {
    const ip = getClientIp(req);
    checkRate(ip);
    recordAttempt(ip);

    const { user, tenant } = await this.svc.validate(dto.token);
    return this.svc.buildPublicPayload(user, tenant);
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  async update(@Body() dto: UpdatePreferencesDto, @Req() req: any) {
    const ip = getClientIp(req);
    checkRate(ip);
    recordAttempt(ip);

    const { user } = await this.svc.validate(dto.token);
    if (!dto.preferences || typeof dto.preferences !== 'object') {
      throw new BadRequestException('preferences requerido.');
    }
    await this.svc.updatePreferences(user.id, user.tenantId ?? null, dto.preferences, ip);
    return { success: true };
  }

  @Post('all')
  @HttpCode(HttpStatus.OK)
  async all(@Body() dto: ValidateTokenDto, @Req() req: any) {
    const ip = getClientIp(req);
    checkRate(ip);
    recordAttempt(ip);

    const { user } = await this.svc.validate(dto.token);
    await this.svc.unsubscribeAll(user.id, user.tenantId ?? null, ip);
    return { success: true };
  }
}
