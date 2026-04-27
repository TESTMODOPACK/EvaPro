import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ImpersonationService } from './impersonation.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { setAccessTokenCookie } from '../cookie.helper';

class StartImpersonationDto {
  @IsUUID()
  tenantId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  /** Explicit target user id. If omitted we pick the oldest active tenant_admin. */
  @IsUUID()
  @IsOptional()
  targetUserId?: string;
}

// P1.3: getClientIp centralizado (ver auth.controller).
import { getClientIp } from '../../../common/utils/get-client-ip';

/**
 * Support/ops operations. Only super_admin for `start`; the `end` endpoint
 * is called BY the impersonation JWT itself (the super_admin operating as a
 * tenant user), so it only requires a valid JWT.
 */
@Controller('support')
export class ImpersonationController {
  constructor(
    private readonly svc: ImpersonationService,
    private readonly configService: ConfigService,
  ) {}

  private get isProd(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  @Post('impersonate')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async start(
    @Req() req: any,
    @Body() dto: StartImpersonationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Safety: even RolesGuard should have caught this, but belt + suspenders.
    // Don't allow an impersonation token to start ANOTHER impersonation —
    // the `impersonatedBy` claim would have to nest, which we don't support.
    if (req.user?.impersonatedBy) {
      throw new ForbiddenException('No se puede iniciar una impersonación desde otra impersonación.');
    }
    const result = await this.svc.start(
      req.user.userId,
      dto.tenantId,
      dto.reason,
      dto.targetUserId,
      getClientIp(req),
    );
    // F3 Fase 2 — Reemplaza la cookie del super_admin con la cookie de
    // impersonacion. La cookie original se sobrescribe; al terminar
    // (`/support/impersonate/end`) se restaura la del super_admin.
    setAccessTokenCookie(res, result.access_token, this.isProd);
    return result;
  }

  @Post('impersonate/end')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async end(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    // Only callable by an impersonation token — if there's no
    // `impersonatedBy` claim, there's nothing to end.
    if (!req.user?.impersonatedBy) {
      throw new ForbiddenException('No estás en una sesión de impersonación.');
    }
    // `iat` in the JWT payload is the start time in seconds; we expose it
    // to the service for duration calculation. `req.user` only has our
    // subset, so read from the raw token via req.headers if needed.
    const authHeader: string = req.headers?.authorization || '';
    let startedAtMs: number | undefined;
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    try {
      const [, body] = token.split('.');
      if (body) {
        const parsed = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
        if (typeof parsed.iat === 'number') startedAtMs = parsed.iat * 1000;
      }
    } catch {
      // Don't fail the end call because we can't decode — just skip timing.
    }
    const result = await this.svc.end(
      req.user.impersonatedBy,
      req.user.userId,
      req.user.tenantId ?? null,
      startedAtMs,
      getClientIp(req),
    );
    // F3 Fase 2 — Restaura la cookie del super_admin (el JWT original).
    setAccessTokenCookie(res, result.access_token, this.isProd);
    return result;
  }
}
