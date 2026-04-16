import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';
import { UsersModule } from '../users/users.module';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { PasswordHistory } from './entities/password-history.entity';
import { OidcConfiguration } from './entities/oidc-configuration.entity';
import { PasswordPolicyService } from './password-policy.service';
import { SsoService } from './sso/sso.service';
import { SsoController } from './sso/sso.controller';
import { ImpersonationService } from './impersonation/impersonation.service';
import { ImpersonationController } from './impersonation/impersonation.controller';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    UsersModule,
    AuditModule,
    NotificationsModule,
    TypeOrmModule.forFeature([User, Tenant, PasswordHistory, OidcConfiguration]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      // No async – avoids wrapping return in Promise<> which breaks JwtModuleOptions inference
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? '',
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRATION', '30m'),
        },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy, JwtRefreshStrategy, PasswordPolicyService, SsoService, ImpersonationService],
  controllers: [AuthController, SsoController, ImpersonationController],
  exports: [AuthService, PasswordPolicyService, SsoService, ImpersonationService],
})
export class AuthModule {}
