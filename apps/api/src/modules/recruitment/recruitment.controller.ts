import {
  Controller, Post, Get, Patch, Body, Param, Query,
  ParseUUIDPipe, UseGuards, Request, BadRequestException,
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
    return this.service.updateProcess(tenantId, id, dto, req.user.userId);
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
      return this.service.addInternalCandidate(tenantId, processId, dto.userId, req.user.userId);
    }
    return this.service.addExternalCandidate(tenantId, processId, dto, req.user.userId);
  }

  @Patch('candidates/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateCandidate(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateCandidate(tenantId, id, dto, req.user.userId);
  }

  @Patch('candidates/:id/stage')
  @Roles('super_admin', 'tenant_admin')
  updateStage(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('stage') stage: string,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateCandidateStage(tenantId, id, stage, req.user.userId);
  }

  /**
   * S1.2 Sprint 1 — Hire Candidate.
   *
   * Cierra el flow de seleccion: marca candidato como contratado +
   * proceso como completado + cascada hacia users (interno → update +
   * user_movement, externo → create + user_movement de ingreso).
   *
   * Solo admin puede ejecutar el hire (manager no, por jerarquia y
   * compliance — el contrato/movimiento es decision corporativa).
   *
   * Body esperado:
   *   {
   *     effectiveDate: 'YYYY-MM-DD',
   *     newDepartmentId?: uuid,
   *     newPositionId?: uuid,
   *     newManagerId?: uuid,
   *     salary?: number,
   *     contractType?: 'indefinido'|'plazo_fijo'|'honorarios'|'practicante',
   *     notes?: string
   *   }
   *
   * Retorna `tempPassword` SOLO para externos (es la unica oportunidad
   * de ver el password en clear-text — el frontend debe mostrarlo en el
   * modal de exito y permitir copiarlo). Para internos retorna null.
   */
  @Post('processes/:processId/hire/:candidateId')
  @Roles('super_admin', 'tenant_admin')
  hireCandidate(
    @Request() req: any,
    @Param('processId', ParseUUIDPipe) processId: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
    @Body() dto: any,
  ) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.service.hireCandidate(tenantId, processId, candidateId, dto, req.user.userId);
  }

  /**
   * S3.x — Revertir contratación. Operacion opuesta a hireCandidate:
   * - candidato HIRED → APPROVED
   * - proceso COMPLETED → ACTIVE + limpia winningCandidateId/hireData
   * - otros candidatos NOT_HIRED → APPROVED
   * - cascada user (si interno): restaura dept/cargo/manager + borra
   *   el user_movement creado por el hire
   *
   * Solo admin. Requiere candidato en stage='hired'.
   */
  @Post('candidates/:candidateId/revert-hire')
  @Roles('super_admin', 'tenant_admin')
  revertHire(
    @Request() req: any,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    if (!tenantId) {
      throw new BadRequestException('super_admin debe operar dentro de un tenant especifico para revertir una contratacion.');
    }
    return this.service.revertHire(tenantId, candidateId, req.user.userId);
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
    return this.service.uploadCv(tenantId, id, cvUrl, req.user.userId);
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
    return this.service.addRecruiterNotes(tenantId, id, notes, req.user.userId);
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
    return this.service.adjustScore(tenantId, id, dto.adjustment, dto.justification, req.user.userId);
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
