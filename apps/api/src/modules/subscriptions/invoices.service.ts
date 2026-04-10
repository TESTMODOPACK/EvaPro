import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Between, LessThanOrEqual, MoreThanOrEqual, ILike } from 'typeorm';
import { Invoice, InvoiceStatus, InvoiceType } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { Subscription, SubscriptionStatus } from './entities/subscription.entity';
import { PaymentHistory, PaymentStatus, BillingPeriod } from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

@Injectable()
export class InvoicesService {
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
  ) {}

  // ─── Invoice Number Generation ──────────────────────────────────────

  private async getNextInvoiceNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `EVA-${year}-`;
    const last = await this.invoiceRepo.findOne({
      where: { invoiceNumber: ILike(`${prefix}%`) },
      order: { invoiceNumber: 'DESC' },
      select: ['invoiceNumber'],
    });
    const seq = last ? parseInt(last.invoiceNumber.replace(prefix, ''), 10) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, '0')}`;
  }

  // ─── Generate Invoice ───────────────────────────────────────────────

  async generateInvoice(subscriptionId: string, userId?: string): Promise<Invoice> {
    const sub = await this.subRepo.findOne({
      where: { id: subscriptionId },
      relations: ['plan', 'tenant'],
    });
    if (!sub) throw new NotFoundException('Suscripcion no encontrada');
    if (!sub.plan) throw new BadRequestException('La suscripcion no tiene un plan asociado. Asigne un plan antes de facturar.');
    if (!sub.tenant) throw new BadRequestException('La suscripcion no tiene un tenant asociado.');

    // Calculate period
    const now = new Date();
    const periodStart = sub.nextBillingDate || sub.startDate || now;
    const periodEnd = this.addBillingPeriod(new Date(periodStart), sub.billingPeriod || BillingPeriod.MONTHLY);

    // Check for duplicate invoice in same period
    const existing = await this.invoiceRepo.findOne({
      where: {
        subscriptionId: sub.id,
        periodStart: new Date(periodStart),
        status: In([InvoiceStatus.DRAFT, InvoiceStatus.SENT, InvoiceStatus.PAID]),
      },
    });
    if (existing) {
      throw new BadRequestException(`Ya existe una factura para este período (${existing.invoiceNumber})`);
    }

    const invoiceNumber = await this.getNextInvoiceNumber();
    const dueDate = new Date(periodStart);
    dueDate.setDate(dueDate.getDate() + 15); // 15 days to pay

    // Build lines
    const lines: Partial<InvoiceLine>[] = [];

    // Line 1: Plan base
    const planPrice = this.getPlanPriceForPeriod(sub);
    if (planPrice > 0) {
      const periodLabel = { monthly: 'Mensual', quarterly: 'Trimestral', semiannual: 'Semestral', annual: 'Anual' }[sub.billingPeriod] || 'Mensual';
      lines.push({
        concept: `Plan ${sub.plan?.name || 'Base'} — ${periodLabel}`,
        quantity: 1,
        unitPrice: planPrice,
        total: planPrice,
      });
    }

    // Line 2: AI Addon (if any)
    if (sub.aiAddonCalls > 0 && Number(sub.aiAddonPrice) > 0) {
      const months = this.getMonthsInPeriod(sub.billingPeriod);
      const addonTotal = Number(sub.aiAddonPrice) * months;
      lines.push({
        concept: `Add-on IA +${sub.aiAddonCalls} análisis/mes`,
        quantity: months,
        unitPrice: Number(sub.aiAddonPrice),
        total: addonTotal,
      });
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
      periodStart: new Date(periodStart),
      periodEnd,
      subtotal,
      taxRate,
      taxAmount,
      total,
      currency: sub.plan?.currency || 'UF',
    });

    const saved = await this.invoiceRepo.save(invoice);

    // Save lines
    for (const line of lines) {
      await this.lineRepo.save(this.lineRepo.create({ ...line, invoiceId: saved.id }));
    }

    if (userId) {
      await this.auditService.log(sub.tenantId, userId, 'invoice.generated', 'invoice', saved.id, { invoiceNumber, total }).catch(() => {});
    }

    return this.invoiceRepo.findOne({ where: { id: saved.id }, relations: ['tenant', 'lines'] }) as Promise<Invoice>;
  }

  // ─── Bulk Generate ──────────────────────────────────────────────────

  async generateBulkInvoices(userId: string): Promise<{ generated: number; skipped: number; errors: string[] }> {
    const subs = await this.subRepo.find({
      where: { status: In([SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIAL]) },
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
    status?: string; tenantId?: string; periodMonth?: string;
  }): Promise<Invoice[]> {
    const qb = this.invoiceRepo.createQueryBuilder('i')
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

    const all = await this.invoiceRepo.find({ select: ['id', 'total', 'status', 'issueDate', 'dueDate', 'currency'] });

    const thisMonth = all.filter(i => new Date(i.issueDate) >= monthStart && new Date(i.issueDate) <= monthEnd);

    const totalInvoiced = thisMonth.reduce((s, i) => s + Number(i.total), 0);
    const totalPaid = thisMonth.filter(i => i.status === InvoiceStatus.PAID).reduce((s, i) => s + Number(i.total), 0);
    const totalPending = all.filter(i => i.status === InvoiceStatus.SENT || i.status === InvoiceStatus.DRAFT).reduce((s, i) => s + Number(i.total), 0);
    const totalOverdue = all.filter(i => i.status === InvoiceStatus.OVERDUE || (i.status === InvoiceStatus.SENT && new Date(i.dueDate) < now)).reduce((s, i) => s + Number(i.total), 0);

    // Monthly evolution (last 6 months)
    const evolution: { month: string; invoiced: number; paid: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const monthInvoices = all.filter(inv => {
        const dt = new Date(inv.issueDate);
        return dt >= d && dt <= mEnd;
      });
      evolution.push({
        month: key,
        invoiced: Math.round(monthInvoices.reduce((s, inv) => s + Number(inv.total), 0) * 100) / 100,
        paid: Math.round(monthInvoices.filter(inv => inv.status === InvoiceStatus.PAID).reduce((s, inv) => s + Number(inv.total), 0) * 100) / 100,
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
      revenueBreakdown: { plan: Math.round(planRevenue * 100) / 100, addon: Math.round(addonRevenue * 100) / 100 },
      currency: 'UF',
    };
  }

  // ─── Mark as Paid ───────────────────────────────────────────────────

  async markAsPaid(invoiceId: string, paymentData: { paymentMethod?: string; transactionRef?: string; notes?: string }, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId }, relations: ['tenant', 'lines'] });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === InvoiceStatus.PAID) throw new BadRequestException('La factura ya está pagada');
    if (invoice.status === InvoiceStatus.CANCELLED) throw new BadRequestException('No se puede pagar una factura cancelada');

    invoice.status = InvoiceStatus.PAID;
    invoice.paidAt = new Date();
    await this.invoiceRepo.save(invoice);

    // Create payment history record
    const sub = await this.subRepo.findOne({ where: { id: invoice.subscriptionId } });
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
      if (sub.status === SubscriptionStatus.SUSPENDED || sub.status === SubscriptionStatus.EXPIRED) {
        sub.status = SubscriptionStatus.ACTIVE;
      }
      await this.subRepo.save(sub);
    }

    await this.auditService.log(invoice.tenantId, userId, 'invoice.paid', 'invoice', invoiceId, {
      invoiceNumber: invoice.invoiceNumber, amount: invoice.total,
    }).catch(() => {});

    return invoice;
  }

  // ─── Send Invoice Email ─────────────────────────────────────────────

  async sendInvoice(invoiceId: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId }, relations: ['tenant', 'lines'] });
    if (!invoice) throw new NotFoundException('Factura no encontrada');

    // Find tenant admins
    const admins = await this.userRepo.find({
      where: { tenantId: invoice.tenantId, role: 'tenant_admin', isActive: true },
      select: ['id', 'email', 'firstName'],
    });

    for (const admin of admins) {
      await this.emailService.send(
        admin.email,
        `Factura ${invoice.invoiceNumber} — Eva360`,
        `<p>Hola ${admin.firstName},</p><p>Se ha generado la factura <strong>${invoice.invoiceNumber}</strong> por un total de <strong>${invoice.total} ${invoice.currency}</strong>.</p><p>Período: ${new Date(invoice.periodStart).toLocaleDateString('es-CL')} al ${new Date(invoice.periodEnd).toLocaleDateString('es-CL')}<br>Vencimiento: ${new Date(invoice.dueDate).toLocaleDateString('es-CL')}</p><p>Puede ver el detalle y descargar el PDF desde su panel de suscripción en Eva360.</p><p>Saludos,<br>Equipo Eva360</p>`,
      ).catch(() => {});
    }

    invoice.status = invoice.status === InvoiceStatus.DRAFT ? InvoiceStatus.SENT : invoice.status;
    invoice.sentAt = new Date();
    await this.invoiceRepo.save(invoice);

    await this.auditService.log(invoice.tenantId, userId, 'invoice.sent', 'invoice', invoiceId, { invoiceNumber: invoice.invoiceNumber }).catch(() => {});

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
        await this.emailService.send(
          admin.email,
          subject,
          `<p>Hola ${admin.firstName},</p><p>${isOverdue ? 'La siguiente factura se encuentra <strong style="color:red">VENCIDA</strong>' : 'Le recordamos que la siguiente factura vence pronto'}:</p><p>Factura: <strong>${inv.invoiceNumber}</strong><br>Total: <strong>${inv.total} ${inv.currency}</strong><br>Vencimiento: ${new Date(inv.dueDate).toLocaleDateString('es-CL')}</p><p>Por favor realice el pago a la brevedad.</p><p>Saludos,<br>Equipo Eva360</p>`,
        ).catch(() => {});
      }
      sent++;
    }

    if (userId) {
      await this.auditService.log('system', userId, 'invoice.reminders_sent', 'invoice', undefined, { count: sent }).catch(() => {});
    }

    return { sent };
  }

  // ─── Cancel Invoice ─────────────────────────────────────────────────

  async cancelInvoice(invoiceId: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceRepo.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === InvoiceStatus.PAID) throw new BadRequestException('No se puede cancelar una factura ya pagada');

    invoice.status = InvoiceStatus.CANCELLED;
    await this.invoiceRepo.save(invoice);

    await this.auditService.log(invoice.tenantId, userId, 'invoice.cancelled', 'invoice', invoiceId, { invoiceNumber: invoice.invoiceNumber }).catch(() => {});

    return invoice;
  }

  // ─── PDF Generation ─────────────────────────────────────────────────

  async generatePdf(invoiceId: string, tenantId: string | null): Promise<Buffer> {
    const where: any = { id: invoiceId };
    if (tenantId !== null) where.tenantId = tenantId;
    const invoice = await this.invoiceRepo.findOne({ where, relations: ['tenant', 'lines', 'subscription'] });
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
    doc.text('Eva360 — Ascenda Performance SpA', pageW - margin, 14, { align: 'right' });
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
    if (invoice.tenant?.rut) { doc.text(`RUT: ${invoice.tenant.rut}`, margin, y); y += 4; }
    if (invoice.tenant?.commercialAddress) { doc.text(invoice.tenant.commercialAddress, margin, y); y += 4; }

    // Invoice details (right side)
    const rx = pageW - margin - 60;
    let ry = 48;
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    const details = [
      ['Fecha emisión:', new Date(invoice.issueDate).toLocaleDateString('es-CL')],
      ['Fecha vencimiento:', new Date(invoice.dueDate).toLocaleDateString('es-CL')],
      ['Período:', `${new Date(invoice.periodStart).toLocaleDateString('es-CL')} - ${new Date(invoice.periodEnd).toLocaleDateString('es-CL')}`],
      ['Estado:', invoice.status === 'paid' ? 'PAGADA' : invoice.status === 'overdue' ? 'VENCIDA' : invoice.status === 'sent' ? 'ENVIADA' : 'BORRADOR'],
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
      body: (invoice.lines || []).map(l => [
        l.concept,
        String(l.quantity),
        `${Number(l.unitPrice).toFixed(2)} ${invoice.currency}`,
        `${Number(l.total).toFixed(2)} ${invoice.currency}`,
      ]),
      headStyles: { fillColor: [201, 147, 58], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });

    // Totals
    const finalY = (doc as any).lastAutoTable?.finalY || y + 30;
    const totX = pageW - margin - 55;
    let totY = finalY + 8;
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Subtotal:', totX, totY);
    doc.setTextColor(26, 18, 6);
    doc.text(`${Number(invoice.subtotal).toFixed(2)} ${invoice.currency}`, pageW - margin, totY, { align: 'right' });
    totY += 6;
    doc.setTextColor(100, 116, 139);
    doc.text(`IVA ${invoice.taxRate}%:`, totX, totY);
    doc.setTextColor(26, 18, 6);
    doc.text(`${Number(invoice.taxAmount).toFixed(2)} ${invoice.currency}`, pageW - margin, totY, { align: 'right' });
    totY += 8;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(totX - 4, totY - 5, pageW - margin - totX + 8, 12, 2, 2, 'F');
    doc.setFontSize(11);
    doc.setTextColor(201, 147, 58);
    doc.text('TOTAL:', totX, totY + 2);
    doc.setTextColor(26, 18, 6);
    doc.text(`${Number(invoice.total).toFixed(2)} ${invoice.currency}`, pageW - margin, totY + 2, { align: 'right' });

    // Footer
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    const footY = doc.internal.pageSize.getHeight() - 12;
    doc.text('Eva360 — Plataforma de Evaluación de Desempeño | www.eva360.ascenda.cl', margin, footY);
    doc.text(`Factura ${invoice.invoiceNumber} — Generada el ${new Date().toLocaleDateString('es-CL')}`, pageW - margin, footY, { align: 'right' });

    return Buffer.from(doc.output('arraybuffer'));
  }

  // ─── Helpers ────────────────────────────────────────────────────────

  private getPlanPriceForPeriod(sub: Subscription): number {
    const plan = sub.plan;
    if (!plan) return 0;
    switch (sub.billingPeriod) {
      case BillingPeriod.QUARTERLY: return Number(plan.quarterlyPrice) || Number(plan.monthlyPrice) * 3 * 0.9;
      case BillingPeriod.SEMIANNUAL: return Number(plan.semiannualPrice) || Number(plan.monthlyPrice) * 6 * 0.85;
      case BillingPeriod.ANNUAL: return Number(plan.yearlyPrice) || Number(plan.monthlyPrice) * 12 * 0.8;
      default: return Number(plan.monthlyPrice) || 0;
    }
  }

  private getMonthsInPeriod(period: string): number {
    switch (period) {
      case BillingPeriod.QUARTERLY: return 3;
      case BillingPeriod.SEMIANNUAL: return 6;
      case BillingPeriod.ANNUAL: return 12;
      default: return 1;
    }
  }

  private addBillingPeriod(date: Date, period: string): Date {
    const d = new Date(date);
    switch (period) {
      case BillingPeriod.QUARTERLY: d.setMonth(d.getMonth() + 3); break;
      case BillingPeriod.SEMIANNUAL: d.setMonth(d.getMonth() + 6); break;
      case BillingPeriod.ANNUAL: d.setFullYear(d.getFullYear() + 1); break;
      default: d.setMonth(d.getMonth() + 1);
    }
    return d;
  }
}
