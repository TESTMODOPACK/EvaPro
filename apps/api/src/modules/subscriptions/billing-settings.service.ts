import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BillingSettings } from './entities/billing-settings.entity';
import { AuditService } from '../audit/audit.service';
import { validateRut, normalizeRut } from '../../common/utils/rut-validator';

/**
 * Fase 4 / Tarea 4.5 — Servicio singleton de configuracion fiscal.
 *
 * Reglas de negocio:
 *   - `get()` retorna el row 'singleton' creandolo en primera invocacion
 *     con defaults Chile (IVA 19, prefijos EVA/EVA-NC, due 15d).
 *   - `update()` solo super_admin (endpoint). Whitelist estricta de
 *     campos editables (defense-in-depth).
 *   - Cambios en `issuerRut` y `taxRate` son SII-criticos -> audit log
 *     en CRITICAL_ACTIONS_FOR_RETENTION (6 anos).
 *   - taxRate clamp [0, 50] (sanity: ningun pais tiene IVA > 50%).
 *   - dueDays clamp [0, 90] (sanity).
 *   - In-memory cache TTL 60s para evitar query en cada invoice
 *     generada (cron de auto-renewal puede generar muchas seguidas).
 */
@Injectable()
export class BillingSettingsService {
  private readonly logger = new Logger(BillingSettingsService.name);
  private cache: { value: BillingSettings; expiresAt: number } | null = null;
  private static readonly CACHE_TTL_MS = 60 * 1000;
  private static readonly SINGLETON_ID = 'singleton';

  constructor(
    @InjectRepository(BillingSettings)
    private readonly repo: Repository<BillingSettings>,
    private readonly auditService: AuditService,
    // Fase 5 fix defer — DataSource para lock pesimista en update.
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Retorna el singleton. Lazy-create en primera invocacion con
   * defaults Chile. Cache TTL 60s (read-heavy, write-rare).
   */
  async get(): Promise<BillingSettings> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }
    let row = await this.repo.findOne({
      where: { id: BillingSettingsService.SINGLETON_ID },
    });
    if (!row) {
      row = this.repo.create({ id: BillingSettingsService.SINGLETON_ID });
      row = await this.repo.save(row);
      this.logger.log('[BillingSettings] singleton creado con defaults Chile.');
    }
    this.cache = {
      value: row,
      expiresAt: now + BillingSettingsService.CACHE_TTL_MS,
    };
    return row;
  }

  /**
   * Update con whitelist. Solo super_admin (endpoint). Audit log con
   * diff before/after.
   */
  async update(
    dto: Partial<{
      issuerName: string;
      issuerRut: string;
      issuerAddress: string;
      issuerCity: string;
      issuerCountry: string;
      issuerEmail: string | null;
      issuerPhone: string | null;
      invoicePrefix: string;
      creditNotePrefix: string;
      taxRate: number;
      dueDays: number;
      invoiceAdvanceDays: number;
      defaultCurrency: string;
      footerNote: string | null;
    }>,
    userId: string,
  ): Promise<BillingSettings> {
    // Fase 5 fix defer — Lock pesimista para serializar dos super_admins
    // editando simultaneamente. Sin esto el "ultimo gana" silenciosamente
    // descarta los cambios del otro. Con lock, el 2do espera y aplica
    // sus cambios sobre el resultado del 1ro (audit log refleja ambos).
    return this.dataSource.transaction(async (tx) => {
      const current = await tx.findOne(BillingSettings, {
        where: { id: BillingSettingsService.SINGLETON_ID },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) {
        // Edge case raro: alguien borro el singleton entre get() y aqui.
        // El servicio normal lo lazy-create, pero en update preferimos
        // fallar explicito.
        throw new BadRequestException('billing_settings singleton no encontrado.');
      }
      return this.applyUpdate(tx, current, dto, userId);
    });
  }

  /**
   * Logica de update extraida para que se ejecute DENTRO del transaction.
   * tx.save garantiza que el commit unico respete el lock.
   */
  private async applyUpdate(
    tx: any,
    current: BillingSettings,
    dto: any,
    userId: string,
  ): Promise<BillingSettings> {
    const before = {
      issuerName: current.issuerName,
      issuerRut: current.issuerRut,
      issuerAddress: current.issuerAddress,
      taxRate: current.taxRate,
      dueDays: current.dueDays,
      invoicePrefix: current.invoicePrefix,
      creditNotePrefix: current.creditNotePrefix,
    };

    if (dto.issuerName !== undefined) {
      const v = String(dto.issuerName).trim();
      if (v.length < 1 || v.length > 200) {
        throw new BadRequestException('issuerName: 1-200 caracteres.');
      }
      current.issuerName = v;
    }
    if (dto.issuerRut !== undefined) {
      const normalized = normalizeRut(dto.issuerRut);
      if (!validateRut(normalized)) {
        throw new BadRequestException('issuerRut invalido.');
      }
      current.issuerRut = normalized;
    }
    if (dto.issuerAddress !== undefined) {
      const v = String(dto.issuerAddress).trim();
      if (v.length > 300) {
        throw new BadRequestException('issuerAddress: max 300 caracteres.');
      }
      current.issuerAddress = v;
    }
    if (dto.issuerCity !== undefined) current.issuerCity = String(dto.issuerCity).trim().slice(0, 100);
    if (dto.issuerCountry !== undefined) current.issuerCountry = String(dto.issuerCountry).trim().slice(0, 100);
    if (dto.issuerEmail !== undefined) {
      if (dto.issuerEmail === null || dto.issuerEmail === '') {
        current.issuerEmail = null;
      } else {
        const v = String(dto.issuerEmail).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
          throw new BadRequestException('issuerEmail invalido.');
        }
        current.issuerEmail = v;
      }
    }
    if (dto.issuerPhone !== undefined) {
      current.issuerPhone = dto.issuerPhone ? String(dto.issuerPhone).trim().slice(0, 50) : null;
    }
    if (dto.invoicePrefix !== undefined) {
      const v = String(dto.invoicePrefix).trim();
      if (!/^[A-Z0-9-]{2,10}$/.test(v)) {
        throw new BadRequestException(
          'invoicePrefix debe ser 2-10 caracteres alfanumericos en mayuscula (regex: ^[A-Z0-9-]{2,10}$).',
        );
      }
      current.invoicePrefix = v;
    }
    if (dto.creditNotePrefix !== undefined) {
      const v = String(dto.creditNotePrefix).trim();
      if (!/^[A-Z0-9-]{2,15}$/.test(v)) {
        throw new BadRequestException(
          'creditNotePrefix debe ser 2-15 caracteres alfanumericos en mayuscula.',
        );
      }
      current.creditNotePrefix = v;
    }
    if (dto.taxRate !== undefined) {
      const n = Number(dto.taxRate);
      if (!isFinite(n) || n < 0 || n > 50) {
        throw new BadRequestException('taxRate debe estar en [0, 50].');
      }
      current.taxRate = Math.round(n * 100) / 100;
    }
    if (dto.dueDays !== undefined) {
      const n = Number(dto.dueDays);
      if (!Number.isInteger(n) || n < 0 || n > 90) {
        throw new BadRequestException('dueDays debe ser entero en [0, 90].');
      }
      current.dueDays = n;
    }
    if (dto.invoiceAdvanceDays !== undefined) {
      const n = Number(dto.invoiceAdvanceDays);
      // Range [0, 31]: 0 = solo emitir dentro del periodo (post-pago
      // estricto). 31 = max 1 mes adelantado (limita facturar el
      // periodo proximo cuando aun estas en el actual).
      if (!Number.isInteger(n) || n < 0 || n > 31) {
        throw new BadRequestException(
          'invoiceAdvanceDays debe ser entero en [0, 31].',
        );
      }
      current.invoiceAdvanceDays = n;
    }
    if (dto.defaultCurrency !== undefined) {
      const v = String(dto.defaultCurrency).trim().toUpperCase();
      if (!['UF', 'CLP', 'USD'].includes(v)) {
        throw new BadRequestException('defaultCurrency: UF | CLP | USD.');
      }
      current.defaultCurrency = v;
    }
    if (dto.footerNote !== undefined) {
      current.footerNote = dto.footerNote ? String(dto.footerNote).slice(0, 1000) : null;
    }

    // Fase 5 fix — `tx.save` para que el lock pesimista lo cubra.
    const saved = await tx.save(current);
    // Invalidar cache.
    this.cache = null;

    await this.auditService
      .log(null, userId, 'billing_settings.updated', 'billing_settings', saved.id, {
        before,
        after: {
          issuerName: saved.issuerName,
          issuerRut: saved.issuerRut,
          issuerAddress: saved.issuerAddress,
          taxRate: saved.taxRate,
          dueDays: saved.dueDays,
          invoicePrefix: saved.invoicePrefix,
          creditNotePrefix: saved.creditNotePrefix,
        },
      })
      .catch(() => undefined);

    return saved;
  }

  /** Invalida cache (util en tests). */
  invalidateCache(): void {
    this.cache = null;
  }
}
