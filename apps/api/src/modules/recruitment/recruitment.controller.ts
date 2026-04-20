import {
  Controller, Post, Get, Patch, Body, Param, Query,
  ParseUUIDPipe, UseGuards, Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RecruitmentService } from './recruitment.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('recruitment')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.POSTULANTS)
@Roles('super_admin', 'tenant_admin', 'manager')
export class RecruitmentController {
  constructor(private readonly service: RecruitmentService) {}

  // ─── Processes ─────────────────────────────────────────────────────

  /** P2.6 — Cross-tenant defense (recruitment process create). */
  @Post('processes')
  @Roles('super_admin', 'tenant_admin')
  createProcess(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.service.createProcess(tenantId, req.user.userId, dto);
  }

  @Get('processes')
  listProcesses(@Request() req: any, @Query('status') status?: string) {
    return this.service.listProcesses(req.user.tenantId, status);
  }

  @Get('processes/:id')
  getProcess(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getProcess(req.user.tenantId, id);
  }

  /** P5.5 — Secondary cross-tenant: super_admin → undefined. */
  @Patch('processes/:id')
  @Roles('super_admin', 'tenant_admin')
  updateProcess(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateProcess(tenantId, id, dto);
  }

  // ─── Candidates ───────────────────────────────────────────────────

  @Post('processes/:id/candidates')
  @Roles('super_admin', 'tenant_admin')
  addCandidate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) processId: string,
    @Body() dto: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    if (dto.userId) {
      return this.service.addInternalCandidate(tenantId, processId, dto.userId);
    }
    return this.service.addExternalCandidate(tenantId, processId, dto);
  }

  @Patch('candidates/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateCandidate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateCandidate(tenantId, id, dto);
  }

  @Patch('candidates/:id/stage')
  @Roles('super_admin', 'tenant_admin')
  updateStage(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stage') stage: string,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateCandidateStage(tenantId, id, stage);
  }

  @Get('candidates/:id/profile')
  getCandidateProfile(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getCandidateProfile(req.user.tenantId, id);
  }

  // ─── CV & AI ──────────────────────────────────────────────────────

  @Patch('candidates/:id/cv')
  @Roles('super_admin', 'tenant_admin')
  uploadCv(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('cvUrl') cvUrl: string,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.uploadCv(tenantId, id, cvUrl);
  }

  @Post('candidates/:id/analyze-cv')
  @Roles('super_admin', 'tenant_admin')
  analyzeCv(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.analyzeCvWithAi(tenantId, id, req.user.userId);
  }

  @Get('candidates/:id/cv-analysis')
  getCvAnalysis(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getCvAnalysis(req.user.tenantId, id);
  }

  @Patch('candidates/:id/notes')
  @Roles('super_admin', 'tenant_admin')
  addNotes(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('notes') notes: string,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.addRecruiterNotes(tenantId, id, notes);
  }

  // ─── Interviews ───────────────────────────────────────────────────

  @Post('candidates/:id/interview')
  submitInterview(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) candidateId: string,
    @Body() dto: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.submitInterview(tenantId, req.user.userId, candidateId, dto);
  }

  @Get('candidates/:id/interviews')
  getInterviews(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getInterviews(req.user.tenantId, id);
  }

  // ─── Scorecard ────────────────────────────────────────────────────

  /** P7 — Manager solo ve scorecard de candidatos donde él participó
   *  como evaluador (submitInterview). Admin ve todos. */
  @Get('candidates/:id/scorecard')
  getScorecard(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const managerCheckUserId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.service.getScorecard(req.user.tenantId, id, managerCheckUserId);
  }

  @Patch('candidates/:id/adjust-score')
  @Roles('super_admin', 'tenant_admin')
  adjustScore(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { adjustment: number; justification: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.adjustScore(tenantId, id, dto.adjustment, dto.justification);
  }

  // ─── Comparative (internal processes) ─────────────────────────────

  /** P7 — Manager solo ve comparativa si participó como evaluador en
   *  alguno de los candidatos del proceso. Admin ve todo. */
  @Get('processes/:id/comparative')
  getComparative(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const managerCheckUserId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.service.getComparative(req.user.tenantId, id, managerCheckUserId);
  }

  @Post('processes/:id/ai-recommendation')
  @Roles('super_admin', 'tenant_admin')
  generateAiRecommendation(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.generateAiRecommendation(tenantId, id, req.user.userId);
  }

  /** Recalculate all candidate scores (admin fix after formula change) */
  @Post('recalculate-scores')
  @Roles('super_admin', 'tenant_admin')
  recalculateScores(@Request() req: any) {
    return this.service.recalculateAllScores(req.user.tenantId);
  }
}
