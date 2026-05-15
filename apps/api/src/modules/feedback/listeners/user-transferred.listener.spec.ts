/**
 * user-transferred.listener.spec.ts — Auditoría feedback PR1 (Fix B / Bug 3).
 *
 * Antes, el listener hacía `.set({ ..., cancelledAt, cancelReason } as any)`
 * sobre columnas inexistentes: el UPDATE fallaba en runtime y el catch lo
 * silenciaba → la cascada de traslado NO cancelaba check-ins. Ahora las
 * columnas existen en la entidad. Este spec verifica que, ante un cambio
 * de manager, el listener arma el UPDATE de cancelación correctamente.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FeedbackUserTransferredListener } from './user-transferred.listener';
import { CheckIn, CheckInStatus } from '../entities/checkin.entity';
import { UserTransferredEvent } from '../../users/events/user-transferred.event';
import { NotificationsService } from '../../notifications/notifications.service';
import { AuditService } from '../../audit/audit.service';
import {
  createMockRepository,
  createMockDataSource,
  createMockAuditService,
  createMockNotificationsService,
  createMockQueryBuilder,
  fakeUuid,
} from '../../../../test/test-utils';

const TID = fakeUuid(100);
const USER_ID = fakeUuid(2);
const OLD_MANAGER = fakeUuid(1);
const NEW_MANAGER = fakeUuid(9);
const TRIGGERED_BY = fakeUuid(50);

function makeEvent(): UserTransferredEvent {
  return new UserTransferredEvent(
    TID,
    USER_ID,
    '2026-05-15',
    {
      department: 'Ventas',
      departmentId: fakeUuid(300),
      position: null,
      positionId: null,
      managerId: OLD_MANAGER,
      hierarchyLevel: 3,
    },
    {
      department: 'Marketing',
      departmentId: fakeUuid(301),
      position: null,
      positionId: null,
      managerId: NEW_MANAGER,
      hierarchyLevel: 3,
    },
    'manual',
    TRIGGERED_BY,
  );
}

describe('FeedbackUserTransferredListener — Bug 3', () => {
  let listener: FeedbackUserTransferredListener;
  let checkinRepo: any;
  let qb: any;
  let notifications: any;

  beforeEach(async () => {
    checkinRepo = createMockRepository();
    qb = createMockQueryBuilder();
    checkinRepo.createQueryBuilder.mockReturnValue(qb);
    notifications = createMockNotificationsService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackUserTransferredListener,
        { provide: getRepositoryToken(CheckIn), useValue: checkinRepo },
        { provide: NotificationsService, useValue: notifications },
        { provide: AuditService, useValue: createMockAuditService() },
        { provide: DataSource, useValue: createMockDataSource() },
      ],
    }).compile();

    listener = module.get(FeedbackUserTransferredListener);
  });

  it('no hace nada si el manager no cambió', async () => {
    const ev = makeEvent();
    (ev.current as any).managerId = OLD_MANAGER;
    await listener.handleUserTransferred(ev);
    expect(checkinRepo.find).not.toHaveBeenCalled();
  });

  it('cancela los check-ins futuros del manager anterior con metadata real', async () => {
    checkinRepo.find.mockResolvedValue([
      { id: fakeUuid(501), topic: 'A', scheduledDate: new Date(), status: CheckInStatus.SCHEDULED },
      { id: fakeUuid(502), topic: 'B', scheduledDate: new Date(), status: CheckInStatus.REQUESTED },
    ]);

    await listener.handleUserTransferred(makeEvent());

    // Se construyó un UPDATE con status CANCELLED + metadata de cancelación.
    expect(qb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CheckInStatus.CANCELLED,
        cancelledAt: expect.any(Date),
        cancelReason: expect.stringContaining('traslado'),
      }),
    );
    expect(qb.execute).toHaveBeenCalled();
    // Notifica al manager anterior y al nuevo.
    const notified = notifications.create.mock.calls.map((c: any[]) => c[0].userId);
    expect(notified).toEqual(expect.arrayContaining([OLD_MANAGER, NEW_MANAGER]));
  });

  it('no cancela si no hay check-ins objetivo', async () => {
    checkinRepo.find.mockResolvedValue([]);
    await listener.handleUserTransferred(makeEvent());
    expect(qb.execute).not.toHaveBeenCalled();
  });
});
