import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy, JwtFromRequestFunction } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ACCESS_TOKEN_COOKIE } from './cookie.helper';

/**
 * Extrae el JWT desde la cookie httpOnly `access_token` (F3 — auth basada
 * en cookie). Backward-compat: si la cookie no existe, JwtStrategy hace
 * fallback al header Authorization para que el frontend que aún manda
 * el bearer siga funcionando durante la transición (Fase 2).
 */
const cookieExtractor: JwtFromRequestFunction = (req) => {
  const cookies = (req as { cookies?: Record<string, string> })?.cookies;
  return cookies?.[ACCESS_TOKEN_COOKIE] ?? null;
};

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  /** Versión del token — se compara con User.tokenVersion para invalidar JWTs
   *  emitidos cuando el usuario se desvincula o cambia credenciales. */
  tv?: number;
  /** Optional login method marker. `'sso'` for JIT OIDC sessions — some UI
   *  branches (e.g. "2FA managed by your IdP") read this. */
  authMethod?: 'password' | 'sso';
  // ─── Impersonation claims (C3) ──────────────────────────────────────
  /** super_admin user id that created this impersonation session. */
  impersonatedBy?: string;
  /** Free-text reason recorded at start; echoed in the banner + audit log. */
  impersonationReason?: string;
  /** Issued-at seconds; we enforce a hard 1h cap independent of tenant
   *  session timeout. */
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super({
      // Acepta token desde cookie httpOnly (F3) o Authorization header
      // (backward-compat). Cookie tiene precedencia — si ambos están,
      // se usa la cookie y el header se ignora.
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? '',
    });
  }

  async validate(payload: JwtPayload & { exp?: number }) {
    // Gap 6: super_admin can operate without tenantId (cross-tenant access)
    if (!payload.tenantId && payload.role !== 'super_admin') {
      throw new UnauthorizedException('Tenant ID missing in token');
    }

    // Re-fetch user para validar (a) que sigue activo y (b) que el
    // tokenVersion del JWT coincide con el actual. Si fueron bumped por una
    // desvinculación o logout remoto, el token queda inválido inmediatamente.
    // Costo: +1 query por request autenticado (~3-5ms). Cachear con TTL 30s
    // en el futuro si se vuelve cuello de botella.
    const user = await this.userRepo.findOne({
      where: { id: payload.sub },
      select: ['id', 'isActive', 'tokenVersion', 'tenantId', 'role'],
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Usuario inactivo');
    }
    // Tenant claim tampering check: token's tenantId must match DB
    if ((user.tenantId ?? null) !== (payload.tenantId ?? null)) {
      throw new UnauthorizedException('Token inconsistente con usuario');
    }
    // tokenVersion check — missing tv in legacy tokens is treated as 0
    const tokenTv = payload.tv ?? 0;
    const userTv = user.tokenVersion ?? 0;
    if (tokenTv !== userTv) {
      throw new UnauthorizedException('Sesión expirada — inicie sesión nuevamente');
    }

    // ─── Impersonation enforcement (C3) ─────────────────────────────
    if (payload.impersonatedBy) {
      // Hard cap the TTL at 1h regardless of tenant session timeout —
      // defense-in-depth in case a forged token claims 24h.
      //
      // Legitimate tokens signed by ImpersonationService use `expiresIn: '1h'`
      // which yields `exp - iat === 3600` exactly. We allow a 60-second
      // slack for clock skew and serializer rounding; anything beyond that
      // is rejected as forged.
      if (typeof payload.exp === 'number' && typeof payload.iat === 'number') {
        if (payload.exp - payload.iat > 3600 + 60) {
          throw new UnauthorizedException('Token de impersonación inválido (TTL excedido)');
        }
      }
      // The impersonating super_admin must still exist and be active.
      const impersonator = await this.userRepo.findOne({
        where: { id: payload.impersonatedBy },
        select: ['id', 'isActive', 'role'],
      });
      if (!impersonator || !impersonator.isActive || impersonator.role !== 'super_admin') {
        throw new UnauthorizedException('Impersonador inválido o inactivo');
      }
    }

    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId || null,
      role: payload.role,
      // Forwarded to controllers + guards so they can act accordingly.
      impersonatedBy: payload.impersonatedBy,
      impersonationReason: payload.impersonationReason,
      authMethod: payload.authMethod,
    };
  }
}
