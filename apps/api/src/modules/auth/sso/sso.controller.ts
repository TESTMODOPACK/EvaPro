import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { NoImpersonation } from '../../../common/decorators/no-impersonation.decorator';
import { SsoService } from './sso.service';
import { SsoConfigDto, SsoDiscoverDto } from './dto/sso-config.dto';

const STATE_COOKIE = 'eva_sso_state';

@Controller('auth/sso')
export class SsoController {
  constructor(private readonly svc: SsoService) {}

  // ─── Tenant admin: manage config ──────────────────────────────────────

  @Get('config')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('tenant_admin')
  async getConfig(@Req() req: any) {
    return this.svc.getConfig(req.user.tenantId);
  }

  @Post('config')
  @NoImpersonation()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('tenant_admin')
  @HttpCode(HttpStatus.OK)
  async upsertConfig(@Req() req: any, @Body() dto: SsoConfigDto) {
    await this.svc.upsertConfig(req.user.tenantId, dto, req.user.userId);
    return { success: true };
  }

  @Delete('config')
  @NoImpersonation()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('tenant_admin')
  async disable(@Req() req: any) {
    await this.svc.disable(req.user.tenantId, req.user.userId);
    return { success: true };
  }

  // ─── Public: discover SSO for an email ────────────────────────────────

  @Post('discover')
  @HttpCode(HttpStatus.OK)
  async discover(@Body() dto: SsoDiscoverDto) {
    return this.svc.discoverByEmail(dto.email, dto.tenantSlug);
  }

  // ─── Public: start the OIDC flow ──────────────────────────────────────

  @Get('login')
  async login(@Query('tenantId', new ParseUUIDPipe()) tenantId: string, @Res({ passthrough: false }) res: any) {
    if (!tenantId) throw new BadRequestException('tenantId requerido');
    const { authorizeUrl, stateCookie } = await this.svc.startLogin(tenantId);
    // HttpOnly + SameSite=Lax so the cookie survives the IdP redirect back
    // to us. Secure is set in production; local dev over http would break it.
    res.cookie(STATE_COOKIE, stateCookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 10 * 60 * 1000, // 10 min
      path: '/auth/sso',
    });
    return res.redirect(authorizeUrl);
  }

  // ─── Public: callback ─────────────────────────────────────────────────

  @Get('callback')
  async callback(@Req() req: any, @Res({ passthrough: false }) res: any) {
    const cookie = req.cookies?.[STATE_COOKIE];
    const { access_token } = await this.svc.handleCallback(cookie, req.query as any);
    // Clear the state cookie — its job is done.
    res.clearCookie(STATE_COOKIE, { path: '/auth/sso' });
    // Ship the token to the SPA via URL — same convention as the normal
    // login flow when redirecting from an external auth step.
    const frontend = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';
    return res.redirect(`${frontend}/login?sso_token=${encodeURIComponent(access_token)}`);
  }
}
