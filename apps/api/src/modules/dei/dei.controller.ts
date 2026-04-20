import { Controller, Get, Post, Patch, Query, Body, Param, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeiService } from './dei.service';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('dei')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin', 'tenant_admin', 'manager')
export class DeiController {
  constructor(private readonly deiService: DeiService) {}

  /** P7.4 — DEI analytics (demographics, equity, gap-report) quedan
   *  restringidos a tenant_admin + super_admin. Decisión de política:
   *   - DEI es responsabilidad HR/C-Level, no de managers individuales.
   *   - Con equipos pequeños (<5 personas), filtrar por manager revela
   *     demografía individual → violación de privacidad / DPA.
   *   - Si un manager necesita composición de su equipo, ya la ve en
   *     /dashboard/usuarios (con el filtro P6 aplicado).
   */
  @Get('demographics')
  @Roles('super_admin', 'tenant_admin')
  getDemographics(@Request() req: any) {
    return this.deiService.getDemographicOverview(req.user.tenantId);
  }

  @Get('equity')
  @Roles('super_admin', 'tenant_admin')
  getEquity(
    @Request() req: any,
    @Query('cycleId', ParseUUIDPipe) cycleId: string,
  ) {
    return this.deiService.getEquityAnalysis(req.user.tenantId, cycleId);
  }

  @Get('gap-report')
  @Roles('super_admin', 'tenant_admin')
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
  //
  // P3.3 — updateConfig: no tiene :id (es 1 config por tenant). Se trata
  //        como primary: super_admin debe pasar dto.tenantId explícito.
  @Patch('config')
  @Roles('super_admin', 'tenant_admin')
  updateConfig(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.deiService.updateConfig(tenantId, dto);
  }

  // ─── Corrective Actions ─────────────────────────────────────────────
  @Get('corrective-actions')
  listCorrectiveActions(@Request() req: any) {
    return this.deiService.listCorrectiveActions(req.user.tenantId);
  }

  /** P2.6 — Cross-tenant defense (corrective action create). */
  @Post('corrective-actions')
  @Roles('super_admin', 'tenant_admin')
  createCorrectiveAction(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.deiService.createCorrectiveAction(tenantId, req.user.userId, dto);
  }

  /** P3.3 — Secondary cross-tenant: super_admin → undefined para buscar
   *  la accion sin filtro de tenant; el service usa entity.tenantId
   *  authoritative. */
  @Patch('corrective-actions/:id')
  @Roles('super_admin', 'tenant_admin')
  updateCorrectiveAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.deiService.updateCorrectiveAction(tenantId, id, dto);
  }
}
