import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  Repository,
  In,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  ILike,
} from 'typeorm';
import { Invoice, InvoiceStatus, InvoiceType } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import {
  Subscription,
  SubscriptionStatus,
} from './entities/subscription.entity';
import {
  PaymentHistory,
  PaymentStatus,
  BillingPeriod,
} from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { runWithBlockingAdvisoryLock } from '../../common/utils/cron-lock';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(InvoiceLine)
    private readonly lineRepo: Repository<InvoiceLine>,
    @InjectRepository(Subscription)
    private readonly subRepo: Repository<Subscription>,
    @InjectRepository(PaymentHistory)
    private readonly paymentRepo: Repository<PaymentHistory>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => EmailService))
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
    // Requerido por runWithBlockingAdvisoryLock en generateInvoice — evita
    // que 2 requests paralelos asignen el mismo invoice_number.
    private readonly dataSource: DataSource,
  ) {}

  // ─── Invoice Number Generation ──────────────────────────────────────

  private async getNextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `EVA-${year}-`;
    // queryBuilder to avoid TypeORM eager-relation + partial-select pitfall.
    // Also casts suffix to integer so "EVA-2026-10" > "EVA-2026-9" numerically,
    // not lexicographically (previous bug with non-padded legacy numbers).
    const row = await this.invoiceRepo
      .createQueryBuilder('i')
      .select('i.invoice_number', 'invoiceNumber')
      .where('i.invoice_number LIKE :prefix', { prefix: `${prefix}%` })
      .orderBy(
        `CAST(NULLIF(regexp_replace(i.invoice_number, '^EVA-\\d+-', ''), '') AS INTEGER)`,
        'DESC',
      )
      .limit(1)
      .getRawOne();
    let seq = 1;
    if (row?.invoiceNumber) {
      const parsed = parseInt(
        String(row.invoiceNumber).replace(prefix, ''),
        10,
      );
      if (!isNaN(parsed)) seq = parsed + 1;
    }
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // ─── Generate Invoice ───────────────────────────────────────────────

  async generateInvoice(
    subscriptionId: string,
    userId?: string,
  ): Promise<Invoice> {
    try {
      const sub = await this.subRepo.findOne({
        where: { id: subscriptionId },
        relations: ['plan', 'tenant'],
      });
      if (!sub) throw new NotFoundException('Suscripcion no encontrada');
      if (!sub.plan)
        throw new BadRequestException(
          'La suscripcion no tiene un plan asociado. Asigne un plan antes de facturar.',
        );
      if (!sub.tenant)
        throw new BadRequestException(
          'La suscripcion no tiene un tenant asociado.',
        );

      // Calculate period by HISTORICAL CONTINUITY (Fase 0 / Tarea 0.1.1).
      //
      // Bug previo: usabamos `sub.nextBillingDate` como `periodStart`, lo que
      // facturaba el siguiente periodo en vez del actual (caso real
      // reproducido: tenant con plan anual creado el 2026-05 generaba factura
      // con periodo abr/2027). `nextBillingDate` representa "cuando se debe
      // cobrar la PROXIMA factura" — NO el periodo cubierto por la factura
      // que estoy generando ahora.
      //
      // Regla correcta:
      //   - Primera factura de la suscripcion (sin facturas previas activas)
      //     -> periodStart = sub.startDate (cubre el periodo actual desde
      //     que el cliente firmo).
      //   - Facturas siguientes -> periodStart = periodEnd de la ultima
      //     factura no-cancelada (continuidad sin gaps ni overlaps).
      //
      // Excluimos CANCELLED del lookup porque una factura cancelada
      // representa un periodo que NUNCA se cobro y debe ser refacturado.
      // Si el negocio quiere "anular sin refacturar", debe emitirse como
      // CREDIT_NOTE (Fase 2), no como CANCELLED.
      //
      // Coercion `new Date(...)` defensiva: las columnas postgres `date`
      // se serializan como string `YYYY-MM-DD`.
      const now = new Date();
      const lastInvoice = await this.invoiceRepo.findOne({
        where: {
          subscriptionId: sub.id,
          status: In([
            InvoiceStatus.DRAFT,
            InvoiceStatus.SENT,
            InvoiceStatus.PAID,
            InvoiceStatus.OVERDUE,
          ]),
        },
        order: { periodEnd: 'DESC' },
      });
      const rawStart = lastInvoice?.periodEnd ?? sub.startDate ?? now;
      const periodStart = new Date(rawStart as any);
      if (isNaN(periodStart.getTime())) {
        throw new BadRequestException(
          `Fecha de inicio de periodo invalida para la suscripcion ${sub.id} (valor recibido: ${String(rawStart)})`,
        );
      }
      const billingPeriod = sub.billingPeriod || BillingPeriod.MONTHLY;
      const periodEnd = this.addBillingPeriod(periodStart, billingPeriod);

      // Check for duplicate invoice in same period
      const existing = await this.invoiceRepo.findOne({
        where: {
          subscriptionId: sub.id,
          periodStart: periodStart,
          status: In([
            InvoiceStatus.DRAFT,
            InvoiceStatus.SENT,
            InvoiceStatus.PAID,
          ]),
        },
      });
      if (existing) {
        throw new BadRequestException(
          `Ya existe una factura para este período (${existing.invoiceNumber})`,
        );
      }

      // P0: critical section (get next number + save invoice) envuelta
      // en advisory lock para prevenir race condition. Antes: dos
      // requests paralelos podían leer el mismo MAX, generar el mismo
      // invoice_number, y el UNIQUE constraint rompía al segundo
      // mid-checkout (dejando al cliente con error 409). Ahora serializamos
      // por-`EVA-YYYY` global (compartido entre tenants porque la numeración
      // es única global; si cambia a per-tenant, scopear el lock).
      const savedWithNumber = await runWithBlockingAdvisoryLock(
        `invoice-numbering:${new Date().getFullYear()}`,
        this.dataSource,
        async () => {
          const invoiceNumber = await this.getNextInvoiceNumber();
          // Fase 0 / Tarea 0.1.2: dueDate ancla en fecha de EMISION (now),
          // no en periodStart. Pre-fix: con plan anual creado hoy y bug de
          // periodStart=2027, dueDate quedaba en 2027-05 (~1 ano fuera).
          // Post-fix: la factura siempre vence 15 dias despues de emitirla,
          // independiente del periodo cubierto. Esto coincide con la
          // expectativa de pago del cliente (cobrar al inicio del periodo,
          // pagar dentro de 15 dias) y con plazos comerciales chilenos.
          const dueDate = new Date(now);
          dueDate.setUTCDate(dueDate.getUTCDate() + 15); // 15 days from issuance (UTC-safe, ver Tarea 0.1.6)

          // Build lines
          const lines: Partial<InvoiceLine>[] = [];

          // Line 1: Plan base
          const planPrice = this.getPlanPriceForPeriod(sub);
          if (planPrice > 0) {
            const periodLabel =
              {
                monthly: 'Mensual',
                quarterly: 'Trimestral',
                semiannual: 'Semestral',
                annual: 'Anual',
              }[billingPeriod] || 'Mensual';
            lines.push({
              concept: `Plan ${sub.plan?.name || 'Base'} — ${periodLabel}`,
              quantity: 1,
              unitPrice: planPrice,
              total: planPrice,
            });
          }

          // Line 2: AI Addon (if any)
          if (sub.aiAddonCalls > 0 && Number(sub.aiAddonPrice) > 0) {
            const months = this.getMonthsInPeriod(billingPeriod);
            const addonTotal = Number(sub.aiAddonPrice) * months;
            lines.push({
              concept: `Add-on IA +${sub.aiAddonCalls} análisis/mes`,
              quantity: months,
              unitPrice: Number(sub.aiAddonPrice),
              total: addonTotal,
            });
          }

          if (lines.length === 0) {
            throw new BadRequestException(
              `El plan asignado no tiene precio configurado (monthlyPrice=${sub.plan?.monthlyPrice || 0}). Configure el precio antes de facturar o asigne un plan pagado.`,
            );
          }

          const subtotal = lines.reduce((s, l) => s + (l.total || 0), 0);
          const taxRate = 19; // IVA Chile
          const taxAmount = Math.round(subtotal * (taxRate / 100) * 100) / 100;
          const total = Math.round((subtotal + taxAmount) * 100) / 100;

          const invoice = this.invoiceRepo.create({
            tenantId: sub.tenantId,
            subscriptionId: sub.id,
            invoiceNumber,
            type: InvoiceType.INVOICE,
            status: InvoiceStatus.DRAFT,
            issueDate: now,
            dueDate,
            periodStart: periodStart,
            periodEnd,
            subtotal,
            taxRate,
            taxAmount,
            total,
            currency: sub.plan?.currency || 'UF',
          });

          const saved = await this.invoiceRepo.save(invoice);

          // Save lines (dentro del lock también — consistencia atómica)
          for (const line of lines) {
            await this.lineRepo.save(
              this.lineRepo.create({ ...line, invoiceId: saved.id }),
            );
          }

          if (userId) {
            await this.auditService
              .log(
                sub.tenantId,
                userId,
                'invoice.generated',
                'invoice',
                saved.id,
                { invoiceNumber, total },
              )
              .catch(() => {});
          }

          return saved;
        },
      );

      return this.invoiceRepo.findOne({
        where: { id: savedWithNumber.id },
        relations: ['tenant', 'lines'],
      }) as Promise<Invoice>;
    } catch (err: any) {
      // Rethrow business exceptions as-is so the 400 message reaches the client.
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException
      )
        throw err;
      // Everything else is an unexpected DB/runtime error. Log the full stack
      // server-side AND rethrow a 500 carrying the actual root message so the
      // admin UI can show the real cause instead of a generic "Internal server error".
      this.logger.error(
        `generateInvoice failed for subscription=${subscriptionId}: ${err?.message || err}`,
        err?.stack,
      );
      throw new InternalServerErrorException(
        `Fallo al generar factura: ${err?.message || 'Error desconocido'}${err?.detail ? ` (${err.detail})` : ''}`,
      );
    }
  }

  // ─── Bulk Generate ──────────────────────────────────────────────────

  async generateBulkInvoices(
    userId: string,
  ): Promise<{ generated: number; skipped: number; errors: string[] }> {
    const subs = await this.subRepo.find({
      where: {
        status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]),
      },
      relations: ['plan', 'tenant'],
    });

    let generated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const sub of subs) {
      try {
        await this.generateInvoice(sub.id, userId);
        generated++;
      } catch (err: any) {
        if (err.message?.includes('Ya existe')) {
          skipped++;
        } else {
          errors.push(`${sub.tenant?.name || sub.tenantId}: ${err.message}`);
        }
      }
    }

    return { generated, skipped, errors };
  }

  // ─── List & Filter ──────────────────────────────────────────────────

  async getAllInvoices(filters?: {
    status?: string;
    tenantId?: string;
    periodMonth?: string;
  }): Promise<Invoice[]> {
    const qb = this.invoiceRepo
      .createQueryBuilder('i')
      .leftJoinAndSelect('i.tenant', 't')
      .leftJoinAndSelect('i.lines', 'l')
      .orderBy('i.issueDate', 'DESC');

    if (filters?.status) {
      qb.andWhere('i.status = :status', { status: filters.status });
    }
    if (filters?.tenantId) {
      qb.andWhere('i.tenant_id = :tid', { tid: filters.tenantId });
    }
    if (filters?.periodMonth) {
      // Format: YYYY-MM
      const [y, m] = filters.periodMonth.split('-').map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      qb.andWhere('i.issue_date BETWEEN :start AND :end', { start, end });
    }

    return qb.getMany();
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  async getInvoiceStats(): Promise<any> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const all = await this.invoiceRepo.find({
      select: ['id', 'total', 'status', 'issueDate', 'dueDate', 'currency'],
    });

    const thisMonth = all.filter(
      (i) =>
        new Date(i.issueDate) >= monthStart &&
        new Date(i.issueDate) <= monthEnd,
    );

    const totalInvoiced = thisMonth.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = thisMonth
      .filter((i) => i.status === InvoiceStatus.PAID)
      .reduce((s, i) => s + Number(i.total), 0);
    const totalPending = all
      .filter(
        (i) =>
          i.status === InvoiceStatus.SENT || i.status === InvoiceStatus.DRAFT,
      )
      .reduce((s, i) => s + Number(i.total), 0);
    const totalOverdue = all
      .filter(
        (i) =>
          i.status === InvoiceStatus.OVERDUE ||
          (i.status === InvoiceStatus.SENT && new Date(i.dueDate) < now),
      )
      .reduce((s, i) => s + Number(i.total), 0);

    // Monthly evolution (last 6 months)
    const evolution: { month: string; invoiced: number; paid: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthInvoices = all.filter((inv) => {
        const dt = new Date(inv.issueDate);
        return dt >= d && dt <= mEnd;
      });
      evolution.push({
        month: key,
        invoiced:
          Math.round(
            monthInvoices.reduce((s, inv) => s + Number(inv.total), 0) * 100,
          ) / 100,
        paid:
          Math.round(
            monthInvoices
              .filter((inv) => inv.status === InvoiceStatus.PAID)
              .reduce((s, inv) => s + Number(inv.total), 0) * 100,
          ) / 100,
      });
    }

    // By plan (from lines)
    const invoicesWithLines = await this.invoiceRepo.find({
      where: { issueDate: Between(monthStart, monthEnd) },
      relations: ['lines'],
    });
    let planRevenue = 0;
    let addonRevenue = 0;
    for (const inv of invoicesWithLines) {
      for (const line of inv.lines || []) {
        if (line.concept.includes('Add-on')) addonRevenue += Number(line.total);
        else planRevenue += Number(line.total);
      }
    }

    return {
      totalInvoiced: Math.round(totalInvoiced * 100) / 100,
      totalPaid: Math.round(totalPaid * 100) / 100,
      totalPending: Math.round(totalPending * 100) / 100,
      totalOverdue: Math.round(totalOverdue * 100) / 100,
      invoiceCount: thisMonth.length,
      evolution,
      revenueBreakdown: {
        plan: Math.round(planRevenue * 100) / 100,
        addon: Math.round(addonRevenue * 100) / 100,
      },
      currency: 'UF',
    };
  }

  // ─── Mark as Paid ───────────────────────────────────────────────────

  async markAsPaid(
    invoiceId: string,
    paymentData: {
      paymentMethod?: string;
      transactionRef?: string;
      notes?: string;
    },
    userId: string,
  ): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['tenant', 'lines'],
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException('La factura ya está pagada');
    if (invoice.status === InvoiceStatus.CANCELLED)
      throw new BadRequestException('No se puede pagar una factura cancelada');

    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = new Date();
    await this.invoiceRepo.save(invoice);

    // Create payment history record
    const sub = await this.subRepo.findOne({
      where: { id: invoice.subscriptionId },
    });
    const payment = this.paymentRepo.create({
      tenantId: invoice.tenantId,
      subscriptionId: invoice.subscriptionId,
      amount: Number(invoice.total),
      currency: invoice.currency,
      billingPeriod: sub?.billingPeriod || BillingPeriod.MONTHLY,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      status: PaymentStatus.PAID,
      paymentMethod: paymentData.paymentMethod || null,
      transactionRef: paymentData.transactionRef || null,
      notes: paymentData.notes || null,
      concept: `Factura ${invoice.invoiceNumber}`,
      isAddon: false,
      invoiceId: invoice.id,
      paidAt: new Date(),
    });
    await this.paymentRepo.save(payment);

    // Update subscription billing info
    if (sub) {
      sub.lastPaymentDate = new Date();
      sub.lastPaymentAmount = Number(invoice.total);
      if (
        sub.status === SubscriptionStatus.SUSPENDED ||
        sub.status === SubscriptionStatus.EXPIRED
      ) {
        sub.status = SubscriptionStatus.ACTIVE;
      }
      await this.subRepo.save(sub);
    }

    await this.auditService
      .log(invoice.tenantId, userId, 'invoice.paid', 'invoice', invoiceId, {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.total,
      })
      .catch(() => {});

    return invoice;
  }

  // ─── Send Invoice Email ─────────────────────────────────────────────

  async sendInvoice(invoiceId: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId },
      relations: ['tenant', 'lines'],
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    // Find tenant admins
    const admins = await this.userRepo.find({
      where: {
        tenantId: invoice.tenantId,
        role: 'tenant_admin',
        isActive: true,
      },
      select: ['id', 'email', 'firstName'],
    });

    for (const admin of admins) {
      await this.emailService
        .send(
          admin.email,
          `Factura ${invoice.invoiceNumber} — Eva360`,
          `<p>Hola ${admin.firstName},</p><p>Se ha generado la factura <strong>${invoice.invoiceNumber}</strong> por un total de <strong>${invoice.total} ${invoice.currency}</strong>.</p><p>Período: ${new Date(invoice.periodStart).toLocaleDateString('es-CL')} al ${new Date(invoice.periodEnd).toLocaleDateString('es-CL')}<br>Vencimiento: ${new Date(invoice.dueDate).toLocaleDateString('es-CL')}</p><p>Puede ver el detalle y descargar el PDF desde su panel de suscripción en Eva360.</p><p>Saludos,<br>Equipo Eva360</p>`,
        )
        .catch(() => {});
    }

    invoice.status =
      invoice.status === InvoiceStatus.DRAFT
        ? InvoiceStatus.SENT
        : invoice.status;
    invoice.sentAt = new Date();
    await this.invoiceRepo.save(invoice);

    await this.auditService
      .log(invoice.tenantId, userId, 'invoice.sent', 'invoice', invoiceId, {
        invoiceNumber: invoice.invoiceNumber,
      })
      .catch(() => {});

    return invoice;
  }

  // ─── Send Reminders ─────────────────────────────────────────────────

  async sendReminders(userId: string): Promise<{ sent: number }> {
    const now = new Date();
    const in5Days = new Date(now);
    in5Days.setDate(in5Days.getDate() + 5);

    // Find overdue + due soon invoices
    const invoices = await this.invoiceRepo.find({
      where: [
        { status: InvoiceStatus.SENT, dueDate: LessThanOrEqual(in5Days) },
        { status: InvoiceStatus.OVERDUE },
      ],
      relations: ['tenant'],
    });

    let sent = 0;
    for (const inv of invoices) {
      // Mark overdue if past due date
      if (new Date(inv.dueDate) < now && inv.status === InvoiceStatus.SENT) {
        inv.status = InvoiceStatus.OVERDUE;
        await this.invoiceRepo.save(inv);
      }

      const admins = await this.userRepo.find({
        where: { tenantId: inv.tenantId, role: 'tenant_admin', isActive: true },
        select: ['email', 'firstName'],
      });

      const isOverdue = new Date(inv.dueDate) < now;
      const subject = isOverdue
        ? `VENCIDA: Factura ${inv.invoiceNumber} — Eva360`
        : `Recordatorio: Factura ${inv.invoiceNumber} vence pronto — Eva360`;

      for (const admin of admins) {
        await this.emailService
          .send(
            admin.email,
            subject,
            `<p>Hola ${admin.firstName},</p><p>${isOverdue ? 'La siguiente factura se encuentra <strong style="color:red">VENCIDA</strong>' : 'Le recordamos que la siguiente factura vence pronto'}:</p><p>Factura: <strong>${inv.invoiceNumber}</strong><br>Total: <strong>${inv.total} ${inv.currency}</strong><br>Vencimiento: ${new Date(inv.dueDate).toLocaleDateString('es-CL')}</p><p>Por favor realice el pago a la brevedad.</p><p>Saludos,<br>Equipo Eva360</p>`,
          )
          .catch(() => {});
      }
      sent++;
    }

    if (userId) {
      await this.auditService
        .log('system', userId, 'invoice.reminders_sent', 'invoice', undefined, {
          count: sent,
        })
        .catch(() => {});
    }

    return { sent };
  }

  // ─── Cancel Invoice ─────────────────────────────────────────────────

  async cancelInvoice(invoiceId: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === InvoiceStatus.PAID)
      throw new BadRequestException(
        'No se puede cancelar una factura ya pagada',
      );

    invoice.status = InvoiceStatus.CANCELLED;
    await this.invoiceRepo.save(invoice);

    await this.auditService
      .log(
        invoice.tenantId,
        userId,
        'invoice.cancelled',
        'invoice',
        invoiceId,
        { invoiceNumber: invoice.invoiceNumber },
      )
      .catch(() => {});

    return invoice;
  }

  // ─── PDF Generation ─────────────────────────────────────────────────

  async generatePdf(
    invoiceId: string,
    tenantId: string | null,
  ): Promise<Buffer> {
    const where: any = { id: invoiceId };
    if (tenantId !== null) where.tenantId = tenantId;
    const invoice = await this.invoiceRepo.findOne({
      where,
      relations: ['tenant', 'lines', 'subscription'],
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 16;

    // Header
    doc.setFillColor(26, 18, 6);
    doc.rect(0, 0, pageW, 38, 'F');
    doc.setTextColor(245, 228, 168);
    doc.setFontSize(18);
    doc.text('FACTURA', margin, 18);
    doc.setFontSize(11);
    doc.text(invoice.invoiceNumber, margin, 28);
    doc.setFontSize(9);
    doc.setTextColor(201, 147, 58);
    doc.text('Eva360 — Evaluación de Desempeño 360°', pageW - margin, 14, {
      align: 'right',
    });
    doc.text('RUT: 77.XXX.XXX-X', pageW - margin, 22, { align: 'right' });
    doc.text('Santiago, Chile', pageW - margin, 30, { align: 'right' });

    let y = 48;

    // Client info
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('CLIENTE', margin, y);
    y += 5;
    doc.setTextColor(26, 18, 6);
    doc.setFontSize(10);
    doc.text(invoice.tenant?.name || 'Organización', margin, y);
    y += 5;
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    if (invoice.tenant?.rut) {
      doc.text(`RUT: ${invoice.tenant.rut}`, margin, y);
      y += 4;
    }
    if (invoice.tenant?.commercialAddress) {
      doc.text(invoice.tenant.commercialAddress, margin, y);
      y += 4;
    }

    // Invoice details (right side)
    const rx = pageW - margin - 60;
    let ry = 48;
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const details = [
      [
        'Fecha emisión:',
        new Date(invoice.issueDate).toLocaleDateString('es-CL'),
      ],
      [
        'Fecha vencimiento:',
        new Date(invoice.dueDate).toLocaleDateString('es-CL'),
      ],
      [
        'Período:',
        `${new Date(invoice.periodStart).toLocaleDateString('es-CL')} - ${new Date(invoice.periodEnd).toLocaleDateString('es-CL')}`,
      ],
      [
        'Estado:',
        invoice.status === 'paid'
          ? 'PAGADA'
          : invoice.status === 'overdue'
            ? 'VENCIDA'
            : invoice.status === 'sent'
              ? 'ENVIADA'
              : 'BORRADOR',
      ],
    ];
    for (const [label, value] of details) {
      doc.text(label, rx, ry);
      doc.setTextColor(26, 18, 6);
      doc.text(value, rx + 32, ry);
      doc.setTextColor(100, 116, 139);
      ry += 5;
    }

    y = Math.max(y, ry) + 8;

    // Lines table
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Concepto', 'Cant.', 'Precio Unit.', 'Total']],
      body: (invoice.lines || []).map((l) => [
        l.concept,
        String(l.quantity),
        `${Number(l.unitPrice).toFixed(2)} ${invoice.currency}`,
        `${Number(l.total).toFixed(2)} ${invoice.currency}`,
      ]),
      headStyles: {
        fillColor: [201, 147, 58],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        1: { halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
    });

    // Totals
    const finalY = (doc as any).lastAutoTable?.finalY || y + 30;
    const totX = pageW - margin - 55;
    let totY = finalY + 8;
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Subtotal:', totX, totY);
    doc.setTextColor(26, 18, 6);
    doc.text(
      `${Number(invoice.subtotal).toFixed(2)} ${invoice.currency}`,
      pageW - margin,
      totY,
      { align: 'right' },
    );
    totY += 6;
    doc.setTextColor(100, 116, 139);
    doc.text(`IVA ${invoice.taxRate}%:`, totX, totY);
    doc.setTextColor(26, 18, 6);
    doc.text(
      `${Number(invoice.taxAmount).toFixed(2)} ${invoice.currency}`,
      pageW - margin,
      totY,
      { align: 'right' },
    );
    totY += 8;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(
      totX - 4,
      totY - 5,
      pageW - margin - totX + 8,
      12,
      2,
      2,
      'F',
    );
    doc.setFontSize(11);
    doc.setTextColor(201, 147, 58);
    doc.text('TOTAL:', totX, totY + 2);
    doc.setTextColor(26, 18, 6);
    doc.text(
      `${Number(invoice.total).toFixed(2)} ${invoice.currency}`,
      pageW - margin,
      totY + 2,
      { align: 'right' },
    );

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    const footY = doc.internal.pageSize.getHeight() - 12;
    doc.text(
      'Eva360 — Plataforma de Evaluación de Desempeño | www.eva360.ascenda.cl',
      margin,
      footY,
    );
    doc.text(
      `Factura ${invoice.invoiceNumber} — Generada el ${new Date().toLocaleDateString('es-CL')}`,
      pageW - margin,
      footY,
      { align: 'right' },
    );

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private getPlanPriceForPeriod(sub: Subscription): number {
    const plan = sub.plan;
    if (!plan) return 0;
    switch (sub.billingPeriod) {
      case BillingPeriod.QUARTERLY:
        return (
          Number(plan.quarterlyPrice) || Number(plan.monthlyPrice) * 3 * 0.9
        );
      case BillingPeriod.SEMIANNUAL:
        return (
          Number(plan.semiannualPrice) || Number(plan.monthlyPrice) * 6 * 0.85
        );
      case BillingPeriod.ANNUAL:
        return Number(plan.yearlyPrice) || Number(plan.monthlyPrice) * 12 * 0.8;
      default:
        return Number(plan.monthlyPrice) || 0;
    }
  }

  private getMonthsInPeriod(period: string): number {
    switch (period) {
      case BillingPeriod.QUARTERLY:
        return 3;
      case BillingPeriod.SEMIANNUAL:
        return 6;
      case BillingPeriod.ANNUAL:
        return 12;
      default:
        return 1;
    }
  }

  private addBillingPeriod(date: Date, period: string): Date {
    // Fase 0 / Tarea 0.1.6 — Bug encontrado en revision exhaustiva:
    // las versiones previas usaban `getMonth()`/`setMonth()` (local time),
    // lo que provoca drift en cualquier maquina que NO este en UTC. En
    // produccion (TZ Chile, UTC-3/-4) un input UTC midnight como
    // `new Date('2026-05-01')` es leido como 2026-04-30T20:00 local —
    // entonces `setMonth(getMonth()+1)` calculaba mayo->junio en local
    // pero el resultado convertido a UTC quedaba 2026-05-31T20:00, lo
    // que serializado a `date` PostgreSQL daba `'2026-05-31'` en vez
    // de `'2026-06-01'`. Mismo problema cerca de DST (cambio de horario
    // chileno mueve hasta 2 dias).
    //
    // Fix: operar siempre en UTC para que la columna `date` PG (sin tz)
    // refleje exactamente el dia esperado.
    const d = new Date(date);
    switch (period) {
      case BillingPeriod.QUARTERLY:
        d.setUTCMonth(d.getUTCMonth() + 3);
        break;
      case BillingPeriod.SEMIANNUAL:
        d.setUTCMonth(d.getUTCMonth() + 6);
        break;
      case BillingPeriod.ANNUAL:
        d.setUTCFullYear(d.getUTCFullYear() + 1);
        break;
      default:
        d.setUTCMonth(d.getUTCMonth() + 1);
    }
    return d;
  }

  // ─── Dunning (B2) ─────────────────────────────────────────────────────
  //
  // Scans all invoices past their due date and escalates them through the
  // stages below. Invoked by a dedicated daily cron in reminders.service;
  // idempotent — each invoice stores its current `dunning.stage` and only
  // advances when `daysOverdue` crosses the next threshold.
  //
  //   stage 3  → friendly reminder
  //   stage 7  → urgent warning (mentions suspension)
  //   stage 14 → suspend subscription + email "cuenta suspendida"
  //   stage 30 → final warning before cancellation
  //   stage 37 → cancel subscription + email "cuenta cancelada"

  private readonly appUrl =
    process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';

  private dunningTargetStage(daysOverdue: number): 0 | 3 | 7 | 14 | 30 | 37 {
    if (daysOverdue >= 37) return 37;
    if (daysOverdue >= 30) return 30;
    if (daysOverdue >= 14) return 14;
    if (daysOverdue >= 7) return 7;
    if (daysOverdue >= 3) return 3;
    return 0;
  }

  async processDunning(): Promise<{ processed: number; advanced: number }> {
    const now = new Date();
    // Fase 1 / Tarea 1.1.2 — Comparacion UTC-safe de daysOverdue.
    // Pre-fix: usabamos `(now.getTime() - dueDate.getTime()) / 86400000`
    // con `now=new Date()` y `dueDate=new Date(invoice.dueDate)`. La
    // columna PG es `type: 'date'` (sin tz) y se serializa como string
    // 'YYYY-MM-DD'; al parsear con `new Date()` cuenta como UTC midnight.
    // Pero `now` esta en hora actual local, lo que causaba drift de
    // hasta ~1 dia segun la hora del cron y la TZ del servidor. Bajo
    // TZ Chile (UTC-4) un cron a las 9am local = 13:00 UTC -> el calculo
    // sumaba 13h al diff y a veces redondeaba al dia siguiente.
    // Post-fix: comparar dia UTC vs dia UTC ignorando horas.
    const nowUtcDay = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    // Only invoices still owed. `dueDate < now` catches both SENT-but-overdue
    // rows that haven't been flipped yet and explicit OVERDUE rows.
    //
    // Fase 1 / Tarea 1.1.4 — ORDER BY dueDate ASC: las invoices mas
    // antiguas (mayor daysOverdue) se procesan PRIMERO. Asi cuando un
    // tenant tiene varias invoices vencidas, la transicion de la sub a
    // SUSPENDED/CANCELLED ocurre con la invoice mas grave; las menos
    // graves del mismo tenant ven la sub ya en estado terminal y
    // skipean correctamente sus emails (ver guard mas abajo).
    const candidates = await this.invoiceRepo
      .createQueryBuilder('i')
      .where('i.status IN (:...statuses)', {
        statuses: [InvoiceStatus.SENT, InvoiceStatus.OVERDUE],
      })
      .andWhere('i.dueDate < :now', { now })
      .leftJoinAndSelect('i.tenant', 'tenant')
      .leftJoinAndSelect('i.subscription', 'subscription')
      .orderBy('i.dueDate', 'ASC')
      .getMany();

    let advanced = 0;

    for (const invoice of candidates) {
      const dueDateRaw = invoice.dueDate as any;
      const dueDate = new Date(dueDateRaw);
      if (isNaN(dueDate.getTime())) {
        this.logger.warn(
          `Dunning skip: invalid dueDate for invoice ${invoice.id}: ${String(dueDateRaw)}`,
        );
        continue;
      }
      const dueUtcDay = Date.UTC(
        dueDate.getUTCFullYear(),
        dueDate.getUTCMonth(),
        dueDate.getUTCDate(),
      );
      const daysOverdue = Math.floor((nowUtcDay - dueUtcDay) / 86_400_000);
      const target = this.dunningTargetStage(daysOverdue);
      if (target === 0) continue;
      const currentStage = invoice.dunning?.stage ?? 0;
      if (currentStage >= target) continue;

      // Flip SENT → OVERDUE status once we cross any threshold.
      if (invoice.status === InvoiceStatus.SENT) {
        invoice.status = InvoiceStatus.OVERDUE;
      }

      // Fase 1 / Tarea 1.1.4 — Skip stages REMINDER (3, 7) si la sub ya
      // esta SUSPENDED o CANCELLED por dunning previo. Razon: si una
      // invoice vencida 14d ya causo SUSPENDED de la sub, otra invoice
      // vencida 5d del mismo tenant NO debe mandarle un email
      // "tu factura esta vencida en 5 dias" — el cliente ya sabe que
      // esta suspendido y suena disonante. Persistimos el avance del
      // stage para no reintentar mas, pero skipeamos el email.
      const subStatus = invoice.subscription?.status;
      const subAlreadyTerminal =
        subStatus === SubscriptionStatus.SUSPENDED ||
        subStatus === SubscriptionStatus.CANCELLED;
      const isReminderStage = target === 3 || target === 7;

      // Find a contact for the tenant. Prefer tenant_admin; fall back to any
      // active user of the tenant.
      const recipient = await this.userRepo.findOne({
        where: {
          tenantId: invoice.tenantId,
          role: 'tenant_admin',
          isActive: true,
        },
      });
      const recipientEmail = recipient?.email || null;
      const payUrl = `${this.appUrl}/dashboard/mi-suscripcion`;
      const amount = Number(invoice.total);
      const orgName = invoice.tenant?.name || '';

      try {
        if (isReminderStage && subAlreadyTerminal) {
          // Skip email pero avanzar el stage (idempotencia + no spam).
          this.logger.log(
            `Dunning skip-email stage=${target} invoice=${invoice.id} — sub already ${subStatus}`,
          );
        } else if (target === 3 && recipientEmail) {
          await this.emailService.sendInvoiceOverdueFriendly(recipientEmail, {
            firstName: recipient!.firstName,
            orgName,
            invoiceNumber: invoice.invoiceNumber,
            amount,
            currency: invoice.currency,
            daysOverdue,
            payUrl,
            tenantId: invoice.tenantId,
          });
        } else if (target === 7 && recipientEmail) {
          await this.emailService.sendInvoiceOverdueUrgent(recipientEmail, {
            firstName: recipient!.firstName,
            orgName,
            invoiceNumber: invoice.invoiceNumber,
            amount,
            currency: invoice.currency,
            daysOverdue,
            suspendsInDays: 14 - daysOverdue < 0 ? 0 : 14 - daysOverdue,
            payUrl,
            tenantId: invoice.tenantId,
          });
        } else if (target === 14) {
          // ORDER MATTERS: flip the subscription state FIRST, email SECOND.
          // If the email send fails mid-batch, at least the auth state is
          // consistent for the user on their next dashboard load. If the
          // DB update fails, no email is sent and the stage does not
          // advance — the cron will retry tomorrow.
          //
          // Fase 1 / Tarea 1.1.3 — DEDUP de email "cuenta suspendida":
          // si el tenant tiene N invoices todas en stage 14 (caso real:
          // se acumularon 2-3 facturas vencidas), pre-fix enviabamos N
          // emails identicos al cliente. Post-fix: el email solo se manda
          // cuando se REALIZA la transicion ACTIVE/TRIAL -> SUSPENDED;
          // las siguientes invoices del mismo tenant ven sub ya
          // SUSPENDED y skipean el email (pero avanzan stage).
          let didTransition = false;
          if (!subAlreadyTerminal) {
            await this.subRepo.update(invoice.subscriptionId, {
              status: SubscriptionStatus.SUSPENDED,
            });
            // Refrescar in-memory para que las siguientes invoices del
            // mismo batch vean el nuevo status.
            if (invoice.subscription) {
              invoice.subscription.status = SubscriptionStatus.SUSPENDED;
            }
            didTransition = true;
            await this.auditService
              .log(
                invoice.tenantId,
                null,
                'subscription.suspended_by_dunning',
                'Subscription',
                invoice.subscriptionId,
                { invoiceId: invoice.id, daysOverdue },
              )
              .catch(() => undefined);
          }
          if (didTransition && recipientEmail) {
            await this.emailService.sendAccountSuspended(recipientEmail, {
              firstName: recipient!.firstName,
              orgName,
              invoiceNumber: invoice.invoiceNumber,
              payUrl,
              cancelsInDays: 37 - daysOverdue < 0 ? 0 : 37 - daysOverdue,
              tenantId: invoice.tenantId,
            });
          } else if (didTransition && !recipientEmail) {
            // No recipient — the tenant will be suspended silently. Flag
            // for ops review so they can chase a contact out-of-band.
            await this.auditService
              .log(
                invoice.tenantId,
                null,
                'subscription.suspended_no_contact',
                'Subscription',
                invoice.subscriptionId,
                { invoiceId: invoice.id, daysOverdue },
              )
              .catch(() => undefined);
          }
        } else if (target === 30 && recipientEmail && !subAlreadyTerminal) {
          // El email "tu cuenta sera cancelada en 7 dias" pierde sentido
          // si la sub ya esta CANCELLED. SUSPENDED si tiene sentido (es
          // el flujo natural). Solo skipeamos si CANCELLED.
          await this.emailService.sendAccountCancellationWarning(
            recipientEmail,
            {
              firstName: recipient!.firstName,
              orgName,
              payUrl,
              tenantId: invoice.tenantId,
            },
          );
        } else if (target === 30 && subStatus === SubscriptionStatus.SUSPENDED && recipientEmail) {
          // Sub suspended (camino feliz) — enviar warning de cancelacion.
          await this.emailService.sendAccountCancellationWarning(
            recipientEmail,
            {
              firstName: recipient!.firstName,
              orgName,
              payUrl,
              tenantId: invoice.tenantId,
            },
          );
        } else if (target === 37) {
          // Cancellation is the most destructive step — flip state first
          // so no further billing side-effects happen on the cancelled sub,
          // then notify. If the email fails, the user still finds out from
          // their dashboard / login attempt.
          //
          // Mismo patron de DEDUP que stage 14: solo enviar email si esta
          // invoice fue la que disparo la transicion.
          let didCancel = false;
          if (subStatus !== SubscriptionStatus.CANCELLED) {
            await this.subRepo.update(invoice.subscriptionId, {
              status: SubscriptionStatus.CANCELLED,
            });
            if (invoice.subscription) {
              invoice.subscription.status = SubscriptionStatus.CANCELLED;
            }
            didCancel = true;
            await this.auditService
              .log(
                invoice.tenantId,
                null,
                'subscription.cancelled_by_dunning',
                'Subscription',
                invoice.subscriptionId,
                { invoiceId: invoice.id, daysOverdue },
              )
              .catch(() => undefined);
          }
          if (didCancel && recipientEmail) {
            await this.emailService.sendAccountCancelled(recipientEmail, {
              firstName: recipient!.firstName,
              orgName,
              tenantId: invoice.tenantId,
            });
          }
        }
      } catch (err: any) {
        // Email/DB failure on one invoice must not abort the rest of the batch.
        this.logger.error(
          `Dunning stage=${target} failed for invoice ${invoice.id}: ${err?.message || err}`,
        );
        continue;
      }

      invoice.dunning = { stage: target, lastEmailAt: now.toISOString() };
      await this.invoiceRepo.save(invoice);
      advanced++;
    }

    return { processed: candidates.length, advanced };
  }
}
