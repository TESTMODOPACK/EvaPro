import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Feature } from '../../common/decorators/feature.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { LeaderStreaksService } from './leader-streaks.service';

/**
 * v3.1 F6 — Leader Streaks controller.
 *
 * Gated por PlanFeature.LEADER_STREAKS (Growth+). El endpoint /me es
 * accesible para manager+admin (employee no tiene streaks de líder
 * relevantes). /tenant es solo para admin.
 */
@Controller('leader-streaks')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.LEADER_STREAKS)
export class LeaderStreaksController {
  constructor(private readonly service: LeaderStreaksService) {}

  /** Streaks del usuario autenticado (manager/admin). */
  @Get('me')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getMyStreaks(@Request() req: any) {
    return this.service.computeStreaksForUser(req.user.tenantId, req.user.userId);
  }

  /** Ranking de todos los líderes (manager+tenant_admin) del tenant. */
  @Get('tenant')
  @Roles('super_admin', 'tenant_admin')
  getTenantLeaderboard(@Request() req: any) {
    return this.service.computeTenantLeaderboard(req.user.tenantId, req.user.role);
  }
}
