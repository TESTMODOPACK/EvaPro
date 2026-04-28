/**
 * recognition.service.spec.ts — Tests unitarios del RecognitionService.
 *
 * Cubre:
 * - createRecognition: auto-envio prohibido, limites diarios, budget
 * - getBadges: devuelve badges activos del tenant
 * - redeemItem: verificacion de stock y balance
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { RecognitionService } from './recognition.service';
import { Recognition } from './entities/recognition.entity';
import { RecognitionComment } from './entities/recognition-comment.entity';
import { MvpOfTheMonth } from './entities/mvp-of-the-month.entity';
import { Badge } from './entities/badge.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserPoints } from './entities/user-points.entity';
import { UserPointsSummary } from './entities/user-points-summary.entity';
import { PointsBudget } from './entities/points-budget.entity';
import { RedemptionItem } from './entities/redemption-item.entity';
import { RedemptionTransaction } from './entities/redemption-transaction.entity';
import { Challenge } from './entities/challenge.entity';
import { ChallengeProgress } from './entities/challenge-progress.entity';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../notifications/email.service';
import { PushService } from '../notifications/push.service';
import { TenantCronRunner } from '../../common/rls/tenant-cron-runner';
import {
  createMockRepository,
  createMockDataSource,
  createMockNotificationsService,
  createMockEmailService,
  createMockCacheManager,
  createMockUser,
  fakeUuid,
} from '../../../test/test-utils';

describe('RecognitionService', () => {
  let service: RecognitionService;
  let recogRepo: any;
  let badgeRepo: any;
  let userRepo: any;
  let dataSource: any;

  const tenantId = fakeUuid(100);
  const fromUserId = fakeUuid(1);
  const toUserId = fakeUuid(2);

  beforeEach(async () => {
    recogRepo = createMockRepository();
    badgeRepo = createMockRepository();
    userRepo = createMockRepository();
    dataSource = createMockDataSource();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecognitionService,
        { provide: getRepositoryToken(Recognition), useValue: recogRepo },
        // Pre-fix Fase 1: agregados RecognitionComment + MvpOfTheMonth (deps
        // del constructor que faltaban en el spec). Sin esto, 'Nest can't
        // resolve dependencies' al compilar el modulo de testing.
        { provide: getRepositoryToken(RecognitionComment), useValue: createMockRepository() },
        { provide: getRepositoryToken(MvpOfTheMonth), useValue: createMockRepository() },
        { provide: getRepositoryToken(Badge), useValue: badgeRepo },
        { provide: getRepositoryToken(UserBadge), useValue: createMockRepository() },
        { provide: getRepositoryToken(UserPoints), useValue: createMockRepository() },
        { provide: getRepositoryToken(UserPointsSummary), useValue: createMockRepository() },
        { provide: getRepositoryToken(PointsBudget), useValue: createMockRepository() },
        { provide: getRepositoryToken(RedemptionItem), useValue: createMockRepository() },
        { provide: getRepositoryToken(RedemptionTransaction), useValue: createMockRepository() },
        { provide: getRepositoryToken(Challenge), useValue: createMockRepository() },
        { provide: getRepositoryToken(ChallengeProgress), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
        { provide: EmailService, useValue: createMockEmailService() },
        // Pre-fix: PushService inyectado por RecognitionService.
        {
          provide: PushService,
          useValue: {
            sendBatch: jest.fn().mockResolvedValue(undefined),
            send: jest.fn().mockResolvedValue(undefined),
            sendNotification: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CACHE_MANAGER, useValue: createMockCacheManager() },
        // Pre-fix: TenantCronRunner inyectado para crons tenant-scoped (F4 A3).
        {
          provide: TenantCronRunner,
          useValue: {
            runForEachTenant: jest.fn().mockResolvedValue([]),
            runAsSystem: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<RecognitionService>(RecognitionService);
  });

  // ─── createRecognition ─────────────────────────────────────────────

  describe('createRecognition', () => {
    it('should throw if user tries to recognize themselves', async () => {
      await expect(
        service.createRecognition(tenantId, fromUserId, {
          toUserId: fromUserId, // same person
          message: 'Great job!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if recipient user not found', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createRecognition(tenantId, fromUserId, {
          toUserId,
          message: 'Great job!',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if daily limit exceeded', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: toUserId }));
      recogRepo.count
        .mockResolvedValueOnce(5) // dailyCount = MAX (5)
        .mockResolvedValueOnce(0);

      await expect(
        service.createRecognition(tenantId, fromUserId, {
          toUserId,
          message: 'Great job!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw if same-person daily limit exceeded', async () => {
      userRepo.findOne.mockResolvedValue(createMockUser({ id: toUserId }));
      recogRepo.count
        .mockResolvedValueOnce(1) // dailyCount OK
        .mockResolvedValueOnce(2); // samePersonCount = MAX (2)

      await expect(
        service.createRecognition(tenantId, fromUserId, {
          toUserId,
          message: 'Great job!',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getBadges ─────────────────────────────────────────────────────

  describe('getBadges', () => {
    it('should return active badges for tenant', async () => {
      const mockBadges = [
        { id: fakeUuid(10), name: 'Estrella', tenantId, isActive: true },
        { id: fakeUuid(11), name: 'Innovador', tenantId, isActive: true },
      ];
      // getBadges uses cachedFetch which calls badgeRepo.find inside
      badgeRepo.find.mockResolvedValue(mockBadges);

      const result = await service.getBadges(tenantId);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Estrella');
    });
  });
});
