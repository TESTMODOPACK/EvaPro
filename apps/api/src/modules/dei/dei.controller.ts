import { Controller, Get, Post, Patch, Query, Body, Param, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeiService } from './dei.service';

@Controller('dei')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin', 'tenant_admin', 'manager')
export class DeiController {
  constructor(private readonly deiService: DeiService) {}

  @Get('demographics')
  getDemographics(@Request() req: any) {
    return this.deiService.getDemographicOverview(req.user.tenantId);
  }

  @Get('equity')
  getEquity(
    @Request() req: any,
    @Query('cycleId', ParseUUIDPipe) cycleId: string,
  ) {
    return this.deiService.getEquityAnalysis(req.user.tenantId, cycleId);
  }

  @Get('gap-report')
  getGapReport(
    @Request() req: any,
    @Query('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('dimension') dimension: string,
  ) {
    return this.deiService.getGapReport(req.user.tenantId, cycleId, dimension || 'gender');
  }

  // ─── DEI Configuration ──────────────────────────────────────────────
  @Get('config')
  getConfig(@Request() req: any) {
    return this.deiService.getConfig(req.user.tenantId);
  }

  // Writes below override the class-level @Roles to exclude `manager` —
  // modificar configuracion DEI o acciones correctivas del tenant entero
  // es responsabilidad de tenant_admin, no de cada jefe de equipo.
  @Patch('config')
  @Roles('super_admin', 'tenant_admin')
  updateConfig(@Request() req: any, @Body() dto: any) {
    return this.deiService.updateConfig(req.user.tenantId, dto);
  }

  // ─── Corrective Actions ─────────────────────────────────────────────
  @Get('corrective-actions')
  listCorrectiveActions(@Request() req: any) {
    return this.deiService.listCorrectiveActions(req.user.tenantId);
  }

  @Post('corrective-actions')
  @Roles('super_admin', 'tenant_admin')
  createCorrectiveAction(@Request() req: any, @Body() dto: any) {
    return this.deiService.createCorrectiveAction(req.user.tenantId, req.user.userId, dto);
  }

  @Patch('corrective-actions/:id')
  @Roles('super_admin', 'tenant_admin')
  updateCorrectiveAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.deiService.updateCorrectiveAction(req.user.tenantId, id, dto);
  }
}
