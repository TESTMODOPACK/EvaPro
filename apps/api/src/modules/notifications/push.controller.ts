import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Query,
  Request,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PushService } from './push.service';
import { SubscribePushDto } from './dto/subscribe-push.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('notifications/push')
@UseGuards(AuthGuard('jwt'))
export class PushController {
  constructor(private readonly pushService: PushService) {}

  /** Devuelve la VAPID public key para que el frontend la use al suscribirse. */
  @Get('vapid-key')
  getVapidKey() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!publicKey) {
      throw new NotFoundException('VAPID no configurado en el servidor');
    }
    return { publicKey };
  }

  /** Registra una subscripción de push (idempotente por endpoint). */
  @Post('subscribe')
  @HttpCode(HttpStatus.CREATED)
  async subscribe(@Request() req: any, @Body() dto: SubscribePushDto) {
    if (!req.user?.tenantId || !req.user?.userId) {
      throw new BadRequestException('Usuario sin tenant asignado');
    }
    const sub = await this.pushService.subscribe(
      req.user.tenantId,
      req.user.userId,
      {
        endpoint: dto.endpoint,
        keys: dto.keys,
        userAgent: dto.userAgent || req.headers['user-agent'],
      },
    );
    // No devolvemos las keys (p256dh/auth) por seguridad.
    return {
      id: sub.id,
      createdAt: sub.createdAt,
      lastUsedAt: sub.lastUsedAt,
    };
  }

  /**
   * Desuscribe un endpoint específico (típicamente llamado al cerrar sesión).
   *
   * Acepta el endpoint como body (compatible con clientes legacy) O como
   * query param (preferido: algunos proxies/WAFs strippean el body de DELETE).
   */
  @Delete('unsubscribe')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unsubscribe(
    @Request() req: any,
    @Body('endpoint') endpointBody?: string,
    @Query('endpoint') endpointQuery?: string,
  ) {
    const endpoint = endpointQuery || endpointBody;
    if (!endpoint) {
      throw new BadRequestException('endpoint requerido (body o ?endpoint=)');
    }
    await this.pushService.unsubscribe(req.user.userId, endpoint);
  }

  /** Lista los devices registrados por el usuario autenticado. */
  @Get('devices')
  async listDevices(@Request() req: any) {
    return this.pushService.listForUser(req.user.userId);
  }

  /**
   * Envía push de prueba al usuario autenticado. Disponible solo fuera de
   * producción (NODE_ENV !== 'production') para debugging.
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async test(@Request() req: any) {
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException(
        'Endpoint de prueba no disponible en producción',
      );
    }
    return this.pushService.sendToUser(req.user.userId, {
      title: 'EVA360 — Notificación de prueba',
      body: 'Si ves este mensaje, las notificaciones funcionan correctamente.',
      url: '/dashboard/perfil',
      tag: 'test-notification',
    });
  }

  /**
   * Métricas agregadas para dashboard admin (super_admin only).
   * Sin detalles sensibles (endpoints, keys).
   */
  @Get('metrics')
  @UseGuards(RolesGuard)
  @Roles('super_admin')
  async getMetrics() {
    return this.pushService.getMetrics();
  }
}
