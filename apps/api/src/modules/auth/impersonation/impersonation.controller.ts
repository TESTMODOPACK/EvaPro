import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ImpersonationService } from './impersonation.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';

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

function getClientIp(req: any): string | undefined {
  const ip = req.headers?.['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
  if (typeof ip === 'string') return ip.split(',')[0].trim();
  if (Array.isArray(ip) && ip.length > 0) return ip[0];
  return undefined;
}

/**
 * Support/ops operations. Only super_admin for `start`; the `end` endpoint
 * is called BY the impersonation JWT itself (the super_admin operating as a
 * tenant user), so it only requires a valid JWT.
 */
@Controller('support')
export class ImpersonationController {
  constructor(private readonly svc: ImpersonationService) {}

  @Post('impersonate')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  async start(@Req() req: any, @Body() dto: StartImpersonationDto) {
    // Safety: even RolesGuard should have caught this, but belt + suspenders.
    // Don't allow an impersonation token to start ANOTHER impersonation —
    // the `impersonatedBy` claim would have to nest, which we don't support.
    if (req.user?.impersonatedBy) {
      throw new ForbiddenException('No se puede iniciar una impersonación desde otra impersonación.');
    }
    return this.svc.start(
      req.user.userId,
      dto.tenantId,
      dto.reason,
      dto.targetUserId,
      getClientIp(req),
    );
  }

  @Post('impersonate/end')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async end(@Req() req: any) {
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
    return this.svc.end(
      req.user.impersonatedBy,
      req.user.userId,
      req.user.tenantId ?? null,
      startedAtMs,
      getClientIp(req),
    );
  }
}
