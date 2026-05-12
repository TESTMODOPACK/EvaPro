/**
 * recurring-metrics.service.spec.ts — Audit P2, Tarea 10.
 *
 * Cubre:
 * - CRUD básico
 * - Validación de thresholds (higherIsBetter true/false)
 * - addMeasurement (rejects future, requires active metric)
 * - getCurrentState (status verde/amarillo/rojo/no_data + isOverdue)
 * - computeStatus (todos los caminos: higherIsBetter true/false, sin
 *   thresholds, etc.)
 * - Permission: solo admin/manager pueden asignar a otro user
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RecurringMetricsService } from './recurring-metrics.service';
import {
  MetricFrequency,
  RecurringMetric,
} from './entities/recurring-metric.entity';
import { MetricMeasurement } from './entities/metric-measurement.entity';
import { AuditService } from '../audit/audit.service';
import {
  createMockRepository,
  createMockAuditService,
  fakeUuid,
} from '../../../test/test-utils';

const TID = fakeUuid(100);
const UID = fakeUuid(1);
const OTHER_UID = fakeUuid(2);
const METRIC_ID = fakeUuid(500);

function makeMetric(overrides: Partial<RecurringMetric> = {}): RecurringMetric {
  return {
    id: METRIC_ID,
    tenantId: TID,
    ownerUserId: UID,
    name: 'NPS',
    description: null,
    unit: 'NPS',
    targetValue: 80,
    higherIsBetter: true,
    thresholdGreen: 80,
    thresholdYellow: 60,
    frequency: MetricFrequency.MONTHLY,
    isActive: true,
    migratedFromObjectiveId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    tenant: null as any,
    owner: null,
    ...overrides,
  } as RecurringMetric;
}

describe('RecurringMetricsService', () => {
  let service: RecurringMetricsService;
  let metricRepo: any;
  let measurementRepo: any;

  beforeEach(async () => {
    metricRepo = createMockRepository();
    measurementRepo = createMockRepository();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecurringMetricsService,
        { provide: getRepositoryToken(RecurringMetric), useValue: metricRepo },
        {
          provide: getRepositoryToken(MetricMeasurement),
          useValue: measurementRepo,
        },
        { provide: AuditService, useValue: createMockAuditService() },
      ],
    }).compile();

    service = module.get<RecurringMetricsService>(RecurringMetricsService);
  });

  // ─── create ─────────────────────────────────────────────────────────

  describe('create', () => {
    it('uses actorUserId as owner by default', async () => {
      metricRepo.create.mockImplementation((dto: any) => dto);
      metricRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ ...entity, id: METRIC_ID }),
      );

      await service.create(TID, UID, 'employee', {
        name: 'Ventas mensuales',
        unit: 'CLP',
        targetValue: 5_000_000,
      });

      expect(metricRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: UID, name: 'Ventas mensuales' }),
      );
    });

    it('blocks employee from assigning metric to another user', async () => {
      await expect(
        service.create(TID, UID, 'employee', {
          name: 'X',
          unit: '%',
          targetValue: 100,
          ownerUserId: OTHER_UID,
        }),
      ).rejects.toThrow(/administradores o managers/);
    });

    it('allows admin to assign metric to another user', async () => {
      metricRepo.create.mockImplementation((dto: any) => dto);
      metricRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ ...entity, id: METRIC_ID }),
      );

      await service.create(TID, UID, 'tenant_admin', {
        name: 'X',
        unit: '%',
        targetValue: 100,
        ownerUserId: OTHER_UID,
      });

      expect(metricRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId: OTHER_UID }),
      );
    });

    it('rejects inconsistent thresholds when higherIsBetter=true', async () => {
      // Yellow > Green es inconsistente cuando higherIsBetter=true
      await expect(
        service.create(TID, UID, 'tenant_admin', {
          name: 'X',
          unit: '%',
          targetValue: 100,
          higherIsBetter: true,
          thresholdGreen: 80,
          thresholdYellow: 90,
        }),
      ).rejects.toThrow(/thresholdYellow debe ser ≤ thresholdGreen/);
    });

    it('rejects inconsistent thresholds when higherIsBetter=false', async () => {
      // Yellow < Green es inconsistente cuando higherIsBetter=false
      await expect(
        service.create(TID, UID, 'tenant_admin', {
          name: 'Tiempo de respuesta',
          unit: 'horas',
          targetValue: 4,
          higherIsBetter: false,
          thresholdGreen: 4,
          thresholdYellow: 2,
        }),
      ).rejects.toThrow(/thresholdYellow debe ser ≥ thresholdGreen/);
    });
  });

  // ─── findById ───────────────────────────────────────────────────────

  describe('findById', () => {
    it('throws NotFoundException when not found', async () => {
      metricRepo.findOne.mockResolvedValue(null);
      await expect(service.findById(TID, METRIC_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the metric', async () => {
      const metric = makeMetric();
      metricRepo.findOne.mockResolvedValue(metric);
      const result = await service.findById(TID, METRIC_ID);
      expect(result).toBe(metric);
    });
  });

  // ─── update ─────────────────────────────────────────────────────────

  describe('update', () => {
    it('applies partial updates', async () => {
      const metric = makeMetric({ name: 'Old' });
      metricRepo.findOne.mockResolvedValue(metric);
      metricRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );

      const result = await service.update(TID, METRIC_ID, UID, {
        name: 'New name',
      });

      expect(result.name).toBe('New name');
    });

    it('re-validates thresholds after update', async () => {
      const metric = makeMetric();
      metricRepo.findOne.mockResolvedValue(metric);

      await expect(
        service.update(TID, METRIC_ID, UID, {
          thresholdGreen: 50,
          thresholdYellow: 70, // > green, viola coherencia
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── remove (soft-delete) ────────────────────────────────────────────

  it('remove sets isActive=false (soft-delete)', async () => {
    const metric = makeMetric({ isActive: true });
    metricRepo.findOne.mockResolvedValue(metric);
    metricRepo.save.mockImplementation((entity: any) => Promise.resolve(entity));

    await service.remove(TID, METRIC_ID, UID);

    expect(metricRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
  });

  // ─── addMeasurement ──────────────────────────────────────────────────

  describe('addMeasurement', () => {
    it('persists with observedAt defaulting to now', async () => {
      const metric = makeMetric({ isActive: true });
      metricRepo.findOne.mockResolvedValue(metric);
      measurementRepo.create.mockImplementation((dto: any) => dto);
      measurementRepo.save.mockImplementation((entity: any) =>
        Promise.resolve({ ...entity, id: fakeUuid(600) }),
      );

      const before = Date.now();
      await service.addMeasurement(TID, METRIC_ID, UID, { value: 75 });
      const after = Date.now();

      const saved = measurementRepo.save.mock.calls[0][0];
      expect(saved.value).toBe(75);
      expect(saved.observedBy).toBe(UID);
      const observedAtMs = new Date(saved.observedAt).getTime();
      expect(observedAtMs).toBeGreaterThanOrEqual(before);
      expect(observedAtMs).toBeLessThanOrEqual(after);
    });

    it('respects retroactive observedAt', async () => {
      const metric = makeMetric({ isActive: true });
      metricRepo.findOne.mockResolvedValue(metric);
      measurementRepo.create.mockImplementation((dto: any) => dto);
      measurementRepo.save.mockImplementation((entity: any) =>
        Promise.resolve(entity),
      );

      await service.addMeasurement(TID, METRIC_ID, UID, {
        value: 60,
        observedAt: '2026-04-15T10:00:00Z',
      });

      const saved = measurementRepo.save.mock.calls[0][0];
      expect(saved.observedAt.toISOString()).toBe('2026-04-15T10:00:00.000Z');
    });

    it('rejects observedAt in the future', async () => {
      metricRepo.findOne.mockResolvedValue(makeMetric({ isActive: true }));
      const future = new Date();
      future.setDate(future.getDate() + 1);

      await expect(
        service.addMeasurement(TID, METRIC_ID, UID, {
          value: 50,
          observedAt: future.toISOString(),
        }),
      ).rejects.toThrow(/futura/);
    });

    it('rejects measurement on inactive metric', async () => {
      metricRepo.findOne.mockResolvedValue(makeMetric({ isActive: false }));

      await expect(
        service.addMeasurement(TID, METRIC_ID, UID, { value: 50 }),
      ).rejects.toThrow(/desactivada/);
    });
  });

  // ─── computeStatus + getCurrentState ─────────────────────────────────

  describe('computeStatus', () => {
    it('higherIsBetter=true with thresholds: returns green when value >= green', () => {
      const metric = makeMetric({
        higherIsBetter: true,
        thresholdGreen: 80,
        thresholdYellow: 60,
      });
      expect(service.computeStatus(metric, 90)).toBe('green');
      expect(service.computeStatus(metric, 80)).toBe('green');
      expect(service.computeStatus(metric, 70)).toBe('yellow');
      expect(service.computeStatus(metric, 60)).toBe('yellow');
      expect(service.computeStatus(metric, 50)).toBe('red');
    });

    it('higherIsBetter=false (lower is better) with thresholds', () => {
      const metric = makeMetric({
        higherIsBetter: false,
        thresholdGreen: 4, // ≤4 horas → green
        thresholdYellow: 8, // ≤8 → yellow
      });
      expect(service.computeStatus(metric, 3)).toBe('green');
      expect(service.computeStatus(metric, 4)).toBe('green');
      expect(service.computeStatus(metric, 6)).toBe('yellow');
      expect(service.computeStatus(metric, 10)).toBe('red');
    });

    it('without thresholds: compares against targetValue (higherIsBetter)', () => {
      const metric = makeMetric({
        higherIsBetter: true,
        targetValue: 100,
        thresholdGreen: null,
        thresholdYellow: null,
      });
      expect(service.computeStatus(metric, 100)).toBe('green');
      expect(service.computeStatus(metric, 99)).toBe('red');
    });

    it('without thresholds: compares against targetValue (lowerIsBetter)', () => {
      const metric = makeMetric({
        higherIsBetter: false,
        targetValue: 4,
        thresholdGreen: null,
        thresholdYellow: null,
      });
      expect(service.computeStatus(metric, 4)).toBe('green');
      expect(service.computeStatus(metric, 5)).toBe('red');
    });
  });

  describe('getCurrentState', () => {
    it('returns no_data when no measurements exist', async () => {
      metricRepo.findOne.mockResolvedValue(makeMetric());
      measurementRepo.findOne.mockResolvedValue(null);

      const state = await service.getCurrentState(TID, METRIC_ID);

      expect(state.status).toBe('no_data');
      expect(state.lastMeasurement).toBeNull();
      expect(state.isOverdue).toBe(false);
    });

    it('computes daysSinceLastMeasurement and isOverdue based on frequency', async () => {
      metricRepo.findOne.mockResolvedValue(
        makeMetric({ frequency: MetricFrequency.WEEKLY }),
      );
      const old = new Date();
      old.setDate(old.getDate() - 15); // 15 días, frequency=weekly (7), threshold 1.5x = 10.5
      measurementRepo.findOne.mockResolvedValue({
        id: fakeUuid(700),
        value: 70,
        observedAt: old,
      });

      const state = await service.getCurrentState(TID, METRIC_ID);

      expect(state.daysSinceLastMeasurement).toBe(15);
      expect(state.isOverdue).toBe(true);
    });

    it('does not mark overdue when within frequency tolerance', async () => {
      metricRepo.findOne.mockResolvedValue(
        makeMetric({ frequency: MetricFrequency.MONTHLY }),
      );
      const recent = new Date();
      recent.setDate(recent.getDate() - 20); // 20 días, monthly threshold 1.5x = 45
      measurementRepo.findOne.mockResolvedValue({
        id: fakeUuid(701),
        value: 90,
        observedAt: recent,
      });

      const state = await service.getCurrentState(TID, METRIC_ID);

      expect(state.isOverdue).toBe(false);
    });
  });
});
