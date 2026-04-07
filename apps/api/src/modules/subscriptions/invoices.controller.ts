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
  myInvoices(@Request() req: any) {
    return this.invoicesService.getAllInvoices({ tenantId: req.user.tenantId });
  }

  @Get()
  @Roles('super_admin')
  list(
    @Query('status') status?: string,
    @Query('tenantId') tenantId?: string,
    @Query('period') period?: string,
  ) {
    return this.invoicesService.getAllInvoices({ status, tenantId, periodMonth: period });
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

  @Get(':id/pdf')
  @Roles('super_admin', 'tenant_admin')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Res() res: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    const pdf = await this.invoicesService.generatePdf(id, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=factura-${id.slice(0, 8)}.pdf`);
    res.send(pdf);
  }
}
