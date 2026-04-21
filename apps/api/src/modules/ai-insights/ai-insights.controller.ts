import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  Request,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { AiInsightsService } from './ai-insights.service';
import { InsightType } from './entities/ai-insight.entity';
import { User } from '../users/entities/user.entity';
import { assertManagerCanAccessUser } from '../../common/utils/validate-manager-scope';

@Controller('ai')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.AI_INSIGHTS)
export class AiInsightsController {
  constructor(
    private readonly aiService: AiInsightsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * P10 (audit manager) — ahora valida que el manager solo acceda a
   * insights de sus direct reports. Antes solo validaba employee→self,
   * un manager podía leer summaries de cualquier colaborador del tenant.
   *
   * Async para poder consultar target.managerId cuando el caller es manager.
   */
  private async validateAccess(req: any, targetUserId: string) {
    await assertManagerCanAccessUser(
      this.userRepo,
      req.user.userId,
      req.user.role,
      targetUserId,
      req.user.tenantId,
    );
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  @Post('summary/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async generateSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    // P10 audit manager — validar ownership antes de quemar créditos IA.
    await this.validateAccess(req, userId);
    return this.aiService.generateSummary(req.user.tenantId, cycleId, userId, req.user.userId);
  }

  @Get('summary/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async getSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    await this.validateAccess(req, userId);
    return this.aiService.getInsight(req.user.tenantId, InsightType.SUMMARY, cycleId, userId);
  }

  // ─── Bias Detection ────────────────────────────────────────────────────

  @Post('bias/:cycleId')
  @Roles('super_admin', 'tenant_admin')
  analyzeBias(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.aiService.analyzeBias(req.user.tenantId, cycleId, req.user.userId);
  }

  @Get('bias/:cycleId')
  @Roles('super_admin', 'tenant_admin')
  getBias(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.aiService.getInsight(req.user.tenantId, InsightType.BIAS, cycleId);
  }

  // ─── Suggestions ───────────────────────────────────────────────────────

  @Post('suggestions/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async generateSuggestions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    // P10 audit manager — validar ownership antes de quemar créditos IA.
    await this.validateAccess(req, userId);
    return this.aiService.generateSuggestions(req.user.tenantId, cycleId, userId, req.user.userId);
  }

  @Get('suggestions/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async getSuggestions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    await this.validateAccess(req, userId);
    return this.aiService.getInsight(req.user.tenantId, InsightType.SUGGESTIONS, cycleId, userId);
  }

  // ─── Flight Risk Score ─────────────────────────────────────────────────

  /** P7.5 — Manager ve flight-risk solo de su equipo directo + self. */
  @Get('flight-risk')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getFlightRisk(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.aiService.getFlightRiskScores(req.user.tenantId, managerId);
  }

  // ─── F15: Performance Prediction ──────────────────────────────────────

  @Get('prediction/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async getPerformancePrediction(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    await this.validateAccess(req, userId);
    return this.aiService.getPerformancePrediction(req.user.tenantId, userId);
  }

  // ─── F15: Retention Recommendations ──────────────────────────────────

  /**
   * P10 (audit manager) — habilitado para manager con scope a su equipo.
   * Antes solo admin, inconsistente con /ai/flight-risk (P7.5) que ya
   * permite a manager ver riesgo de fuga de sus reports. Retention es
   * la contraparte accionable del flight-risk, debería ir junto.
   *
   * Cuando rol=manager, el service filtra recomendaciones solo de
   * sus direct reports + self.
   */
  @Get('retention')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getRetentionRecommendations(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.aiService.getRetentionRecommendations(req.user.tenantId, managerId);
  }

  // ─── F15: Explainability (XAI) ──────────────────────────────────────

  /** P7.5 — Manager solo puede ver explainability de su equipo directo + self. */
  @Get('explainability/:userId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getExplainability(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.aiService.getExplainability(
      req.user.tenantId, userId, req.user.role, req.user.userId,
    );
  }

  // ─── Usage Quota ──────────────────────────────────────────────────────

  @Get('tenant-usage')
  @Roles('super_admin', 'tenant_admin')
  getTenantUsage(@Request() req: any) {
    return this.aiService.getTenantUsage(req.user.tenantId);
  }

  @Get('usage')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getUsage(@Request() req: any) {
    return this.aiService.getUsageQuota(req.user.tenantId, req.user.userId);
  }

  /** Full AI usage log for audit tab — super_admin can filter by tenantId */
  @Get('usage-log')
  @Roles('super_admin', 'tenant_admin')
  getUsageLog(
    @Request() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('tenantId') filterTenantId?: string,
  ) {
    // super_admin can filter by tenant or see all; tenant_admin sees only their own
    let tenantId = req.user.tenantId;
    if (req.user.role === 'super_admin') {
      // Validate UUID format if provided, otherwise show all
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      tenantId = filterTenantId && uuidRegex.test(filterTenantId) ? filterTenantId : '';
    }
    return this.aiService.getAiUsageLog(tenantId, Number(page) || 1, Math.min(Number(limit) || 25, 100));
  }

  // ─── PDF Export ──────────────────────────────────────────────────────

  @Get('summary-pdf/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async exportSummaryPdf(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    // P10 audit manager — FIX BYPASS CRÍTICO: validateAccess es async
    // (requiere query a users para validar manager→team). Sin await,
    // la Promise quedaba sin esperar y la validación NO ejecutaba.
    // Un manager podía exportar PDFs de cualquier colaborador del tenant.
    await this.validateAccess(req, userId);
    const buffer = await this.aiService.exportSummaryPdf(req.user.tenantId, cycleId, userId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=informe-ia-${userId}.pdf`);
    return res.send(buffer);
  }

  // ─── Cycle Comparison AI ──────────────────────────────────────────────

  /** P6 fix:
   *    - manager recibe análisis IA filtrado a su equipo directo
   *      (antes procesaba toda la organización — fuga de datos agregados).
   *    - super_admin removido del @Roles por consistencia con el endpoint
   *      tabular `GET /reports/analytics/cycle-comparison` que SOLO permite
   *      tenant_admin + manager. Super_admin no tiene "ciclos propios" —
   *      si necesita ver data de un cliente, impersona como tenant_admin
   *      (queda auditado y usa el JWT del tenant correcto en vez del
   *      tenantId residual del super_admin, que causaba data leak silencioso
   *      a Demo Company).
   */
  @Post('cycle-comparison')
  @Roles('tenant_admin', 'manager')
  analyzeCycleComparison(
    @Body() body: { cycleIds: string[] },
    @Request() req: any,
  ) {
    return this.aiService.analyzeCycleComparison(
      req.user.tenantId, body.cycleIds, req.user.userId, req.user.role,
    );
  }

  // ─── Cache Management ─────────────────────────────────────────────────

  @Delete('cache/:cycleId')
  @Roles('super_admin', 'tenant_admin')
  clearCycleCache(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('type') type: string,
    @Query('userId') userId: string,
    @Request() req: any,
  ) {
    const insightType = type === 'bias' ? InsightType.BIAS : type === 'suggestions' ? InsightType.SUGGESTIONS : InsightType.SUMMARY;
    return this.aiService.clearCache(req.user.tenantId, insightType, cycleId, userId || undefined);
  }
}
