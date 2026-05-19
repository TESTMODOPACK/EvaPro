import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { getClientIp } from '../../common/utils/get-client-ip';
import { User } from '../users/entities/user.entity';

import { PromotionRecommendation, ReadinessLevel } from './entities/promotion-recommendation.entity';
import { PromotionDecision } from './entities/promotion-decision.entity';
import { PromotionScoringEngineService } from './services/promotion-scoring-engine.service';
import { PromotionBiasAnalyzerService } from './services/promotion-bias-analyzer.service';
import { PromotionWorkflowService } from './services/promotion-workflow.service';

@Controller('promotions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PromotionsController {
  constructor(
    @InjectRepository(PromotionRecommendation) private readonly recRepo: Repository<PromotionRecommendation>,
    @InjectRepository(PromotionDecision) private readonly decRepo: Repository<PromotionDecision>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly scoringEngine: PromotionScoringEngineService,
    private readonly biasAnalyzer: PromotionBiasAnalyzerService,
    private readonly workflow: PromotionWorkflowService,
  ) {}

  /**
   * Lista candidatos visibles según el rol:
   *  - manager: solo su equipo descendente
   *  - tenant_admin / super_admin: todo el tenant
   * Filtros: ?readiness=READY_NOW,READY_12M&departmentId=X&q=texto
   */
  @Get('candidates')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async listCandidates(
    @Request() req: any,
    @Query('readiness') readinessCsv?: string,
    @Query('departmentId') departmentId?: string,
    @Query('q') searchQuery?: string,
  ) {
    const tenantId = req.user.tenantId;
    const role = req.user.role;
    const userId = req.user.userId;

    const readinessFilters: ReadinessLevel[] = readinessCsv
      ? (readinessCsv.split(',').filter(Boolean) as ReadinessLevel[])
      : [ReadinessLevel.READY_NOW, ReadinessLevel.READY_12M, ReadinessLevel.DEVELOP_FIRST];

    const qb = this.recRepo
      .createQueryBuilder('r')
      .innerJoin('r.user', 'u')
      .addSelect(['u.id', 'u.firstName', 'u.lastName', 'u.email', 'u.position', 'u.departmentId', 'u.managerId'])
      .where('r.tenantId = :tenantId', { tenantId })
      .andWhere('r.readiness IN (:...readiness)', { readiness: readinessFilters })
      .orderBy('r.compositeScore', 'DESC');

    // RBAC: manager solo ve sus reports descendientes
    if (role === 'manager') {
      const teamUserIds = await this.getDescendantUserIds(tenantId, userId);
      if (teamUserIds.length === 0) return [];
      qb.andWhere('r.userId IN (:...teamIds)', { teamIds: teamUserIds });
    }

    if (departmentId) {
      qb.andWhere('u.departmentId = :deptId', { deptId: departmentId });
    }
    if (searchQuery) {
      qb.andWhere('(LOWER(u.firstName) LIKE :q OR LOWER(u.lastName) LIKE :q)', {
        q: `%${searchQuery.toLowerCase()}%`,
      });
    }

    const results = await qb.limit(200).getMany();
    return results;
  }

  /**
   * Detalle + breakdown completo de un candidato. Manager solo de su
   * equipo, admin de cualquiera.
   */
  @Get('candidates/:userId/explain')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async explainCandidate(
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.tenantId;
    const role = req.user.role;
    const actorId = req.user.userId;

    if (role === 'manager') {
      const teamIds = await this.getDescendantUserIds(tenantId, actorId);
      if (!teamIds.includes(candidateUserId)) {
        throw new BadRequestException('No tienes permiso para ver este candidato');
      }
    }

    const rec = await this.recRepo.findOne({
      where: { tenantId, userId: candidateUserId },
      relations: ['user'],
    });
    if (!rec) {
      throw new BadRequestException('No existe recomendación calculada. Espera al próximo cron.');
    }
    return this.redactSensitiveDimensions(rec);
  }

  /**
   * B4-25 / B4-26: el breakdown que ve el manager/admin no debe exponer:
   *  - dimensions.engagement.moodAvg → es el promedio de mood individual
   *    del colaborador; exponerlo elude el umbral MIN_TEAM_RESPONSES de
   *    mood-checkins (confidencialidad del estado de ánimo).
   *  - dimensions.behavioral.raw cuando evaluatorCount < 3 → el agregado
   *    de feedback 360/peer con 1-2 evaluadores re-identifica al par.
   * El zScore/weight (valores normalizados que alimentan el composite)
   * se conservan; solo se omiten los crudos individuales/de baja N.
   */
  private redactSensitiveDimensions<T extends { dimensions?: any }>(rec: T): T {
    const d = rec?.dimensions;
    if (!d) return rec;
    const BEHAVIORAL_MIN_EVALUATORS = 3;
    const dimensions: any = { ...d };
    if (d.engagement) {
      dimensions.engagement = { ...d.engagement };
      delete dimensions.engagement.moodAvg;
    }
    if (d.behavioral && (d.behavioral.evaluatorCount ?? 0) < BEHAVIORAL_MIN_EVALUATORS) {
      dimensions.behavioral = { ...d.behavioral, suppressed: true };
      delete dimensions.behavioral.raw;
    }
    return { ...rec, dimensions };
  }

  /**
   * Right-to-explanation del empleado (GDPR / AI Act). Solo ve su
   * propio breakdown — sin readiness, sin score numérico, sin ranking.
   */
  @Get('me/explanation')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee', 'external')
  async myExplanation(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.userId;

    const rec = await this.recRepo.findOne({ where: { tenantId, userId } });
    if (!rec) {
      return {
        message: 'Aún no hay análisis disponible para tu perfil.',
        strengths: [],
        opportunities: [],
      };
    }

    // Empleado NO ve readiness, score numérico ni ranking. Solo
    // fortalezas (top 2) y áreas de oportunidad (bottom 1) en
    // lenguaje natural — alineado con ADR §8.bis.
    const dimNames: Record<string, string> = {
      performance: 'Desempeño sostenido',
      potential: 'Potencial calibrado',
      behavioral: 'Feedback de pares',
      growth: 'Mindset de crecimiento',
      recognition: 'Reconocimiento de pares',
      engagement: 'Engagement',
    };

    const dimList = (Object.entries(rec.dimensions) as Array<[string, any]>)
      .map(([k, v]) => ({ key: k, label: dimNames[k] ?? k, z: v.zScore ?? 0 }))
      .sort((a, b) => b.z - a.z);

    return {
      strengths: dimList.slice(0, 2).map((d) => d.label),
      opportunities: dimList.slice(-1).map((d) => d.label),
      message:
        'Esta vista muestra tus fortalezas y áreas de crecimiento basadas en tus evaluaciones. ' +
        'No incluye comparación con colegas ni decisiones de promoción — esas son responsabilidad del manager y RRHH.',
    };
  }

  /**
   * Manager endorsa a un candidato.
   */
  @Post(':userId/endorse')
  @Roles('super_admin', 'tenant_admin', 'manager')
  endorse(
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
    @Body() dto: { comment: string; targetLevelId?: string },
    @Request() req: any,
  ) {
    return this.workflow.endorse(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      candidateUserId,
      dto.comment,
      dto.targetLevelId ?? null,
      getClientIp(req),
    );
  }

  /**
   * Manager rechaza al candidato sin endorsar.
   */
  @Post(':userId/reject')
  @Roles('super_admin', 'tenant_admin', 'manager')
  rejectByManager(
    @Param('userId', ParseUUIDPipe) candidateUserId: string,
    @Body() dto: { comment: string },
    @Request() req: any,
  ) {
    return this.workflow.rejectByManager(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      candidateUserId,
      dto.comment,
      getClientIp(req),
    );
  }

  /**
   * tenant_admin aprueba / rechaza / retorna un endorsement.
   */
  @Post('decisions/:decisionId/decide')
  @Roles('super_admin', 'tenant_admin')
  decide(
    @Param('decisionId', ParseUUIDPipe) decisionId: string,
    @Body() dto: { action: 'approve' | 'reject' | 'return'; comment: string; approvedTargetLevelId?: string },
    @Request() req: any,
  ) {
    if (!['approve', 'reject', 'return'].includes(dto.action)) {
      throw new BadRequestException('action debe ser approve | reject | return');
    }
    return this.workflow.decide(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      decisionId,
      dto.action,
      dto.comment,
      dto.approvedTargetLevelId ?? null,
      getClientIp(req),
    );
  }

  /**
   * Listado de decisiones pendientes (RRHH).
   */
  @Get('decisions/pending')
  @Roles('super_admin', 'tenant_admin')
  async pendingDecisions(@Request() req: any) {
    return this.decRepo.find({
      where: { tenantId: req.user.tenantId, status: 'endorsed' as any },
      relations: ['user', 'endorser'],
      order: { endorsedAt: 'ASC' },
      take: 200,
    });
  }

  /**
   * Reporte de bias (disparate impact) — solo admins.
   */
  @Get('bias-report')
  @Roles('super_admin', 'tenant_admin')
  async biasReport(@Request() req: any) {
    return this.biasAnalyzer.analyzeBatch(req.user.tenantId);
  }

  /**
   * Trigger manual de cálculo para un user (debug / on-demand).
   * Solo admin para evitar abuse.
   */
  @Post('candidates/:userId/recalculate')
  @Roles('super_admin', 'tenant_admin')
  async recalculate(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    const result = await this.scoringEngine.calculateScoreForUser(req.user.tenantId, userId);
    // Upsert en la tabla. `result` no incluye tenantId/userId, los agregamos.
    await this.recRepo.upsert(
      {
        tenantId: req.user.tenantId,
        userId,
        readiness: result.readiness,
        compositeScore: result.compositeScore as any,
        confidence: result.confidence,
        dimensions: result.dimensions,
        filters: result.filters,
        cohortInfo: result.cohortInfo,
        algorithmVersion: result.algorithmVersion,
        policySnapshot: result.policySnapshot,
        currentLevelId: result.currentLevelId,
        suggestedNextLevelId: result.suggestedNextLevelId,
        explanation: result.explanation,
        computedAt: new Date(),
      },
      ['tenantId', 'userId'],
    );
    return result;
  }

  // ─── HELPERS ────────────────────────────────────────────────────

  /**
   * Devuelve los IDs de TODOS los descendientes (directos + indirectos)
   * de un manager. BFS sobre user.managerId.
   */
  private async getDescendantUserIds(tenantId: string, managerId: string): Promise<string[]> {
    const result: string[] = [];
    const queue: string[] = [managerId];
    const visited = new Set<string>([managerId]);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const directs = await this.userRepo.find({
        where: { tenantId, managerId: currentId, isActive: true },
        select: ['id'],
      });
      for (const d of directs) {
        if (!visited.has(d.id)) {
          visited.add(d.id);
          result.push(d.id);
          queue.push(d.id);
        }
      }
    }
    return result;
  }
}
