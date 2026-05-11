import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * Fase 3 / Tarea 3.4 — Endpoints REST para que el tenant_admin gestione
 * los medios de pago de su organizacion.
 *
 * Reglas de negocio:
 *   - Solo `tenant_admin` accede (gestiona el billing de SU tenant).
 *   - super_admin NO se expone aqui — los medios de pago son del cliente.
 *   - Aislamiento: cada endpoint scopea por `req.user.tenantId`. El
 *     service tambien valida (`tenantId !== method.tenantId -> 403`).
 */
@Controller('payment-methods')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('tenant_admin')
export class PaymentMethodsController {
  constructor(private readonly svc: PaymentMethodsService) {}

  /** Inicia el flow de "agregar tarjeta": retorna client_secret de
   *  SetupIntent + setupIntentId. La UI usa Stripe Elements con esto. */
  @Post('add')
  @HttpCode(HttpStatus.OK)
  startAdd(@Req() req: any) {
    const userId = req.user.userId || req.user.id;
    return this.svc.startAddMethod(req.user.tenantId, userId);
  }

  /** Lista metodos activos del tenant. */
  @Get()
  list(@Req() req: any) {
    return this.svc.listForTenant(req.user.tenantId);
  }

  /** Marca un metodo como default. */
  @Patch(':id/default')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setDefault(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const userId = req.user.userId || req.user.id;
    await this.svc.setDefault(req.user.tenantId, id, userId);
  }

  /** Borra un metodo (revoca del provider + marca local revoked). */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    const userId = req.user.userId || req.user.id;
    await this.svc.delete(req.user.tenantId, id, userId);
  }
}
