/**
 * auth.service.spec.ts — Tests unitarios del AuthService.
 *
 * Cubre:
 * - validateUser: credenciales validas/invalidas, user inactivo, tenant inactivo
 * - login: genera JWT con payload correcto
 * - resetPassword: codigo expirado, codigo incorrecto, password policy
 *
 * Los tests usan mocks de todos los deps (UserRepo, TenantRepo, JwtService,
 * AuditService, EmailService, UsersService). No tocan la BD real.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import {
  createMockRepository,
  createMockAuditService,
  createMockEmailService,
  createMockUser,
  createMockTenant,
  fakeUuid,
} from '../../../test/test-utils';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: any;
  let jwtService: any;
  let userRepo: any;
  let tenantRepo: any;
  let auditService: any;
  let emailService: any;

  beforeEach(async () => {
    usersService = {
      findByEmail: jest.fn(),
    };
    jwtService = {
      sign: jest.fn().mockReturnValue('mock-jwt-token'),
      verify: jest.fn(),
    };
    userRepo = createMockRepository<User>();
    tenantRepo = createMockRepository<Tenant>();
    auditService = createMockAuditService();
    emailService = createMockEmailService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('30m') } },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(Tenant), useValue: tenantRepo },
        { provide: AuditService, useValue: auditService },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ─── validateUser ──────────────────────────────────────────────────

  describe('validateUser', () => {
    it('should return user without passwordHash on valid credentials', async () => {
      const hash = await bcrypt.hash('Password123', 10);
      const user = createMockUser({ passwordHash: hash });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('test@evapro.demo', 'Password123');

      expect(result).toBeDefined();
      expect(result.email).toBe('test@evapro.demo');
      expect(result.passwordHash).toBeUndefined();
    });

    it('should return null on wrong password', async () => {
      const hash = await bcrypt.hash('Password123', 10);
      const user = createMockUser({ passwordHash: hash });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('test@evapro.demo', 'WrongPassword');

      expect(result).toBeNull();
    });

    it('should return null if user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      const result = await service.validateUser('nonexistent@evapro.demo', 'Password123');

      expect(result).toBeNull();
    });

    it('should return null if user is inactive', async () => {
      const hash = await bcrypt.hash('Password123', 10);
      const user = createMockUser({ passwordHash: hash, isActive: false });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('test@evapro.demo', 'Password123');

      expect(result).toBeNull();
    });

    it('should return null if tenant is inactive', async () => {
      const hash = await bcrypt.hash('Password123', 10);
      const user = createMockUser({
        passwordHash: hash,
        role: 'employee',
        tenant: createMockTenant({ isActive: false }),
      });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('test@evapro.demo', 'Password123');

      expect(result).toBeNull();
    });

    it('should allow super_admin even with inactive tenant', async () => {
      const hash = await bcrypt.hash('Password123', 10);
      const user = createMockUser({
        passwordHash: hash,
        role: 'super_admin',
        tenant: createMockTenant({ isActive: false }),
      });
      usersService.findByEmail.mockResolvedValue(user);

      const result = await service.validateUser('test@evapro.demo', 'Password123');

      expect(result).toBeDefined();
      expect(result.role).toBe('super_admin');
    });
  });

  // ─── login ─────────────────────────────────────────────────────────

  describe('login', () => {
    it('should return access_token on successful login', async () => {
      const user = createMockUser();
      tenantRepo.findOne.mockResolvedValue(createMockTenant());

      const result = await service.login(user);

      expect(result).toBeDefined();
      expect(result.access_token).toBe('mock-jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: user.id,
          email: user.email,
          tenantId: user.tenantId,
          role: user.role,
        }),
        expect.any(Object),
      );
    });

    it('should log the login action to audit', async () => {
      const user = createMockUser();
      tenantRepo.findOne.mockResolvedValue(createMockTenant());

      await service.login(user, '192.168.1.1');

      expect(auditService.log).toHaveBeenCalledWith(
        user.tenantId,
        user.id,
        'login',
        'User',
        user.id,
        expect.objectContaining({ email: user.email }),
        '192.168.1.1',
      );
    });
  });

  // ─── resetPassword ─────────────────────────────────────────────────

  describe('resetPassword', () => {
    it('should throw if user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword('nonexistent@evapro.demo', '123456', 'NewPass123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if reset code is expired', async () => {
      const expiredDate = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const user = createMockUser({
        passwordResetCode: '123456',
        passwordResetExpires: expiredDate,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.resetPassword('test@evapro.demo', '123456', 'NewPass123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if reset code does not match', async () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const user = createMockUser({
        passwordResetCode: '123456',
        passwordResetExpires: futureDate,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(
        service.resetPassword('test@evapro.demo', '999999', 'NewPass123'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
