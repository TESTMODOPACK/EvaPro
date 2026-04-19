import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { getClientIp } from '../../common/utils/get-client-ip';

// ─── Rate limiting (in-memory, mismo patrón que unsubscribe.controller.ts) ──
//
// Lead capture es PÚBLICO sin auth, por lo que es un target natural para
// bots + form spam. Limite conservador: 5 intentos por IP en 10 minutos,
// bloqueo de 1 hora al pasar el límite. En producción con 1 VPS esto es
// suficiente; con réplicas habría que migrar a Redis (P0-6 del roadmap).

interface AttemptRecord {
  count: number;
  blockedUntil: number;
  lastAttempt: number;
}
const attempts = new Map<string, AttemptRecord>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000; // 10 min
const BLOCK_MS = 60 * 60 * 1000; // 1 h cooldown

function checkRate(ip: string): void {
  const rec = attempts.get(ip);
  if (!rec) return;
  if (rec.blockedUntil > Date.now()) {
    const minutes = Math.ceil((rec.blockedUntil - Date.now()) / 60000);
    throw new HttpException(
      `Demasiadas solicitudes desde tu IP. Inténtalo de nuevo en ${minutes} minuto${minutes > 1 ? 's' : ''}.`,
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

/**
 * Endpoint público de captura de leads (sin JWT). Llega desde:
 *   - https://ascenda.cl → form en landing corporativa
 *   - https://eva360.ascenda.cl/contacto → si algún día se agrega un form en la app
 *
 * Seguridad multicapa:
 *   1. Rate limit por IP (above).
 *   2. CAPTCHA Turnstile verificado server-side contra Cloudflare.
 *   3. Validación estricta del DTO (class-validator).
 *   4. Sanitización (trim) en el DTO.
 *
 * No retorna el id completo del lead al cliente — solo confirma la recepción
 * para no facilitar enumeration.
 */
@Controller('public/leads')
export class LeadsPublicController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() dto: CreateLeadDto, @Req() req: any) {
    const ip = getClientIp(req) || 'unknown';
    checkRate(ip);
    recordAttempt(ip);

    if (!dto?.message || dto.message.trim().length < 15) {
      throw new BadRequestException('El mensaje debe tener al menos 15 caracteres.');
    }

    const userAgent: string | null =
      typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null;

    const { queuedAt } = await this.leadsService.createFromPublic(dto, ip, userAgent);

    // Respuesta intencionalmente minimal — el cliente solo necesita saber
    // que llegó OK. El email auto-responder confirma el detalle al lead.
    return {
      ok: true,
      queuedAt,
      message: 'Gracias. Te contactaremos en menos de 24 horas hábiles.',
    };
  }
}
