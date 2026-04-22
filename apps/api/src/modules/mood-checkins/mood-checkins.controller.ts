import {
  Body, Controller, Get, Post, Query, Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Feature } from '../../common/decorators/feature.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SubmitMoodCheckinDto } from './dto/mood-checkin.dto';
import { MoodCheckinsService } from './mood-checkins.service';

/**
 * v3.1 F3 — Controller para mood check-ins diarios.
 * Plan mínimo: Growth (MOOD_TRACKING).
 */
@Controller('mood-checkins')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.MOOD_TRACKING)
export class MoodCheckinsController {
  constructor(private readonly service: MoodCheckinsService) {}

  /** Registra (o actualiza) el mood del día actual del user. */
  @Post()
  submit(@Request() req: any, @Body() dto: SubmitMoodCheckinDto) {
    return this.service.submitMood(req.user.tenantId, req.user.userId, dto);
  }

  /** Retorna el registro de hoy del caller (o null si no registró). */
  @Get('me/today')
  getToday(@Request() req: any) {
    return this.service.getMyToday(req.user.tenantId, req.user.userId);
  }

  /** Histórico personal de los últimos N días (default 30, max 180). */
  @Get('me/history')
  getHistory(@Request() req: any, @Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 30;
    return this.service.getMyHistory(req.user.tenantId, req.user.userId, n);
  }

  /**
   * Agregado por día para el equipo. Solo manager/admin.
   * Respeta MIN_TEAM_RESPONSES=3 (privacidad).
   */
  @Get('team/history')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getTeamHistory(@Request() req: any, @Query('days') days?: string) {
    const n = days ? parseInt(days, 10) : 14;
    return this.service.getTeamAggregate(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      n,
    );
  }

  /** Resumen del día actual para el dashboard manager/admin. */
  @Get('team/today')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getTeamToday(@Request() req: any) {
    return this.service.getTeamTodaySummary(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
    );
  }
}
