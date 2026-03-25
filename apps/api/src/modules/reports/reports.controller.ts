import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  Res,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // ─── Authorization helper ──────────────────────────────────────────────

  /**
   * Validates that the requesting user can view data for the target userId:
   * - super_admin/tenant_admin: can view anyone in their tenant
   * - manager: can view self + direct reports (checked in service via managerId)
   * - employee: can only view their own data
   * - external: denied (no access to individual reports)
   */
  private validateUserAccess(req: any, targetUserId: string) {
    const { role, userId } = req.user;
    if (role === 'external') {
      throw new ForbiddenException('Los asesores externos no pueden acceder a reportes individuales');
    }
    if (role === 'employee' && userId !== targetUserId) {
      throw new ForbiddenException('Solo puedes ver tus propios resultados');
    }
    // manager access: allow self + will be validated by data scope (only their reports show)
    // tenant_admin/super_admin: full access within tenant
  }

  // ─── Cycle-level reports (admin + manager) ─────────────────────────────

  @Get('cycle/:cycleId/summary')
  @Roles('super_admin', 'tenant_admin', 'manager')
  cycleSummary(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.reportsService.cycleSummary(cycleId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/individual/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  individualResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    return this.reportsService.individualResults(cycleId, userId, req.user.tenantId, req.user.userId, req.user.role);
  }

  @Get('cycle/:cycleId/team/:managerId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  teamResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('managerId', ParseUUIDPipe) managerId: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    if (role === 'manager' && managerId !== userId) {
      throw new ForbiddenException('Solo puedes ver los resultados de tu propio equipo');
    }
    return this.reportsService.teamResults(cycleId, managerId, req.user.tenantId);
  }

  @Get('users/:userId/performance-history')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  performanceHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    return this.reportsService.getPerformanceHistory(req.user.tenantId, userId);
  }

  @Get('analytics')
  @Roles('super_admin', 'tenant_admin', 'manager')
  analytics(
    @Query('cycleId') cycleId: string,
    @Request() req: any,
  ) {
    return this.reportsService.getAnalytics(req.user.tenantId, cycleId);
  }

  // ─── Bloque C: Advanced reports ────────────────────────────────────────

  @Get('cycle/:cycleId/competency-radar/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  competencyRadar(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    return this.reportsService.competencyRadar(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/self-vs-others/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  selfVsOthers(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    return this.reportsService.selfVsOthers(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/bell-curve')
  @Roles('super_admin', 'tenant_admin', 'manager')
  bellCurve(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.reportsService.bellCurve(cycleId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/heatmap')
  @Roles('super_admin', 'tenant_admin', 'manager')
  performanceHeatmap(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.reportsService.performanceHeatmap(cycleId, req.user.tenantId);
  }

  // ─── Gap Analysis ─────────────────────────────────────────────────────

  @Get('cycle/:cycleId/gap-analysis/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  gapAnalysisIndividual(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    return this.reportsService.gapAnalysisIndividual(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/gap-analysis-team/:managerId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  gapAnalysisTeam(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('managerId', ParseUUIDPipe) managerId: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    if (role === 'manager' && managerId !== userId) {
      throw new ForbiddenException('Solo puedes ver el gap analysis de tu propio equipo');
    }
    return this.reportsService.gapAnalysisTeam(cycleId, managerId, req.user.tenantId);
  }

  // ─── Export ──────────────────────────────────────────────────────────────

  @Get('cycle/:cycleId/export')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async exportResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('format') format: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    if (format === 'pdf') {
      const pdfBuffer = await this.reportsService.exportPdf(cycleId, req.user.tenantId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=reporte-${cycleId}.pdf`);
      return res.send(pdfBuffer);
    }

    const csv = await this.reportsService.exportCsv(cycleId, req.user.tenantId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=reporte-${cycleId}.csv`);
    return res.send(csv);
  }
}
