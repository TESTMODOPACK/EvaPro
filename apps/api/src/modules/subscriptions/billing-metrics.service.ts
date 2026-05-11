import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { Invoice, InvoiceStatus, InvoiceType } from './entities/invoice.entity';
import { BillingPeriod } from './entities/payment-history.entity';

/**
 * Fase 4 / Tarea 4.2 — Metricas SaaS para el dashboard ejecutivo del
 * super_admin.
 *
 * Reglas de negocio:
 *   - MRR: monthly recurring revenue. Sum(price/months_in_period) sobre
 *     subs ACTIVE no-PAUSED. Anual -> yearlyPrice/12, semestral -> /6,
 *     trimestral -> /3, mensual -> sin cambio.
 *   - ARR: MRR * 12 (anualizacion teorica).
 *   - PAUSED subs NO cuentan para MRR/ARR (no facturando hoy). T3.5.
 *   - TRIAL subs NO cuentan para MRR/ARR (no han pagado).
 *   - Churn rate (period): subs cancelled/expired en periodo / subs
 *     activas al inicio del periodo. % >= 0.
 *   - DSO (Days Sales Outstanding): (AR_promedio / revenue_periodo) *
 *     dias_periodo. Mide cuanto demora el cliente promedio en pagar.
 *   - Collection rate: revenue_paid / (revenue_paid + revenue_overdue
 *     + revenue_pending). 100% = todo cobrado, 0% = nada cobrado.
 *   - Cohort retention: por mes de start_date, % de subs aun activas N
 *     meses despues.
 *
 * Performance:
 *   - Estos calculos hacen scans de la BD; cachear si N tenants > 10k.
 *   - Hoy MVP: queries directos sin cache. Aceptable para <1k tenants.
 *   - Defer Fase 5: materializar en tabla agregada con cron diario.
 */
@Injectable()
export class BillingMetricsService {
  private readonly logger = new Logger(BillingMetricsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
  ) {}

  /**
   * MRR (Monthly Recurring Revenue): suma del valor mensualizado de
   * todas las subs activas (no PAUSED, no TRIAL, no SUSPENDED).
   */
  async getMRR(): Promise<{ mrr: number; activeSubs: number; currency: string }> {
    const subs = await this.subRepo.find({
      where: { status: SubscriptionStatus.ACTIVE },
      relations: ['plan'],
    });
    let mrr = 0;
    let currency = 'UF';
    for (const sub of subs) {
      if (!sub.plan) continue;
      const monthly = this.monthlyEquivalent(sub.plan, sub.billingPeriod);
      mrr += monthly;
      // Mostramos currency del primer plan encontrado; mixto = inconsistencia
      // operacional que ya alertamos en audit anterior (T0/T2).
      currency = sub.plan.currency || 'UF';
    }
    return {
      mrr: Math.round(mrr * 100) / 100,
      activeSubs: subs.length,
      currency,
    };
  }

  async getARR(): Promise<{ arr: number; mrr: number; currency: string }> {
    const { mrr, currency } = await this.getMRR();
    return { arr: Math.round(mrr * 12 * 100) / 100, mrr, currency };
  }

  /**
   * Churn rate del periodo. Por convencion mensual.
   * Numerador: subs que fueron cancelled/expired durante el periodo.
   * Denominador: subs activas (ACTIVE o PAUSED) al INICIO del periodo.
   *
   * NOTA: PAUSED se cuentan como denominador porque son clientes
   * vigentes que volveran a facturar. No son churn.
   */
  async getChurnRate(
    daysBack = 30,
  ): Promise<{ rate: number; cancelledInPeriod: number; activeAtStart: number; daysBack: number }> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    // 1. Subs CANCELLED durante el periodo. EXPIRED no se considera
    // churn porque expira por trial-end, no es cancelacion activa.
    const cancelledInPeriod = await this.subRepo.count({
      where: {
        status: SubscriptionStatus.CANCELLED,
        // updatedAt aproxima la fecha de cancelacion. Si el cliente
        // tiene auditoria fina por subscription.cancelled action, usar
        // esa. Hoy MVP.
        updatedAt: Between(periodStart, now) as any,
      },
    });

    // 2. Subs ACTIVE/PAUSED al INICIO. Aproximamos con createdAt
    // <= periodStart Y (status != CANCELLED OR updatedAt > periodStart).
    // Aproximacion suficiente para MVP.
    const activeAtStart = await this.subRepo
      .createQueryBuilder('s')
      .where('s.created_at <= :start', { start: periodStart })
      .andWhere(
        '(s.status IN (:...activeStatuses) OR (s.status = :cancelled AND s.updated_at > :start))',
        {
          activeStatuses: [
            SubscriptionStatus.ACTIVE,
            SubscriptionStatus.PAUSED,
            SubscriptionStatus.TRIAL,
          ],
          cancelled: SubscriptionStatus.CANCELLED,
        },
      )
      .getCount();

    const rate = activeAtStart > 0 ? cancelledInPeriod / activeAtStart : 0;
    return {
      rate: Math.round(rate * 10000) / 100, // % con 2 decimales
      cancelledInPeriod,
      activeAtStart,
      daysBack,
    };
  }

  /**
   * DSO (Days Sales Outstanding): cuanto demora el cliente promedio
   * en pagar. (Accounts Receivable / Revenue) * dias.
   *
   * AR: total no-cobrado de invoices SENT/OVERDUE.
   * Revenue: total cobrado (PAID) en el periodo.
   */
  async getDSO(daysBack = 30): Promise<{
    dso: number;
    accountsReceivable: number;
    revenuePeriod: number;
    daysBack: number;
  }> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const ar = await this.invoiceRepo
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.total), 0)', 'sum')
      .where('i.status IN (:...statuses)', {
        statuses: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE],
      })
      .andWhere('i.type = :t', { t: InvoiceType.INVOICE })
      .getRawOne<{ sum: string }>();

    const revenue = await this.invoiceRepo
      .createQueryBuilder('i')
      .select('COALESCE(SUM(i.total), 0)', 'sum')
      .where('i.status = :status', { status: InvoiceStatus.PAID })
      .andWhere('i.paid_at BETWEEN :start AND :end', {
        start: periodStart,
        end: now,
      })
      .andWhere('i.type = :t', { t: InvoiceType.INVOICE })
      .getRawOne<{ sum: string }>();

    const arAmount = Number(ar?.sum || 0);
    const revenuePeriod = Number(revenue?.sum || 0);
    const dso = revenuePeriod > 0 ? (arAmount / revenuePeriod) * daysBack : 0;
    return {
      dso: Math.round(dso * 10) / 10,
      accountsReceivable: Math.round(arAmount * 100) / 100,
      revenuePeriod: Math.round(revenuePeriod * 100) / 100,
      daysBack,
    };
  }

  /**
   * Collection rate del periodo: paid / (paid + sent + overdue).
   * Mide eficiencia de cobranza.
   */
  async getCollectionRate(daysBack = 30): Promise<{
    rate: number;
    paid: number;
    pending: number;
    overdue: number;
    daysBack: number;
  }> {
    const now = new Date();
    const periodStart = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

    const issued = await this.invoiceRepo.find({
      where: {
        issueDate: Between(periodStart, now) as any,
        type: InvoiceType.INVOICE,
      },
      select: ['total', 'status'],
    });

    let paid = 0;
    let pending = 0;
    let overdue = 0;
    for (const inv of issued) {
      const total = Number(inv.total);
      if (inv.status === InvoiceStatus.PAID) paid += total;
      else if (inv.status === InvoiceStatus.OVERDUE) overdue += total;
      else if (
        inv.status === InvoiceStatus.SENT ||
        inv.status === InvoiceStatus.DRAFT
      )
        pending += total;
    }
    const totalIssued = paid + pending + overdue;
    const rate = totalIssued > 0 ? paid / totalIssued : 0;
    return {
      rate: Math.round(rate * 10000) / 100, // %
      paid: Math.round(paid * 100) / 100,
      pending: Math.round(pending * 100) / 100,
      overdue: Math.round(overdue * 100) / 100,
      daysBack,
    };
  }

  /**
   * Resumen agregado: todas las metricas en una llamada. La UI las
   * pinta en cards. Defer Fase 5: cachear con TTL 1h.
   */
  async getSummary(): Promise<{
    mrr: number;
    arr: number;
    activeSubs: number;
    currency: string;
    churn30d: number;
    dso30d: number;
    collectionRate30d: number;
    breakdown: {
      churn: { cancelledInPeriod: number; activeAtStart: number };
      dso: { accountsReceivable: number; revenuePeriod: number };
      collection: { paid: number; pending: number; overdue: number };
    };
  }> {
    const [mrr, churn, dso, coll] = await Promise.all([
      this.getMRR(),
      this.getChurnRate(30),
      this.getDSO(30),
      this.getCollectionRate(30),
    ]);
    return {
      mrr: mrr.mrr,
      arr: Math.round(mrr.mrr * 12 * 100) / 100,
      activeSubs: mrr.activeSubs,
      currency: mrr.currency,
      churn30d: churn.rate,
      dso30d: dso.dso,
      collectionRate30d: coll.rate,
      breakdown: {
        churn: { cancelledInPeriod: churn.cancelledInPeriod, activeAtStart: churn.activeAtStart },
        dso: { accountsReceivable: dso.accountsReceivable, revenuePeriod: dso.revenuePeriod },
        collection: { paid: coll.paid, pending: coll.pending, overdue: coll.overdue },
      },
    };
  }

  /**
   * Equivalente mensual del precio de un plan segun su billing period.
   * Anual -> yearlyPrice/12; semestral -> /6; trimestral -> /3;
   * mensual -> monthlyPrice. Fallback a monthlyPrice si los otros son null.
   */
  private monthlyEquivalent(plan: any, period: BillingPeriod): number {
    const monthly = Number(plan.monthlyPrice) || 0;
    switch (period) {
      case BillingPeriod.QUARTERLY:
        return plan.quarterlyPrice
          ? Number(plan.quarterlyPrice) / 3
          : monthly;
      case BillingPeriod.SEMIANNUAL:
        return plan.semiannualPrice
          ? Number(plan.semiannualPrice) / 6
          : monthly;
      case BillingPeriod.ANNUAL:
        return plan.yearlyPrice ? Number(plan.yearlyPrice) / 12 : monthly;
      default:
        return monthly;
    }
  }
}
