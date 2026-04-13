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

@Controller('recruitment')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.POSTULANTS)
@Roles('super_admin', 'tenant_admin', 'manager')
export class RecruitmentController {
  constructor(private readonly service: RecruitmentService) {}

  // ─── Processes ─────────────────────────────────────────────────────

  @Post('processes')
  @Roles('super_admin', 'tenant_admin')
  createProcess(@Request() req: any, @Body() dto: any) {
    return this.service.createProcess(req.user.tenantId, req.user.userId, dto);
  }

  @Get('processes')
  listProcesses(@Request() req: any, @Query('status') status?: string) {
    return this.service.listProcesses(req.user.tenantId, status);
  }

  @Get('processes/:id')
  getProcess(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getProcess(req.user.tenantId, id);
  }

  @Patch('processes/:id')
  @Roles('super_admin', 'tenant_admin')
  updateProcess(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.service.updateProcess(req.user.tenantId, id, dto);
  }

  // ─── Candidates ───────────────────────────────────────────────────

  @Post('processes/:id/candidates')
  @Roles('super_admin', 'tenant_admin')
  addCandidate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) processId: string,
    @Body() dto: any,
  ) {
    if (dto.userId) {
      return this.service.addInternalCandidate(req.user.tenantId, processId, dto.userId);
    }
    return this.service.addExternalCandidate(req.user.tenantId, processId, dto);
  }

  @Patch('candidates/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateCandidate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.service.updateCandidate(req.user.tenantId, id, dto);
  }

  @Patch('candidates/:id/stage')
  @Roles('super_admin', 'tenant_admin')
  updateStage(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stage') stage: string,
  ) {
    return this.service.updateCandidateStage(req.user.tenantId, id, stage);
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
    return this.service.uploadCv(req.user.tenantId, id, cvUrl);
  }

  @Post('candidates/:id/analyze-cv')
  @Roles('super_admin', 'tenant_admin')
  analyzeCv(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.analyzeCvWithAi(req.user.tenantId, id, req.user.userId);
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
    return this.service.addRecruiterNotes(req.user.tenantId, id, notes);
  }

  // ─── Interviews ───────────────────────────────────────────────────

  @Post('candidates/:id/interview')
  submitInterview(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) candidateId: string,
    @Body() dto: any,
  ) {
    return this.service.submitInterview(req.user.tenantId, req.user.userId, candidateId, dto);
  }

  @Get('candidates/:id/interviews')
  getInterviews(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getInterviews(req.user.tenantId, id);
  }

  // ─── Scorecard ────────────────────────────────────────────────────

  @Get('candidates/:id/scorecard')
  getScorecard(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getScorecard(req.user.tenantId, id);
  }

  @Patch('candidates/:id/adjust-score')
  @Roles('super_admin', 'tenant_admin')
  adjustScore(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { adjustment: number; justification: string },
  ) {
    return this.service.adjustScore(req.user.tenantId, id, dto.adjustment, dto.justification);
  }

  // ─── Comparative (internal processes) ─────────────────────────────

  @Get('processes/:id/comparative')
  getComparative(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getComparative(req.user.tenantId, id);
  }

  @Post('processes/:id/ai-recommendation')
  @Roles('super_admin', 'tenant_admin')
  generateAiRecommendation(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.generateAiRecommendation(req.user.tenantId, id, req.user.userId);
  }

  /** Recalculate all candidate scores (admin fix after formula change) */
  @Post('recalculate-scores')
  @Roles('super_admin', 'tenant_admin')
  recalculateScores(@Request() req: any) {
    return this.service.recalculateAllScores(req.user.tenantId);
  }
}
