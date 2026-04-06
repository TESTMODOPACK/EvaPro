import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  Res,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { KpiService } from './kpi.service';
import { ExecutiveDashboardService } from './executive-dashboard.service';
import { AnalyticsService } from './analytics.service';
import { CrossAnalysisService } from './cross-analysis.service';
import { AuditService } from '../audit/audit.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly kpiService: KpiService,
    private readonly executiveDashboardService: ExecutiveDashboardService,
    private readonly analyticsService: AnalyticsService,
    private readonly crossAnalysisService: CrossAnalysisService,
    private readonly auditService: AuditService,
  ) {}

  // B7.1: Fire-and-forget audit log for report access
  private logAccess(req: any, reportType: string, meta?: Record<string, any>) {
    this.auditService
      .log(req.user.tenantId, req.user.userId, 'report.viewed', 'report', undefined, { reportType, ...meta })
      .catch(() => {});
  }

  // ─── Executive Dashboard ─────────────────────────────────────────────

  @Get('executive-dashboard')
  @Roles('super_admin', 'tenant_admin', 'manager')
  executiveDashboard(@Query('cycleId') cycleId: string, @Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    this.logAccess(req, 'executive_dashboard', { cycleId });
    return this.executiveDashboardService.getExecutiveSummary(
      req.user.tenantId,
      cycleId || undefined,
      managerId,
    );
  }

  // ─── Custom KPIs ──────────────────────────────────────────────────────

  @Get('kpis')
  @Roles('super_admin', 'tenant_admin', 'manager')
  findKpis(@Request() req: any) {
    return this.kpiService.findAll(req.user.tenantId);
  }

  @Get('kpis/calculate')
  @Roles('super_admin', 'tenant_admin', 'manager')
  calculateKpis(@Request() req: any) {
    return this.kpiService.calculateAll(req.user.tenantId);
  }

  @Post('kpis')
  @Roles('super_admin', 'tenant_admin')
  createKpi(@Request() req: any, @Body() dto: any) {
    return this.kpiService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Patch('kpis/:id')
  @Roles('super_admin', 'tenant_admin')
  updateKpi(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() dto: any) {
    return this.kpiService.update(req.user.tenantId, id, dto);
  }

  @Delete('kpis/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  deactivateKpi(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.kpiService.deactivate(req.user.tenantId, id);
  }

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
    @Query('department') department: string,
    @Query('position') position: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    // Managers only see their team's data
    const managerId = role === 'manager' ? userId : undefined;
    const filters: any = {};
    if (department) filters.department = department;
    if (position) filters.position = position;
    if (managerId) filters.managerId = managerId;
    const hasFilters = Object.keys(filters).length > 0 ? filters : undefined;
    this.logAccess(req, 'cycle_summary', { cycleId, filters: hasFilters });
    return this.reportsService.cycleSummary(cycleId, req.user.tenantId, hasFilters);
  }

  @Get('cycle/:cycleId/individual/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  individualResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    this.logAccess(req, 'individual_results', { cycleId, targetUserId: userId });
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
    this.logAccess(req, 'team_results', { cycleId, managerId });
    return this.reportsService.teamResults(cycleId, managerId, req.user.tenantId);
  }

  @Get('users/:userId/performance-history')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  performanceHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query('cycleType') cycleType: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    this.logAccess(req, 'performance_history', { targetUserId: userId });
    const filters = cycleType ? { cycleType } : undefined;
    return this.reportsService.getPerformanceHistory(req.user.tenantId, userId, filters);
  }

  @Get('analytics')
  @Roles('super_admin', 'tenant_admin', 'manager')
  analytics(
    @Query('cycleId') cycleId: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    // Managers only see analytics for their direct reports
    const managerId = role === 'manager' ? userId : undefined;
    this.logAccess(req, 'analytics', { cycleId, managerId });
    return this.reportsService.getAnalytics(req.user.tenantId, cycleId, managerId);
  }

  // ─── Bloque C: Advanced reports ────────────────────────────────────────

  @Get('cycle/:cycleId/competency-radar/:userId')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  competencyRadar(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    this.logAccess(req, 'competency_radar', { cycleId, targetUserId: userId });
    return this.reportsService.competencyRadar(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/self-vs-others/:userId')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  selfVsOthers(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    this.logAccess(req, 'self_vs_others', { cycleId, targetUserId: userId });
    return this.reportsService.selfVsOthers(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/bell-curve')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager')
  bellCurve(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('department') department: string,
    @Query('position') position: string,
    @Request() req: any,
  ) {
    const filters: any = {};
    if (department) filters.department = department;
    if (position) filters.position = position;
    if (req.user.role === 'manager') filters.managerId = req.user.userId;
    this.logAccess(req, 'bell_curve', { cycleId, filters });
    return this.reportsService.bellCurve(cycleId, req.user.tenantId, Object.keys(filters).length ? filters : undefined);
  }

  @Get('cycle/:cycleId/heatmap')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager')
  performanceHeatmap(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('department') department: string,
    @Query('position') position: string,
    @Request() req: any,
  ) {
    const filters: any = {};
    if (department) filters.department = department;
    if (position) filters.position = position;
    if (req.user.role === 'manager') filters.managerId = req.user.userId;
    this.logAccess(req, 'performance_heatmap', { cycleId, filters });
    return this.reportsService.performanceHeatmap(cycleId, req.user.tenantId, Object.keys(filters).length ? filters : undefined);
  }

  // ─── Competency Heatmap ──────────────────────────────────────────────

  @Get('cycle/:cycleId/competency-heatmap')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager')
  competencyHeatmap(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('department') department: string,
    @Query('position') position: string,
    @Request() req: any,
  ) {
    const filters: any = {};
    if (department) filters.department = department;
    if (position) filters.position = position;
    if (req.user.role === 'manager') filters.managerId = req.user.userId;
    this.logAccess(req, 'competency_heatmap', { cycleId, filters });
    return this.reportsService.competencyHeatmap(cycleId, req.user.tenantId, Object.keys(filters).length ? filters : undefined);
  }

  // ─── Gap Analysis ─────────────────────────────────────────────────────

  @Get('cycle/:cycleId/gap-analysis/:userId')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  gapAnalysisIndividual(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    this.validateUserAccess(req, userId);
    this.logAccess(req, 'gap_analysis_individual', { cycleId, targetUserId: userId });
    return this.reportsService.gapAnalysisIndividual(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/gap-analysis-team/:managerId')
  @Feature(PlanFeature.ADVANCED_REPORTS)
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
    this.logAccess(req, 'gap_analysis_team', { cycleId, managerId });
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
    this.auditService
      .log(req.user.tenantId, req.user.userId, 'report.exported', 'report', cycleId, { format: format || 'csv' })
      .catch(() => {});

    if (format === 'pdf') {
      const pdfBuffer = await this.reportsService.exportPdf(cycleId, req.user.tenantId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=reporte-${cycleId}.pdf`);
      return res.send(pdfBuffer);
    }

    if (format === 'pptx') {
      const pptxBuffer = await this.reportsService.exportPptx(cycleId, req.user.tenantId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename=reporte-${cycleId}.pptx`);
      return res.send(pptxBuffer);
    }

    if (format === 'xlsx') {
      const xlsxBuffer = await this.reportsService.exportXlsx(cycleId, req.user.tenantId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=reporte-${cycleId}.xlsx`);
      return res.send(xlsxBuffer);
    }

    const csv = await this.reportsService.exportCsv(cycleId, req.user.tenantId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=reporte-${cycleId}.csv`);
    return res.send(csv);
  }

  // ─── Analytics Cycle Export ──────────────────────────────────────────

  @Get('analytics/cycle/:cycleId/export')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  @Roles('super_admin', 'tenant_admin', 'manager')
  async exportAnalyticsCycle(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('format') format: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    await this.auditService
      .log(req.user.tenantId, req.user.userId, 'report.exported', 'report', cycleId, { report: 'analytics-cycle', format })
      .catch(() => {});

    if (format === 'pdf') {
      const buffer = await this.reportsService.exportAnalyticsCyclePdf(cycleId, req.user.tenantId, managerId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=analisis-ciclo-${cycleId}.pdf`);
      return res.send(buffer);
    }

    if (format === 'pptx') {
      const buffer = await this.reportsService.exportAnalyticsCyclePptx(cycleId, req.user.tenantId, managerId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename=analisis-ciclo-${cycleId}.pptx`);
      return res.send(buffer);
    }

    // Default: xlsx
    const buffer = await this.reportsService.exportAnalyticsCycleXlsx(cycleId, req.user.tenantId, managerId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=analisis-ciclo-${cycleId}.xlsx`);
    return res.send(buffer);
  }

  // ─── Cross Analysis (Clima × Desempeño) ─────────────────────────────

  @Get('cross-analysis/export')
  @Roles('tenant_admin', 'manager')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  async exportCrossAnalysis(
    @Request() req: any,
    @Query('format') format: string,
    @Query('cycleIds') cycleIds?: string,
    @Query('surveyId') surveyId?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    const ids = cycleIds ? cycleIds.split(',').filter(Boolean) : undefined;
    const data = await this.crossAnalysisService.getCrossAnalysis(req.user.tenantId, ids, surveyId, managerId);
    await this.auditService.log(req.user.tenantId, req.user.userId, 'report.exported', 'report', undefined, { report: 'cross-analysis', format }).catch(() => {});

    if (format === 'pdf') {
      const buffer = await this.crossAnalysisService.exportPdf(data);
      res!.setHeader('Content-Type', 'application/pdf');
      res!.setHeader('Content-Disposition', 'attachment; filename=analisis-integrado.pdf');
      return res!.send(buffer);
    }
    if (format === 'xlsx') {
      const buffer = await this.crossAnalysisService.exportXlsx(data);
      res!.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res!.setHeader('Content-Disposition', 'attachment; filename=analisis-integrado.xlsx');
      return res!.send(buffer);
    }
    const csv = this.crossAnalysisService.exportCsv(data);
    res!.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res!.setHeader('Content-Disposition', 'attachment; filename=analisis-integrado.csv');
    return res!.send(csv);
  }

  @Get('cross-analysis/available')
  @Roles('tenant_admin', 'manager')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  getCrossAnalysisAvailable(@Request() req: any) {
    return this.crossAnalysisService.getAvailableData(req.user.tenantId);
  }

  @Get('cross-analysis')
  @Roles('tenant_admin', 'manager')
  @Feature(PlanFeature.ADVANCED_REPORTS)
  getCrossAnalysis(
    @Request() req: any,
    @Query('cycleIds') cycleIds?: string,
    @Query('surveyId') surveyId?: string,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    const ids = cycleIds ? cycleIds.split(',').filter(Boolean) : undefined;
    return this.crossAnalysisService.getCrossAnalysis(req.user.tenantId, ids, surveyId, managerId);
  }

  // ─── Analytics Reports ──────────────────────────────────────────────

  @Get('analytics/pdi-compliance/export')
  @Roles('tenant_admin', 'manager')
  async exportPdiCompliance(
    @Request() req: any,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    const data = await this.analyticsService.getPdiCompliance(req.user.tenantId, managerId);
    await this.auditService.log(req.user.tenantId, req.user.userId, 'report.exported', 'report', undefined, { report: 'pdi-compliance', format }).catch(() => {});
    if (format === 'xlsx') {
      const buffer = await this.analyticsService.exportPdiComplianceXlsx(data);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=cumplimiento-pdi.xlsx');
      return res.send(buffer);
    }
    const csv = this.analyticsService.exportPdiComplianceCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=cumplimiento-pdi.csv');
    return res.send(csv);
  }

  /** Cumplimiento PDI — tenant_admin (all) / manager (team) */
  @Get('analytics/pdi-compliance')
  @Roles('tenant_admin', 'manager')
  getPdiCompliance(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.analyticsService.getPdiCompliance(req.user.tenantId, managerId);
  }

  @Get('analytics/system-usage/export')
  @Roles('super_admin', 'tenant_admin')
  async exportSystemUsage(
    @Request() req: any,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    const data = await this.analyticsService.getSystemUsage(tenantId);
    await this.auditService.log(req.user.tenantId, req.user.userId, 'report.exported', 'report', undefined, { report: 'system-usage', format }).catch(() => {});
    if (format === 'xlsx') {
      const buffer = await this.analyticsService.exportSystemUsageXlsx(data);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=adopcion-uso.xlsx');
      return res.send(buffer);
    }
    const csv = this.analyticsService.exportSystemUsageCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=adopcion-uso.csv');
    return res.send(csv);
  }

  /** Uso del Sistema — super_admin (all orgs) / tenant_admin (own org) */
  @Get('analytics/system-usage')
  @Roles('super_admin', 'tenant_admin')
  getSystemUsage(@Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.analyticsService.getSystemUsage(tenantId);
  }

  @Get('analytics/cycle-comparison/export')
  @Roles('tenant_admin', 'manager')
  async exportCycleComparison(
    @Request() req: any,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    const data = await this.analyticsService.getCycleComparison(req.user.tenantId, managerId);
    await this.auditService
      .log(req.user.tenantId, req.user.userId, 'report.exported', 'report', undefined, { report: 'cycle-comparison', format })
      .catch(() => {});

    if (format === 'xlsx') {
      const buffer = await this.analyticsService.exportCycleComparisonXlsx(data);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=comparativa-ciclos.xlsx');
      return res.send(buffer);
    }

    const csv = this.analyticsService.exportCycleComparisonCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=comparativa-ciclos.csv');
    return res.send(csv);
  }

  /** Comparativa entre Ciclos — tenant_admin (all) / manager (team) */
  @Get('analytics/cycle-comparison')
  @Roles('tenant_admin', 'manager')
  getCycleComparison(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.analyticsService.getCycleComparison(req.user.tenantId, managerId);
  }

  @Get('analytics/turnover/export')
  @Roles('tenant_admin')
  async exportTurnover(
    @Request() req: any,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.analyticsService.getTurnoverAnalysis(req.user.tenantId);
    await this.auditService
      .log(req.user.tenantId, req.user.userId, 'report.exported', 'report', undefined, { report: 'turnover', format })
      .catch(() => {});

    if (format === 'xlsx') {
      const buffer = await this.analyticsService.exportTurnoverXlsx(data);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=analisis-rotacion.xlsx');
      return res.send(buffer);
    }

    // CSV default
    const csv = this.analyticsService.exportTurnoverCsv(data);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=analisis-rotacion.csv');
    return res.send(csv);
  }

  /** Análisis de Rotación — tenant_admin only */
  @Get('analytics/turnover')
  @Roles('tenant_admin')
  getTurnover(@Request() req: any) {
    return this.analyticsService.getTurnoverAnalysis(req.user.tenantId);
  }

  /** Movimientos Internos — tenant_admin + manager */
  @Get('analytics/movements')
  @Roles('tenant_admin', 'manager')
  getInternalMovements(@Request() req: any) {
    return this.analyticsService.getInternalMovementAnalysis(req.user.tenantId);
  }
}
