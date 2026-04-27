import { Controller, Post, Get, Body, Req, Res, UseGuards, Request, UnauthorizedException, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordPolicyService } from './password-policy.service';
import { SsoService } from './sso/sso.service';
import { NoImpersonation } from '../../common/decorators/no-impersonation.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { setAccessTokenCookie, clearAccessTokenCookie } from './cookie.helper';

class RequestResetDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @MinLength(6)
  newPassword: string;

  @IsString()
  @IsOptional()
  tenantSlug?: string;
}

// ─── In-memory rate limiter for auth endpoints ─────────────────────────
//
// Tres buckets separados con distintos limites:
// - login:         5 intentos / 15 min block / clave IP+email
// - request-reset: 3 requests / 30 min block / clave IP (evita enumeracion
//                  de emails y flood de SMTP)
// - reset-password:5 intentos / 10 min block / clave IP+email (bruteforce del
//                  codigo de 6 digitos)
//
// En memoria significa que se resetean al reiniciar el contenedor. Aceptable
// para la Fase 0 — en Fase 3 se reemplaza por Redis cuando introduzcamos la
// infra de queues.
interface AttemptRecord { count: number; blockedUntil: number; lastAttempt: number }
const loginAttempts = new Map<string, AttemptRecord>();
const resetRequestAttempts = new Map<string, AttemptRecord>();
const resetCodeAttempts = new Map<string, AttemptRecord>();

const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const MAX_RESET_REQUESTS = 3;
const RESET_REQUEST_BLOCK_MS = 30 * 60 * 1000; // 30 minutes

const MAX_RESET_CODE_ATTEMPTS = 5;
const RESET_CODE_BLOCK_MS = 10 * 60 * 1000; // 10 minutes

function getRateLimitKey(ip: string, email: string): string {
  return `${ip}:${email.toLowerCase()}`;
}

/** Generic rate limiter check that throws with a readable message. Used by
 *  all three buckets below with their own map + config. */
function checkBucket(
  map: Map<string, AttemptRecord>,
  key: string,
  operation: string,
): void {
  const record = map.get(key);
  if (!record) return;
  if (record.blockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((record.blockedUntil - Date.now()) / 60000);
    throw new BadRequestException(
      `Demasiados intentos de ${operation}. Inténtalo de nuevo en ${minutesLeft} minuto${minutesLeft > 1 ? 's' : ''}.`,
    );
  }
}

/** Registra un intento fallido. Si el ultimo intento ocurrio hace mas de
 *  ATTEMPT_WINDOW_MS, la ventana se reinicia (para no castigar a un usuario
 *  que vuelve al dia siguiente con password fresco). Si acumula `maxAttempts`
 *  intentos dentro de la ventana, marca el bucket como bloqueado por
 *  `blockMs` milisegundos. */
function recordBucketAttempt(
  map: Map<string, AttemptRecord>,
  key: string,
  maxAttempts: number,
  blockMs: number,
): void {
  const now = Date.now();
  const record = map.get(key);
  if (!record || now - record.lastAttempt > ATTEMPT_WINDOW_MS) {
    map.set(key, { count: 1, blockedUntil: 0, lastAttempt: now });
    return;
  }
  record.count++;
  record.lastAttempt = now;
  if (record.count >= maxAttempts) {
    record.blockedUntil = now + blockMs;
  }
}

// ─── Login bucket ─────────────────────────────────────────────────────
function checkRateLimit(ip: string, email: string): void {
  checkBucket(loginAttempts, getRateLimitKey(ip, email), 'inicio de sesión');
}
function recordFailedAttempt(ip: string, email: string): void {
  recordBucketAttempt(loginAttempts, getRateLimitKey(ip, email), MAX_LOGIN_ATTEMPTS, BLOCK_DURATION_MS);
}
function clearAttempts(ip: string, email: string): void {
  loginAttempts.delete(getRateLimitKey(ip, email));
}

// ─── Reset-request bucket (solicitar codigo de recuperacion) ──────────
function checkResetRequestLimit(ip: string): void {
  checkBucket(resetRequestAttempts, ip, 'solicitud de recuperación');
}
function recordResetRequest(ip: string): void {
  recordBucketAttempt(resetRequestAttempts, ip, MAX_RESET_REQUESTS, RESET_REQUEST_BLOCK_MS);
}

// ─── Reset-code bucket (ingresar codigo + nueva password) ─────────────
function checkResetCodeLimit(ip: string, email: string): void {
  checkBucket(resetCodeAttempts, getRateLimitKey(ip, email), 'restablecimiento');
}
function recordResetCodeAttempt(ip: string, email: string): void {
  recordBucketAttempt(resetCodeAttempts, getRateLimitKey(ip, email), MAX_RESET_CODE_ATTEMPTS, RESET_CODE_BLOCK_MS);
}
function clearResetCodeAttempts(ip: string, email: string): void {
  resetCodeAttempts.delete(getRateLimitKey(ip, email));
}

// Garbage-collect entradas viejas cada 30 minutos. Una entrada se puede
// borrar si (a) ya salio del bloqueo (blockedUntil < now) Y (b) el ultimo
// intento fue hace mas que la ventana larga — usamos el mayor de los tres
// bloqueos para no borrar prematuramente.
const MAX_BLOCK_WINDOW_MS = Math.max(BLOCK_DURATION_MS, RESET_REQUEST_BLOCK_MS, RESET_CODE_BLOCK_MS);
setInterval(() => {
  const now = Date.now();
  for (const map of [loginAttempts, resetRequestAttempts, resetCodeAttempts]) {
    map.forEach((v, k) => {
      if (v.blockedUntil < now && now - v.lastAttempt > MAX_BLOCK_WINDOW_MS) {
        map.delete(k);
      }
    });
  }
}, 30 * 60 * 1000);

/** Extract the client IP from a request, handling x-forwarded-for. */
// P1.3: getClientIp centralizado en common/utils — usa req.ip resolvido
// por Express con trust proxy (main.ts). Antes leía el header directo,
// falseable por cualquier atacante.
import { getClientIp } from '../../common/utils/get-client-ip';

// ─── Password policy ───────────────────────────────────────────────────
// The hardcoded regex that used to live here was replaced by a tenant-
// configurable `PasswordPolicyService` (Grupo C / C1). The validation is
// enforced inside auth.service methods (changePasswordFirstLogin,
// resetPassword) because they have access to the resolved tenantId. The
// controller stays thin and just delegates.

// ─── Controller ────────────────────────────────────────────────────────

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordPolicyService: PasswordPolicyService,
    private readonly ssoService: SsoService,
    private readonly configService: ConfigService,
  ) {}

  /** Helper: NODE_ENV === 'production' para configurar cookies con
   *  secure: true en prod (HTTPS only) y false en dev (localhost HTTP). */
  private get isProd(): boolean {
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * GET /auth/password-policy — returns the ACTIVE password rules for the
   * caller's tenant, already merged with defaults and clamped. The frontend
   * uses this to render the strength meter with accurate rules (we never
   * hardcode the policy client-side).
   */
  @Get('password-policy')
  @UseGuards(AuthGuard('jwt'))
  async passwordPolicy(@Request() req: any) {
    return this.passwordPolicyService.resolvePolicy(req.user.tenantId ?? null);
  }

  /**
   * GET /auth/password-policy/public — same as above but keyed by email so
   * the unauthenticated force-change modal on /login can show the right
   * rules before the user has a session. We do NOT reveal whether the email
   * exists — if the email is unknown we still return the default policy.
   */
  @Get('password-policy/public')
  @Public()
  async passwordPolicyPublic(@Req() req: any) {
    const email = typeof req.query?.email === 'string' ? req.query.email : '';
    const tenantSlug = typeof req.query?.tenantSlug === 'string' ? req.query.tenantSlug : undefined;
    if (!email) return this.passwordPolicyService.resolvePolicy(null);
    // findByEmail is tenant-scoped; `null` tenantId → default policy.
    const tenantId = await this.authService.resolveTenantIdForEmail(email, tenantSlug);
    return this.passwordPolicyService.resolvePolicy(tenantId);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = getClientIp(req);

    // Rate limit check
    checkRateLimit(clientIp, loginDto.email);

    const user = await this.authService.validateUser(
      loginDto.email,
      loginDto.password,
      loginDto.tenantId,
    );

    if (!user) {
      // Record failed attempt + audit log
      recordFailedAttempt(clientIp, loginDto.email);
      await this.authService.logFailedLogin(loginDto.email, clientIp, loginDto.tenantId);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    // SSO enforcement — if the tenant has `requireSso=true` for this user's
    // email domain, password login is blocked. Super_admin is exempt (never
    // locked out by a broken IdP).
    if (user.role !== 'super_admin') {
      const ssoGate = await this.ssoService.isSsoRequiredForEmail(user.email, user.tenantId);
      if (ssoGate.required) {
        return {
          requiresSso: true,
          message: 'Tu organización requiere iniciar sesión con SSO.',
          loginUrl: ssoGate.loginUrl,
        };
      }
    }

    // Password expired? Block the session and force a change without
    // emitting the full JWT (user will hit /auth/change-password next).
    if ((user as any).passwordExpired) {
      return {
        mustChangePassword: true,
        reason: 'expired',
        message: 'Tu contraseña ha expirado. Debes cambiarla para continuar.',
      };
    }

    // 2FA check: if enabled and no code provided, return requires2FA flag
    if (user.twoFactorEnabled) {
      const twoFactorCode = (loginDto as any).twoFactorCode;
      if (!twoFactorCode) {
        // Don't clear attempts yet — they still need to provide 2FA code
        return { requires2FA: true, message: 'Se requiere código de autenticación de dos factores.' };
      }
      if (!this.authService.verify2FACode(user, twoFactorCode)) {
        recordFailedAttempt(clientIp, loginDto.email);
        throw new UnauthorizedException('Código 2FA inválido');
      }
    }

    // Success — clear rate limit
    clearAttempts(clientIp, loginDto.email);

    const result = await this.authService.login(user, clientIp);

    // F3 — setear cookie httpOnly con el JWT alongside body. Backward-compat:
    // body sigue retornando access_token para que el frontend actual (que lee
    // del body y guarda en localStorage) siga funcionando. Fase 2 elimina el
    // body y el frontend usa solo cookie.
    setAccessTokenCookie(res, result.access_token, this.isProd);

    return {
      ...result,
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }

  @Post('refresh')
  // @Public bypassa el JwtAuthGuard global; el method-level
  // AuthGuard('jwt-refresh') es el que hace la validacion real (acepta
  // tokens expirados dentro del grace period — algo que el guard global
  // 'jwt' rechazaria).
  @Public()
  @UseGuards(AuthGuard('jwt-refresh'))
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refreshToken(
      req.user.userId,
      req.user.tenantId,
    );
    // F3 — actualizar cookie httpOnly con el nuevo access token (el cron de
    // refresh del frontend ahora dispara cookie new + body new; cuando Fase
    // 2 elimine el body, este endpoint solo setea cookie).
    setAccessTokenCookie(res, result.access_token, this.isProd);
    return result;
  }

  /**
   * F3 — Logout server-side. Limpia la cookie httpOnly del access_token
   * para que el siguiente request no esté autenticado. El frontend además
   * limpia su propio estado (Zustand, react-query, sentry).
   *
   * @Public porque el caller puede no estar autenticado (cookie expirada,
   * navegación post-logout, etc.) — siempre devuelve 200 sin throws.
   */
  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    clearAccessTokenCookie(res, this.isProd);
    return { ok: true };
  }

  @Post('request-reset')
  @Public()
  @HttpCode(HttpStatus.OK)
  async requestReset(@Body() dto: RequestResetDto, @Req() req: any) {
    const clientIp = getClientIp(req);
    // Rate limit SIEMPRE por IP para evitar (a) enumeracion de emails validos
    // y (b) flood del proveedor de email. Cuenta tanto si el email existe
    // como si no, porque el endpoint devuelve 200 en ambos casos.
    checkResetRequestLimit(clientIp);
    recordResetRequest(clientIp);
    await this.authService.requestPasswordReset(dto.email, dto.tenantSlug);
    return { message: 'Si el correo existe, se envió un código de recuperación.' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: any) {
    const clientIp = getClientIp(req);
    // Rate limit por IP+email para bloquear bruteforce del codigo de 6
    // digitos. 5 intentos -> bloqueo por 10 min. Policy validation happens
    // inside auth.service.resetPassword with tenant-scoped rules.
    checkResetCodeLimit(clientIp, dto.email);
    try {
      await this.authService.resetPassword(dto.email, dto.code, dto.newPassword, dto.tenantSlug);
    } catch (err) {
      // Registrar intento fallido ANTES de propagar la excepcion, asi el
      // atacante no puede evadir el contador provocando 500s.
      recordResetCodeAttempt(clientIp, dto.email);
      throw err;
    }
    clearResetCodeAttempts(clientIp, dto.email);
    return { message: 'Contraseña actualizada exitosamente.' };
  }

  @Post('change-password')
  @Public()
  @NoImpersonation()
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: { email: string; currentPassword: string; newPassword: string; tenantSlug?: string }) {
    if (!dto.email || !dto.currentPassword || !dto.newPassword) {
      throw new BadRequestException('Todos los campos son requeridos.');
    }
    // Policy validation happens inside auth.service.changePasswordFirstLogin
    // where we have the user's tenantId for per-tenant rules.
    await this.authService.changePasswordFirstLogin(dto.email, dto.currentPassword, dto.newPassword, dto.tenantSlug);
    return { message: 'Contraseña actualizada exitosamente.' };
  }

  // ─── 2FA Endpoints ───────────────────────────────────────────────

  /** Generate 2FA secret and QR URI */
  @Post('2fa/setup')
  @NoImpersonation()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async setup2FA(@Request() req: any) {
    return this.authService.setup2FA(req.user.userId, req.user.tenantId ?? null);
  }

  /** Verify code and enable 2FA */
  @Post('2fa/enable')
  @NoImpersonation()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async enable2FA(@Request() req: any, @Body() dto: { code: string }) {
    if (!dto.code) throw new BadRequestException('Código requerido');
    return this.authService.enable2FA(req.user.userId, req.user.tenantId ?? null, dto.code);
  }

  /** Disable 2FA (requires password) */
  @Post('2fa/disable')
  @NoImpersonation()
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async disable2FA(@Request() req: any, @Body() dto: { password: string }) {
    if (!dto.password) throw new BadRequestException('Contraseña requerida');
    return this.authService.disable2FA(req.user.userId, req.user.tenantId ?? null, dto.password);
  }
}
