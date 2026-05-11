import {
  Controller, Get, Post, Patch, Body, Param, Query, Res, UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get('stats')
  @Roles('super_admin')
  getStats() {
    return this.invoicesService.getInvoiceStats();
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
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query('period') period?: string,
    @Query('type') type?: 'invoice' | 'credit_note' | 'all',
  ) {
    // Fase 2 / Tarea 2.2.3 — type opcional (default 'invoice').
    return this.invoicesService.getAllInvoices({ status, tenantId, periodMonth: period, type });
  }

  @Post('generate/:subscriptionId')
  @Roles('super_admin')
  generate(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Request() req: any,
  ) {
    return this.invoicesService.generateInvoice(subscriptionId, req.user.userId);
  }

  @Post('generate-bulk')
  @Roles('super_admin')
  generateBulk(@Request() req: any) {
    return this.invoicesService.generateBulkInvoices(req.user.userId);
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

  @Post(':id/send')
  @Roles('super_admin')
  sendInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.invoicesService.sendInvoice(id, req.user.userId);
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
