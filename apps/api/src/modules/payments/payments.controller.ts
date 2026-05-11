import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PaymentsService } from './payments.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// P1.3: getClientIp centralizado (ver auth.controller).
import { getClientIp } from '../../common/utils/get-client-ip';

@Controller('payments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  /**
   * GET /payments/providers — which providers are configured right now.
   * The UI uses this to only show available options in the payment modal.
   * Safe to expose to any authenticated user (no secrets leaked).
   */
  @Get('providers')
  listProviders() {
    return this.svc.listProviders();
  }

  /**
   * POST /payments/checkout — create a Checkout session and get the URL
   * to redirect the user to. Body: { invoiceId, provider }.
   *
   * Any authenticated user in the owning tenant can initiate; we don't
   * restrict to tenant_admin because some orgs delegate payment to a
   * specific person who may have a different role.
   */
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  async createCheckout(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    const userId = req.user.userId || req.user.id;
    const tenantId = req.user.tenantId;
    return this.svc.createCheckout(userId, tenantId, dto.invoiceId, dto.provider, getClientIp(req));
  }

  /**
   * GET /payments/sessions/:id — status lookup used by the success/failure
   * pages to poll until the webhook lands.
   */
  @Get('sessions/:id')
  async getSession(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const userId = req.user.userId || req.user.id;
    const tenantId = req.user.tenantId;
    const s = await this.svc.getSession(id, userId, tenantId);
    // Hide metadata bag from the UI — it contains internal reconciliation
    // detail. Return the minimum fields the page needs.
    return {
      id: s.id,
      provider: s.provider,
      status: s.status,
      failureReason: s.failureReason,
      amount: s.amount,
      currency: s.currency,
      invoiceId: s.invoiceId,
      completedAt: s.completedAt,
    };
  }

  /**
   * Fase 2 / Tarea 2.3.4 — Refund de una invoice ya pagada via provider
   * (Stripe/MP). Solo super_admin: el refund mueve dinero real, requiere
   * autoridad. El cliente no puede gatillarlo — debe pedirlo y el
   * super_admin decide.
   *
   * Body: { amount?: number, reason: string, idempotencyKey?: string }.
   * - amount opcional: si se omite, refund total del cobro.
   * - reason obligatorio (>=3 chars): queda en audit log + provider.
   * - idempotencyKey opcional: reusable para retries seguros.
   *
   * Auto-emite credit note vinculada (status=DRAFT). El super_admin la
   * envia con POST /invoices/:id/send despues si quiere notificar al
   * cliente.
   */
  @Post('refund/:invoiceId')
  @Roles('super_admin')
  refundInvoice(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: { amount?: number; reason: string; idempotencyKey?: string },
    @Req() req: any,
  ) {
    const userId = req.user.userId || req.user.id;
    return this.svc.refundInvoice(invoiceId, dto, userId);
  }
}
