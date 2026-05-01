import {
  Controller, Get, Post, Body, Param, Req, BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { RecruitmentService } from './recruitment.service';

/**
 * S7.1 — Controller publico (sin AuthGuard) para job board.
 *
 * Rutas:
 *   GET  /public/jobs/:tenantSlug/:processSlug         → metadata del proceso
 *   POST /public/jobs/:tenantSlug/:processSlug/apply  → auto-postulacion
 *
 * NOTA: este controller NO usa @Roles ni AuthGuard. Es la unica zona
 * publica del API recruitment. Toda la logica de validacion + rate
 * limit + dedup esta en el service para que funcione independiente del
 * caller.
 *
 * El captcha (hCaptcha o Turnstile) NO esta implementado aun — el rate
 * limit basico por IP cubre el caso comun. Si llega trafico abusivo a
 * produccion, anadir captcha como header `x-captcha-token` validado en
 * un Guard antes de llegar al service.
 */
@Controller('public/jobs')
export class PublicJobsController {
  constructor(private readonly service: RecruitmentService) {}

  @Get(':tenantSlug/:processSlug')
  getPublic(
    @Param('tenantSlug') tenantSlug: string,
    @Param('processSlug') processSlug: string,
  ) {
    return this.service.getPublicProcess(tenantSlug, processSlug);
  }

  @Post(':tenantSlug/:processSlug/apply')
  apply(
    @Param('tenantSlug') tenantSlug: string,
    @Param('processSlug') processSlug: string,
    @Body() dto: any,
    @Req() req: Request,
  ) {
    if (!dto || typeof dto !== 'object') {
      throw new BadRequestException('Body requerido.');
    }
    // Resolver IP desde headers comunes (x-forwarded-for) o fallback.
    const fwd = (req.headers['x-forwarded-for'] as string) || '';
    const ip = fwd.split(',')[0]?.trim() || req.socket?.remoteAddress || undefined;
    return this.service.applyToPublicProcess(
      tenantSlug,
      processSlug,
      {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        phone: dto.phone,
        linkedIn: dto.linkedIn,
        coverLetter: dto.coverLetter,
        cvUrl: dto.cvUrl,
      },
      ip,
    );
  }
}
