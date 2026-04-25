import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt.strategy';

/**
 * JWT strategy that allows expired tokens — used ONLY for the /auth/refresh endpoint.
 * This lets users refresh their session even if the token just expired (grace period).
 */
@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true, // Allow expired tokens for refresh
      secretOrKey: configService.get<string>('JWT_SECRET') ?? '',
    });
  }

  validate(payload: JwtPayload) {
    if (!payload.sub) {
      throw new UnauthorizedException('Token inválido');
    }
    // Reject tokens older than 15 minutes (F2 Paso 9: bajado de 24h a 15min
    // para acotar la ventana post-robo. UX trade-off: usuarios inactivos
    // >15min necesitan re-loguear, en vez de refresh silencioso. La rotacion
    // real de refresh tokens (con tabla en DB + revocation) queda para un
    // paso futuro — esto solo acota el grace period.).
    const iat = (payload as any).iat;
    if (iat && Date.now() / 1000 - iat > 15 * 60) {
      throw new UnauthorizedException('Token demasiado antiguo para refrescar');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId || null,
      role: payload.role,
    };
  }
}
