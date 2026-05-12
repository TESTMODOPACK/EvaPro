import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MetricFrequency,
  RecurringMetric,
} from './entities/recurring-metric.entity';
import { MetricMeasurement } from './entities/metric-measurement.entity';
import { AuditService } from '../audit/audit.service';
import { CreateRecurringMetricDto } from './dto/create-recurring-metric.dto';
import { UpdateRecurringMetricDto } from './dto/update-recurring-metric.dto';
import { AddMeasurementDto } from './dto/add-measurement.dto';

export type MetricStatus = 'green' | 'yellow' | 'red' | 'no_data';

export interface MetricCurrentState {
  metric: RecurringMetric;
  lastMeasurement: MetricMeasurement | null;
  status: MetricStatus;
  daysSinceLastMeasurement: number | null;
  isOverdue: boolean;
}

/**
 * RecurringMetricsService — Audit P2, Tarea 10.
 *
 * Servicio de métricas recurrentes (KPI semánticamente correctos). Ver
 * `RecurringMetric` entity para el modelo y por qué se separa de
 * `Objective`.
 */
@Injectable()
export class RecurringMetricsService {
  constructor(
    @InjectRepository(RecurringMetric)
    private readonly metricRepo: Repository<RecurringMetric>,
    @InjectRepository(MetricMeasurement)
    private readonly measurementRepo: Repository<MetricMeasurement>,
    private readonly auditService: AuditService,
  ) {}

  // ─── CRUD de métricas ──────────────────────────────────────────────

  async create(
    tenantId: string,
    actorUserId: string,
    actorRole: string,
    dto: CreateRecurringMetricDto,
  ): Promise<RecurringMetric> {
    // Owner default: actor. Solo admin/manager pueden asignar a otro user.
    let ownerUserId = actorUserId;
    if (dto.ownerUserId && dto.ownerUserId !== actorUserId) {
      if (
        actorRole !== 'super_admin' &&
        actorRole !== 'tenant_admin' &&
        actorRole !== 'manager'
      ) {
        throw new BadRequestException(
          'Solo administradores o managers pueden asignar métricas a otro usuario',
        );
      }
      ownerUserId = dto.ownerUserId;
    }

    this.validateThresholds(
      dto.targetValue,
      dto.thresholdGreen,
      dto.thresholdYellow,
      dto.higherIsBetter ?? true,
    );

    const metric = this.metricRepo.create({
      tenantId,
      ownerUserId,
      name: dto.name,
      description: dto.description ?? null,
      unit: dto.unit,
      targetValue: dto.targetValue,
      higherIsBetter: dto.higherIsBetter ?? true,
      thresholdGreen: dto.thresholdGreen ?? null,
      thresholdYellow: dto.thresholdYellow ?? null,
      frequency: dto.frequency ?? MetricFrequency.MONTHLY,
      isActive: true,
      migratedFromObjectiveId: null,
    });
    const saved = await this.metricRepo.save(metric);

    this.auditService
      .log(
        tenantId,
        actorUserId,
        'recurring_metric.created',
        'recurring_metric',
        saved.id,
        { name: saved.name, ownerUserId },
      )
      .catch(() => {});

    return saved;
  }

  async findAll(
    tenantId: string,
    opts?: { ownerUserId?: string; isActive?: boolean },
  ): Promise<RecurringMetric[]> {
    const where: any = { tenantId };
    if (opts?.ownerUserId) where.ownerUserId = opts.ownerUserId;
    if (opts?.isActive !== undefined) where.isActive = opts.isActive;
    return this.metricRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findById(tenantId: string, id: string): Promise<RecurringMetric> {
    const metric = await this.metricRepo.findOne({
      where: { id, tenantId },
    });
    if (!metric) throw new NotFoundException('Métrica no encontrada');
    return metric;
  }

  async update(
    tenantId: string,
    id: string,
    actorUserId: string,
    dto: UpdateRecurringMetricDto,
  ): Promise<RecurringMetric> {
    const metric = await this.findById(tenantId, id);

    if (dto.name !== undefined) metric.name = dto.name;
    if (dto.description !== undefined)
      metric.description = dto.description ?? null;
    if (dto.unit !== undefined) metric.unit = dto.unit;
    if (dto.targetValue !== undefined) metric.targetValue = dto.targetValue;
    if (dto.higherIsBetter !== undefined)
      metric.higherIsBetter = dto.higherIsBetter;
    if (dto.thresholdGreen !== undefined)
      metric.thresholdGreen = dto.thresholdGreen ?? null;
    if (dto.thresholdYellow !== undefined)
      metric.thresholdYellow = dto.thresholdYellow ?? null;
    if (dto.frequency !== undefined) metric.frequency = dto.frequency;
    if (dto.isActive !== undefined) metric.isActive = dto.isActive;

    this.validateThresholds(
      Number(metric.targetValue),
      metric.thresholdGreen != null ? Number(metric.thresholdGreen) : undefined,
      metric.thresholdYellow != null
        ? Number(metric.thresholdYellow)
        : undefined,
      metric.higherIsBetter,
    );

    const saved = await this.metricRepo.save(metric);
    this.auditService
      .log(
        tenantId,
        actorUserId,
        'recurring_metric.updated',
        'recurring_metric',
        id,
        { changes: dto },
      )
      .catch(() => {});
    return saved;
  }

  async remove(
    tenantId: string,
    id: string,
    actorUserId: string,
  ): Promise<void> {
    const metric = await this.findById(tenantId, id);
    // Soft-delete via isActive=false. Las measurements quedan preservadas.
    metric.isActive = false;
    await this.metricRepo.save(metric);
    this.auditService
      .log(
        tenantId,
        actorUserId,
        'recurring_metric.deactivated',
        'recurring_metric',
        id,
        {
          name: metric.name,
        },
      )
      .catch(() => {});
  }

  // ─── Mediciones ────────────────────────────────────────────────────

  async addMeasurement(
    tenantId: string,
    metricId: string,
    actorUserId: string,
    dto: AddMeasurementDto,
  ): Promise<MetricMeasurement> {
    const metric = await this.findById(tenantId, metricId);
    if (!metric.isActive) {
      throw new BadRequestException(
        'No se pueden agregar mediciones a una métrica desactivada',
      );
    }

    const observedAt = dto.observedAt ? new Date(dto.observedAt) : new Date();
    if (observedAt > new Date()) {
      throw new BadRequestException('observedAt no puede ser una fecha futura');
    }

    const measurement = this.measurementRepo.create({
      tenantId,
      recurringMetricId: metricId,
      value: dto.value,
      observedAt,
      observedBy: actorUserId,
      notes: dto.notes ?? null,
    });
    const saved = await this.measurementRepo.save(measurement);

    this.auditService
      .log(
        tenantId,
        actorUserId,
        'recurring_metric.measurement_added',
        'recurring_metric',
        metricId,
        { value: dto.value, observedAt: observedAt.toISOString() },
      )
      .catch(() => {});

    return saved;
  }

  async listMeasurements(
    tenantId: string,
    metricId: string,
    limit = 50,
  ): Promise<MetricMeasurement[]> {
    await this.findById(tenantId, metricId); // valida tenant scope
    return this.measurementRepo.find({
      where: { tenantId, recurringMetricId: metricId },
      order: { observedAt: 'DESC' },
      take: Math.min(500, Math.max(1, limit)),
      relations: ['observer'],
    });
  }

  // ─── Estado actual de la métrica ──────────────────────────────────

  /**
   * Devuelve el estado actual de la métrica:
   *   - `green`: última medición cumple thresholdGreen
   *   - `yellow`: entre yellow y green
   *   - `red`: peor que yellow
   *   - `no_data`: sin mediciones
   *
   * También computa `isOverdue` según frecuencia: si no hay medición
   * dentro del último período esperado (daily=1d, weekly=7d, etc),
   * marca la métrica como vencida.
   */
  async getCurrentState(
    tenantId: string,
    metricId: string,
  ): Promise<MetricCurrentState> {
    const metric = await this.findById(tenantId, metricId);
    const last = await this.measurementRepo.findOne({
      where: { tenantId, recurringMetricId: metricId },
      order: { observedAt: 'DESC' },
    });

    if (!last) {
      return {
        metric,
        lastMeasurement: null,
        status: 'no_data',
        daysSinceLastMeasurement: null,
        isOverdue: false, // sin data no es "overdue", es "no_data"
      };
    }

    const value = Number(last.value);
    const status = this.computeStatus(metric, value);
    const daysSince = Math.floor(
      (Date.now() - new Date(last.observedAt).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    const expectedFreqDays = this.frequencyToDays(metric.frequency);

    return {
      metric,
      lastMeasurement: last,
      status,
      daysSinceLastMeasurement: daysSince,
      // Marcamos overdue si pasó >1.5x el período esperado (gracia)
      isOverdue: daysSince > expectedFreqDays * 1.5,
    };
  }

  // ─── Helpers privados ──────────────────────────────────────────────

  /** Valida coherencia de los umbrales según higherIsBetter. */
  private validateThresholds(
    targetValue: number,
    thresholdGreen: number | undefined,
    thresholdYellow: number | undefined,
    higherIsBetter: boolean,
  ): void {
    if (thresholdGreen == null && thresholdYellow == null) return;

    if (higherIsBetter) {
      // green ≥ yellow (más alto es mejor)
      if (
        thresholdGreen != null &&
        thresholdYellow != null &&
        thresholdYellow > thresholdGreen
      ) {
        throw new BadRequestException(
          'thresholdYellow debe ser ≤ thresholdGreen cuando higherIsBetter=true',
        );
      }
    } else {
      // green ≤ yellow (más bajo es mejor)
      if (
        thresholdGreen != null &&
        thresholdYellow != null &&
        thresholdYellow < thresholdGreen
      ) {
        throw new BadRequestException(
          'thresholdYellow debe ser ≥ thresholdGreen cuando higherIsBetter=false',
        );
      }
    }
  }

  computeStatus(metric: RecurringMetric, value: number): MetricStatus {
    const green =
      metric.thresholdGreen != null ? Number(metric.thresholdGreen) : null;
    const yellow =
      metric.thresholdYellow != null ? Number(metric.thresholdYellow) : null;

    if (green == null && yellow == null) {
      // Sin umbrales: comparar contra targetValue directo
      const target = Number(metric.targetValue);
      if (metric.higherIsBetter) {
        return value >= target ? 'green' : 'red';
      }
      return value <= target ? 'green' : 'red';
    }

    if (metric.higherIsBetter) {
      if (green != null && value >= green) return 'green';
      if (yellow != null && value >= yellow) return 'yellow';
      return 'red';
    } else {
      // lower is better
      if (green != null && value <= green) return 'green';
      if (yellow != null && value <= yellow) return 'yellow';
      return 'red';
    }
  }

  private frequencyToDays(freq: MetricFrequency): number {
    switch (freq) {
      case MetricFrequency.DAILY:
        return 1;
      case MetricFrequency.WEEKLY:
        return 7;
      case MetricFrequency.MONTHLY:
        return 30;
      case MetricFrequency.QUARTERLY:
        return 90;
      default:
        return 30;
    }
  }
}
