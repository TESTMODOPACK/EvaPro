import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  /** Versión del token — se compara con User.tokenVersion para invalidar JWTs
   *  emitidos cuando el usuario se desvincula o cambia credenciales. */
  tv?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? '',
    });
  }

  async validate(payload: JwtPayload) {
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

    return {
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId || null,
      role: payload.role,
    };
  }
}
