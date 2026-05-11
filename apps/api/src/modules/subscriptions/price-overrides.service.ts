import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, MoreThan, Or, Repository } from 'typeorm';
import { SubscriptionPriceOverride } from './entities/subscription-price-override.entity';
import { Subscription } from './entities/subscription.entity';
import { AuditService } from '../audit/audit.service';

/**
 * Fase 4 / Tarea 4.3 — Override de pricing por subscription.
 *
 * Reglas de negocio:
 *   - Solo super_admin (endpoint).
 *   - reason obligatorio (>=5 chars).
 *   - Al crear, cierra automaticamente el override activo anterior
 *     (validUntil = now) para que solo haya UNO activo a la vez.
 *   - validFrom >= ahora (no se permite efecto retroactivo en MVP).
 *   - validUntil > validFrom o NULL (indefinido).
 *   - Al menos UN campo de precio definido (sino el override no hace
 *     nada y es pollution de data).
 *   - Audit log con `subscription_price.override_created` (critico).
 */
@Injectable()
export class PriceOverridesService {
  private readonly logger = new Logger(PriceOverridesService.name);

  constructor(
    @InjectRepository(SubscriptionPriceOverride)
    private readonly overrideRepo: Repository<SubscriptionPriceOverride>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Crea un nuevo override. Cierra el anterior activo (si existe) en
   * la misma transaction. Retorna el override creado.
   */
  async create(
    subscriptionId: string,
    dto: {
      monthlyPrice?: number | null;
      quarterlyPrice?: number | null;
      semiannualPrice?: number | null;
      yearlyPrice?: number | null;
      validFrom?: string;
      validUntil?: string | null;
      reason: string;
    },
    userId: string,
  ): Promise<SubscriptionPriceOverride> {
    if (!dto.reason || dto.reason.trim().length < 5) {
      throw new BadRequestException('reason es obligatorio (min 5 caracteres).');
    }

    // Al menos un campo de precio definido.
    const prices = {
      monthlyPrice: this.validatePrice(dto.monthlyPrice, 'monthlyPrice'),
      quarterlyPrice: this.validatePrice(dto.quarterlyPrice, 'quarterlyPrice'),
      semiannualPrice: this.validatePrice(dto.semiannualPrice, 'semiannualPrice'),
      yearlyPrice: this.validatePrice(dto.yearlyPrice, 'yearlyPrice'),
    };
    if (Object.values(prices).every((p) => p === null)) {
      throw new BadRequestException(
        'Debe especificar al menos un precio (monthly/quarterly/semiannual/yearly).',
      );
    }

    const now = new Date();
    const validFrom = dto.validFrom ? new Date(dto.validFrom) : now;
    if (isNaN(validFrom.getTime())) {
      throw new BadRequestException('validFrom no es una fecha valida.');
    }
    // MVP: validFrom no puede ser pasado.
    if (validFrom.getTime() < now.getTime() - 60 * 60 * 1000) {
      throw new BadRequestException(
        'validFrom no puede ser mas de 1 hora en el pasado (sin efecto retroactivo).',
      );
    }
    let validUntil: Date | null = null;
    if (dto.validUntil) {
      validUntil = new Date(dto.validUntil);
      if (isNaN(validUntil.getTime())) {
        throw new BadRequestException('validUntil no es una fecha valida.');
      }
      if (validUntil.getTime() <= validFrom.getTime()) {
        throw new BadRequestException('validUntil debe ser posterior a validFrom.');
      }
    }

    const sub = await this.subRepo.findOne({ where: { id: subscriptionId } });
    if (!sub) throw new NotFoundException('Suscripcion no encontrada.');

    return this.dataSource.transaction(async (tx) => {
      // Cerrar override activo anterior (si existe).
      const active = await tx.findOne(SubscriptionPriceOverride, {
        where: [
          { subscriptionId, validUntil: IsNull() },
          { subscriptionId, validUntil: MoreThan(now) },
        ],
      });
      let closedActiveId: string | null = null;
      if (active) {
        active.validUntil = validFrom; // termina justo cuando empieza el nuevo
        await tx.save(active);
        closedActiveId = active.id;
      }

      const created = tx.create(SubscriptionPriceOverride, {
        subscriptionId: sub.id,
        tenantId: sub.tenantId,
        monthlyPrice: prices.monthlyPrice,
        quarterlyPrice: prices.quarterlyPrice,
        semiannualPrice: prices.semiannualPrice,
        yearlyPrice: prices.yearlyPrice,
        validFrom,
        validUntil,
        reason: dto.reason.trim(),
        approvedBy: userId,
      });
      const saved = await tx.save(created);

      await this.auditService
        .log(
          sub.tenantId,
          userId,
          'subscription_price.override_created',
          'subscription_price_override',
          saved.id,
          {
            subscriptionId: sub.id,
            prices,
            validFrom: validFrom.toISOString(),
            validUntil: validUntil?.toISOString() || null,
            reason: dto.reason,
            closedPreviousOverrideId: closedActiveId,
          },
        )
        .catch(() => undefined);

      return saved;
    });
  }

  /**
   * Lista overrides de una subscription. Incluye activos e historicos
   * para auditoria (super_admin puede ver el historial completo).
   */
  async listForSubscription(subscriptionId: string): Promise<SubscriptionPriceOverride[]> {
    return this.overrideRepo.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Resuelve el override ACTIVO de una sub en un momento dado (default
   * ahora). Llamado por getPlanPriceForPeriod en invoices.service para
   * usar el precio override en vez del plan base.
   */
  async getActiveOverride(
    subscriptionId: string,
    at: Date = new Date(),
  ): Promise<SubscriptionPriceOverride | null> {
    return this.overrideRepo
      .createQueryBuilder('o')
      .where('o.subscription_id = :sid', { sid: subscriptionId })
      .andWhere('o.valid_from <= :at', { at })
      .andWhere('(o.valid_until IS NULL OR o.valid_until > :at)', { at })
      .orderBy('o.valid_from', 'DESC')
      .limit(1)
      .getOne();
  }

  /**
   * Cierra (termina) el override activo. Util para revertir un descuento.
   */
  async closeActive(subscriptionId: string, userId: string): Promise<void> {
    const now = new Date();
    const active = await this.getActiveOverride(subscriptionId, now);
    if (!active) return;
    active.validUntil = now;
    await this.overrideRepo.save(active);
    await this.auditService
      .log(
        active.tenantId,
        userId,
        'subscription_price.override_closed',
        'subscription_price_override',
        active.id,
        { subscriptionId, closedAt: now.toISOString() },
      )
      .catch(() => undefined);
  }

  private validatePrice(value: any, name: string): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new BadRequestException(`${name} debe ser numero.`);
    }
    if (value < 0) {
      throw new BadRequestException(`${name} no puede ser negativo.`);
    }
    if (value > 1_000_000) {
      throw new BadRequestException(`${name} es excesivo (sanity check).`);
    }
    return Math.round(value * 100) / 100;
  }
}
