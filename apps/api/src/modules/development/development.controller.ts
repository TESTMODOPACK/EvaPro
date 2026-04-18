import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  Res,
  ParseUUIDPipe,
  UseGuards,
  ForbiddenException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevelopmentService } from './development.service';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('development')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DevelopmentController {
  constructor(private readonly developmentService: DevelopmentService) {}

  // ─── Competencies (no feature gate — base catalog for all plans) ──────

  @Get('competencies')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findAllCompetencies(@Request() req: any) {
    // Admins see all statuses; others see only approved
    const includeAll = req.user.role === 'super_admin' || req.user.role === 'tenant_admin';
    return this.developmentService.findAllCompetencies(req.user.tenantId, includeAll);
  }

  /**
   * P3.2 — Defensa cross-tenant:
   *   · PRIMARY POSTs (create/propose/seed-defaults): super_admin debe pasar
   *     tenantId explícito en body (resolveOperatingTenantId falla 400 si no);
   *     tenant_admin ignora body.tenantId y opera en su propio tenant.
   *   · SECONDARY (update/approve/reject/delete con :id): super_admin pasa
   *     tenantId=undefined y el service resuelve vía entity.tenantId
   *     authoritative. tenant_admin sigue scoped (404 si mismatch).
   */
  @Post('competencies')
  @Roles('super_admin', 'tenant_admin')
  createCompetency(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.developmentService.createCompetency(tenantId, dto, req.user.userId);
  }

  @Patch('competencies/:id')
  @Roles('super_admin', 'tenant_admin')
  updateCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.developmentService.updateCompetency(tenantId, id, dto);
  }

  @Post('competencies/seed-defaults')
  @Roles('super_admin', 'tenant_admin')
  seedDefaults(@Request() req: any, @Body() body?: { tenantId?: string }) {
    const tenantId = resolveOperatingTenantId(req.user, body?.tenantId);
    return this.developmentService.seedDefaultCompetencies(tenantId, req.user.userId);
  }

  @Post('competencies/propose')
  @Roles('super_admin', 'tenant_admin', 'manager')
  proposeCompetency(@Request() req: any, @Body() dto: any) {
    // Manager no puede cross-tenant — el helper acepta eso (super_admin only
    // needs explicit, los demás usan su req.user.tenantId sin importar body).
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.developmentService.proposeCompetency(tenantId, req.user.userId, dto);
  }

  @Get('competencies/pending')
  @Roles('super_admin', 'tenant_admin')
  findPendingCompetencies(@Request() req: any) {
    return this.developmentService.findPendingCompetencies(req.user.tenantId);
  }

  @Post('competencies/:id/approve')
  @Roles('super_admin', 'tenant_admin')
  approveCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { note?: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.developmentService.approveCompetency(tenantId, id, req.user.userId, dto?.note);
  }

  @Post('competencies/:id/reject')
  @Roles('super_admin', 'tenant_admin')
  rejectCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { note: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.developmentService.rejectCompetency(tenantId, id, req.user.userId, dto?.note);
  }

  @Delete('competencies/:id')
  @Roles('super_admin', 'tenant_admin')
  deactivateCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.developmentService.deactivateCompetency(tenantId, id);
  }

  // B8.3: Competency profile — actual vs expected for a user's role
  @Get('competency-profile/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getCompetencyProfile(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    // Employees can only see their own profile
    const { role } = req.user;
    if (role === 'employee' && req.user.userId !== userId) {
      throw new ForbiddenException('Solo puedes ver tu propio perfil de competencias');
    }
    return this.developmentService.getCompetencyProfile(req.user.tenantId, userId);
  }

  // ─── Role Competencies (Competencias por Cargo) ─────────────────────────

  @Get('role-competencies')
  @Roles('super_admin', 'tenant_admin', 'manager')
  findRoleCompetencies(
    @Request() req: any,
    @Query('position') position?: string,
    @Query('positionId') positionId?: string,
  ) {
    return this.developmentService.findRoleCompetencies(req.user.tenantId, position, positionId);
  }

  @Post('role-competencies')
  @Roles('super_admin', 'tenant_admin')
  createRoleCompetency(
    @Request() req: any,
    @Body() dto: { position: string; positionId?: string; competencyId: string; expectedLevel: number; tenantId?: string },
  ) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.developmentService.createRoleCompetency(tenantId, dto);
  }

  @Patch('role-competencies/:id')
  @Roles('super_admin', 'tenant_admin')
  updateRoleCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { expectedLevel: number },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.developmentService.updateRoleCompetency(tenantId, id, dto.expectedLevel);
  }

  @Delete('role-competencies/:id')
  @Roles('super_admin', 'tenant_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteRoleCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.developmentService.deleteRoleCompetency(tenantId, id);
  }

  @Post('role-competencies/bulk')
  @Roles('super_admin', 'tenant_admin')
  bulkAssignCompetencies(
    @Request() req: any,
    @Body() dto: { position: string; positionId?: string; defaultLevel?: number; tenantId?: string },
  ) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.developmentService.bulkAssignCompetencies(tenantId, dto.position, dto.defaultLevel || 5, dto.positionId);
  }

  // ─── Plans (requires PDI feature) ──────────────────────────────────────

  /** Planes activos sin acciones cargadas. Para alerta del CommandCenter. */
  @Get('plans/without-actions')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin')
  findPlansWithoutActions(@Request() req: any) {
    return this.developmentService.getActivePlansWithoutActions(req.user.tenantId);
  }

  @Get('plans')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findPlans(@Request() req: any) {
    const { tenantId, userId, role } = req.user;
    if (role === 'tenant_admin' || role === 'super_admin') {
      return this.developmentService.findAllPlans(tenantId);
    }
    if (role === 'manager') {
      return this.developmentService.findPlansByManager(tenantId, userId);
    }
    return this.developmentService.findPlansByUser(tenantId, userId);
  }

  /** Export development plans in CSV, XLSX, or PDF format */
  @Get('plans/export')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async exportPlans(
    @Request() req: any,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const { tenantId, userId, role } = req.user;
    const ext = format?.toLowerCase() || 'csv';

    if (ext === 'xlsx') {
      const buffer = await this.developmentService.exportPlansXlsx(tenantId, userId, role);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=planes-desarrollo.xlsx' });
      return res.send(buffer);
    }
    if (ext === 'pdf') {
      const buffer = await this.developmentService.exportPlansPdf(tenantId, userId, role);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=planes-desarrollo.pdf' });
      return res.send(buffer);
    }
    const csv = await this.developmentService.exportPlansCsv(tenantId, userId, role);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=planes-desarrollo.csv' });
    return res.send(csv);
  }

  @Get('plans/:id')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findPlanById(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.findPlanById(req.user.tenantId, id);
  }

  @Post('plans')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  createPlan(@Request() req: any, @Body() dto: any) {
    return this.developmentService.createPlan(req.user.tenantId, req.user.userId, dto, req.user.role);
  }

  @Post('plans/:id/approve')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager')
  approvePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.approvePlan(req.user.tenantId, id, req.user.userId);
  }

  @Patch('plans/:id')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.updatePlan(req.user.tenantId, id, dto);
  }

  @Post('plans/:id/activate')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager')
  activatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.activatePlan(req.user.tenantId, id, req.user.id);
  }

  @Post('plans/:id/complete')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager')
  completePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.completePlan(req.user.tenantId, id, req.user.id);
  }

  // ─── Actions ───────────────────────────────────────────────────────────

  @Post('plans/:planId/actions')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  addAction(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.addAction(req.user.tenantId, planId, dto);
  }

  @Patch('actions/:id')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  updateAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.updateAction(req.user.tenantId, id, dto);
  }

  @Post('actions/:id/complete')
  @UseGuards(FeatureGuard)
  @Feature(PlanFeature.PDI)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  completeAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.completeAction(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
    );
  }

  @Delete('actions/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  removeAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.removeAction(req.user.tenantId, id);
  }

  // ─── Comments ──────────────────────────────────────────────────────────

  @Get('plans/:planId/comments')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  listComments(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
  ) {
    return this.developmentService.listComments(req.user.tenantId, planId);
  }

  @Post('plans/:planId/comments')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  createComment(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.createComment(
      req.user.tenantId,
      planId,
      req.user.userId,
      dto,
    );
  }

  @Delete('plans/:planId/comments/:commentId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  deleteComment(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Request() req: any,
  ) {
    return this.developmentService.deleteComment(
      req.user.tenantId,
      commentId,
      req.user.userId,
      req.user.role,
    );
  }

  // ─── Suggestions ───────────────────────────────────────────────────────

  @Get('suggest/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  suggestPlanFromAssessment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.developmentService.suggestPlanFromAssessment(
      req.user.tenantId,
      userId,
      cycleId,
    );
  }
}
