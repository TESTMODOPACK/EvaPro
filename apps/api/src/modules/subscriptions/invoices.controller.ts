import {
  Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { InvoicesService } from './invoices.service';
import { BillingMetricsService } from './billing-metrics.service';
import { BillingSettingsService } from './billing-settings.service';

@Controller('invoices')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    // Fase 4 / T4.2 — metricas SaaS para dashboard ejecutivo.
    private readonly metricsService: BillingMetricsService,
    // Fase 4 / T4.5 — Configuracion fiscal singleton.
    private readonly billingSettingsService: BillingSettingsService,
  ) {}

  // ─── Fase 4 / Tarea 4.5 — Configuracion fiscal editable ─────────────

  /**
   * Devuelve la configuracion fiscal (RUT emisor, IVA, prefijos,
   * vencimiento). Super_admin y tenant_admin pueden leer (los
   * tenant_admin la ven en sus PDFs anyway).
   */
  @Get('billing-settings')
  @Roles('super_admin', 'tenant_admin')
  getBillingSettings() {
    return this.billingSettingsService.get();
  }

  /** Solo super_admin puede editar la configuracion fiscal. */
  @Patch('billing-settings')
  @Roles('super_admin')
  updateBillingSettings(@Body() dto: any, @Request() req: any) {
    return this.billingSettingsService.update(dto, req.user.userId || req.user.id);
  }

  @Get('stats')
  @Roles('super_admin')
  getStats() {
    return this.invoicesService.getInvoiceStats();
  }

  /**
   * Fase 4 / T4.2 — Dashboard de metricas SaaS para super_admin.
   * Returns MRR, ARR, churn, DSO, collection rate de los ultimos 30d.
   */
  @Get('metrics/saas')
  @Roles('super_admin')
  getSaasMetrics() {
    return this.metricsService.getSummary();
  }

  @Get('my')
  @Roles('tenant_admin')
  myInvoices(
    @Request() req: any,
    @Query('type') type?: 'invoice' | 'credit_note' | 'all',
  ) {
    // Fase 2 / Tarea 2.2.3 — el cliente puede listar invoices, sus credit
    // notes, o todo junto. Default: solo invoices (compatibilidad con UI
    // actual de mi-suscripcion).
    return this.invoicesService.getAllInvoices({ tenantId: req.user.tenantId, type });
  }

  @Get()
  @Roles('super_admin')
  list(
    @Query('status') status?: string,
    @Query('statuses') statuses?: string,
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query('period') period?: string,
    @Query('type') type?: 'invoice' | 'credit_note' | 'all',
    // Fase 4 / T4.1 — Filtros avanzados.
    @Query('q') q?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // statuses=comma-separated: 'paid,overdue'.
    const statusesArr = statuses ? statuses.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    return this.invoicesService.getAllInvoices({
      status,
      statuses: statusesArr,
      tenantId,
      periodMonth: period,
      type,
      q,
      dateFrom,
      dateTo,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Post('generate/:subscriptionId')
  @Roles('super_admin')
  generate(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Request() req: any,
  ) {
    return this.invoicesService.generateInvoice(subscriptionId, req.user.userId);
  }

  /**
   * Fase 4 / T4.7 — Bulk generation con opcional dry-run.
   * Query param `?dryRun=true` retorna preview sin commit.
   */
  @Post('generate-bulk')
  @Roles('super_admin')
  generateBulk(@Request() req: any, @Query('dryRun') dryRun?: string) {
    return this.invoicesService.generateBulkInvoices(req.user.userId, {
      dryRun: dryRun === 'true' || dryRun === '1',
    });
  }

  @Patch(':id/pay')
  @Roles('super_admin')
  markAsPaid(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { paymentMethod?: string; transactionRef?: string; notes?: string },
  ) {
    return this.invoicesService.markAsPaid(id, dto, req.user.userId);
  }

  /**
   * Fase 4 / T4.4 — Preview del email ANTES de enviar. Read-only.
   * Permite validar subject + body + destinatarios. Body se renderiza
   * tal como el cliente lo recibira.
   */
  @Get(':id/send/preview')
  @Roles('super_admin')
  previewSendInvoice(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoicesService.previewInvoiceEmail(id);
  }

  @Post(':id/send')
  @Roles('super_admin')
  sendInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { cc?: string[]; bcc?: string[] },
  ) {
    return this.invoicesService.sendInvoice(id, req.user.userId, {
      cc: body?.cc,
      bcc: body?.bcc,
    });
  }

  @Post('send-reminders')
  @Roles('super_admin')
  sendReminders(@Request() req: any) {
    return this.invoicesService.sendReminders(req.user.userId);
  }

  @Patch(':id/cancel')
  @Roles('super_admin')
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.invoicesService.cancelInvoice(id, req.user.userId);
  }

  // ─── Credit Notes (Fase 2 / Tarea 2.2) ──────────────────────────────

  /**
   * Emite una nota de credito sobre una factura ya pagada. Solo
   * super_admin: SII Chile + impacto contable requieren rol con
   * autoridad. El cliente ve la NC pero no la emite.
   */
  @Post(':id/credit-notes')
  @Roles('super_admin')
  issueCreditNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { amount: number; reason: string; notes?: string },
    @Request() req: any,
  ) {
    return this.invoicesService.issueCreditNote(id, dto, req.user.userId);
  }

  @Get(':id/pdf')
  @Roles('super_admin', 'tenant_admin')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Res() res: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    const pdf = await this.invoicesService.generatePdf(id, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=factura-${id.slice(0, 8)}.pdf`);
    res.send(pdf);
  }
}
