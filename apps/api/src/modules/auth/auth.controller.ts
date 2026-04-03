import { Controller, Post, Body, Req, UseGuards, Request, UnauthorizedException, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

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
const loginAttempts = new Map<string, { count: number; blockedUntil: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const BLOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function getRateLimitKey(ip: string, email: string): string {
  return `${ip}:${email.toLowerCase()}`;
}

function checkRateLimit(ip: string, email: string): void {
  const key = getRateLimitKey(ip, email);
  const record = loginAttempts.get(key);
  if (!record) return;

  if (record.blockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((record.blockedUntil - Date.now()) / 60000);
    throw new BadRequestException(
      `Demasiados intentos fallidos. Cuenta bloqueada por ${minutesLeft} minuto${minutesLeft > 1 ? 's' : ''}. Intenta más tarde.`,
    );
  }
}

function recordFailedAttempt(ip: string, email: string): void {
  const key = getRateLimitKey(ip, email);
  const record = loginAttempts.get(key);
  const now = Date.now();

  if (!record || now - (record.blockedUntil - BLOCK_DURATION_MS) > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, blockedUntil: 0 });
    return;
  }

  record.count++;
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    record.blockedUntil = now + BLOCK_DURATION_MS;
  }
}

function clearAttempts(ip: string, email: string): void {
  loginAttempts.delete(getRateLimitKey(ip, email));
}

// Clean up old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  loginAttempts.forEach((v, k) => {
    if (v.blockedUntil < now && now - v.blockedUntil > ATTEMPT_WINDOW_MS) {
      loginAttempts.delete(k);
    }
  });
}, 30 * 60 * 1000);

// ─── Password policy ───────────────────────────────────────────────────
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const PASSWORD_POLICY_MSG = 'La contraseña debe tener al menos 8 caracteres, una mayúscula, una minúscula y un número.';

function validatePasswordPolicy(password: string): void {
  if (!password || password.length < PASSWORD_MIN_LENGTH || !PASSWORD_POLICY_REGEX.test(password)) {
    throw new BadRequestException(PASSWORD_POLICY_MSG);
  }
}

// ─── Controller ────────────────────────────────────────────────────────

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: any) {
    const ip = req.headers['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
    const clientIp = typeof ip === 'string' ? ip.split(',')[0].trim() : ip?.[0] || 'unknown';

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

    return {
      ...result,
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }

  @Post('request-reset')
  @HttpCode(HttpStatus.OK)
  async requestReset(@Body() dto: RequestResetDto) {
    await this.authService.requestPasswordReset(dto.email, dto.tenantSlug);
    return { message: 'Si el correo existe, se envió un código de recuperación.' };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    validatePasswordPolicy(dto.newPassword);
    await this.authService.resetPassword(dto.email, dto.code, dto.newPassword, dto.tenantSlug);
    return { message: 'Contraseña actualizada exitosamente.' };
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: { email: string; currentPassword: string; newPassword: string; tenantSlug?: string }) {
    if (!dto.email || !dto.currentPassword || !dto.newPassword) {
      throw new BadRequestException('Todos los campos son requeridos.');
    }
    validatePasswordPolicy(dto.newPassword);
    await this.authService.changePasswordFirstLogin(dto.email, dto.currentPassword, dto.newPassword, dto.tenantSlug);
    return { message: 'Contraseña actualizada exitosamente.' };
  }

  // ─── 2FA Endpoints ───────────────────────────────────────────────

  /** Generate 2FA secret and QR URI */
  @Post('2fa/setup')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async setup2FA(@Request() req: any) {
    return this.authService.setup2FA(req.user.userId);
  }

  /** Verify code and enable 2FA */
  @Post('2fa/enable')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async enable2FA(@Request() req: any, @Body() dto: { code: string }) {
    if (!dto.code) throw new BadRequestException('Código requerido');
    return this.authService.enable2FA(req.user.userId, dto.code);
  }

  /** Disable 2FA (requires password) */
  @Post('2fa/disable')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async disable2FA(@Request() req: any, @Body() dto: { password: string }) {
    if (!dto.password) throw new BadRequestException('Contraseña requerida');
    return this.authService.disable2FA(req.user.userId, dto.password);
  }
}
