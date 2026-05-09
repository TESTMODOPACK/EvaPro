import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { AuditService } from '../../audit/audit.service';
import { PromotionRecommendation, ReadinessLevel } from '../entities/promotion-recommendation.entity';
import { PromotionDecision, PromotionDecisionStatus } from '../entities/promotion-decision.entity';

/**
 * PromotionWorkflowService — ADR 0002 §4.
 *
 * Maneja transiciones de estado del workflow de decisión:
 *
 *   pending_review → endorsed (manager)
 *                   ↓
 *                 approved | rejected_by_admin | returned_for_review (admin)
 *                   ↓
 *                 executed (workflow externo)
 *
 * Garantiza que:
 *  - Solo el manager directo del user (o tenant_admin) puede endorsar.
 *  - Solo tenant_admin puede aprobar/rechazar.
 *  - Cada transición queda en audit_log.
 *  - No se puede saltar estados (ej. pending → approved sin endorsed).
 */
@Injectable()
export class PromotionWorkflowService {
  private readonly logger = new Logger(PromotionWorkflowService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(PromotionRecommendation) private readonly recRepo: Repository<PromotionRecommendation>,
    @InjectRepository(PromotionDecision) private readonly decRepo: Repository<PromotionDecision>,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Manager endorsa a un candidato. Valida que el actor sea manager
   * directo del candidato (o tenant_admin/super_admin override).
   */
  async endorse(
    tenantId: string,
    actorId: string,
    actorRole: string,
    candidateUserId: string,
    comment: string | null,
    targetLevelId: string | null,
    ipAddress?: string,
  ): Promise<PromotionDecision> {
    if (!comment || comment.trim().length < 10) {
      throw new BadRequestException('El endorsement requiere un comentario de al menos 10 caracteres');
    }

    const candidate = await this.userRepo.findOne({ where: { id: candidateUserId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    // Solo manager directo o tenant_admin/super_admin pueden endorsar
    const isManagerOfCandidate = candidate.managerId === actorId;
    const isAdmin = actorRole === 'tenant_admin' || actorRole === 'super_admin';
    if (!isManagerOfCandidate && !isAdmin) {
      throw new ForbiddenException('Solo el manager directo o un admin puede endorsar este candidato');
    }

    const recommendation = await this.recRepo.findOne({
      where: { tenantId, userId: candidateUserId },
    });
    if (!recommendation) {
      throw new NotFoundException('No existe recomendación calculada para este user. Espera al próximo cron diario.');
    }
    if (recommendation.readiness === ReadinessLevel.NOT_READY ||
        recommendation.readiness === ReadinessLevel.INSUFFICIENT_DATA) {
      throw new BadRequestException(`Candidato no elegible (readiness=${recommendation.readiness})`);
    }

    // Verificar que no exista ya un endorsement activo (no executed/cancelled/rejected)
    const existing = await this.decRepo.findOne({
      where: { tenantId, userId: candidateUserId, recommendationId: recommendation.id },
      order: { createdAt: 'DESC' },
    });
    if (existing && [
      PromotionDecisionStatus.ENDORSED,
      PromotionDecisionStatus.APPROVED,
      PromotionDecisionStatus.EXECUTED,
    ].includes(existing.status)) {
      throw new ConflictException(`Ya existe una decisión activa con status=${existing.status}`);
    }

    const decision = this.decRepo.create({
      tenantId,
      userId: candidateUserId,
      recommendationId: recommendation.id,
      status: PromotionDecisionStatus.ENDORSED,
      endorsedBy: actorId,
      endorsedAt: new Date(),
      endorsementComment: comment.trim(),
      endorsedTargetLevelId: targetLevelId ?? recommendation.suggestedNextLevelId,
    });
    const saved = await this.decRepo.save(decision);

    this.auditService.log(
      tenantId, actorId, 'promotion.endorsement.created', 'promotion_decision', saved.id,
      {
        candidateUserId,
        recommendationId: recommendation.id,
        targetLevelId: saved.endorsedTargetLevelId,
        readiness: recommendation.readiness,
      },
      ipAddress,
    ).catch(() => {});

    return saved;
  }

  /**
   * tenant_admin aprueba o rechaza un endorsement.
   */
  async decide(
    tenantId: string,
    actorId: string,
    actorRole: string,
    decisionId: string,
    action: 'approve' | 'reject' | 'return',
    comment: string | null,
    approvedTargetLevelId: string | null,
    ipAddress?: string,
  ): Promise<PromotionDecision> {
    if (actorRole !== 'tenant_admin' && actorRole !== 'super_admin') {
      throw new ForbiddenException('Solo tenant_admin puede aprobar/rechazar promociones');
    }

    const decision = await this.decRepo.findOne({ where: { id: decisionId, tenantId } });
    if (!decision) throw new NotFoundException('Decisión no encontrada');
    if (decision.status !== PromotionDecisionStatus.ENDORSED) {
      throw new BadRequestException(
        `Solo se pueden decidir endorsements en status='endorsed' (actual: ${decision.status})`,
      );
    }

    if (!comment || comment.trim().length < 10) {
      throw new BadRequestException('La decisión requiere un comentario de al menos 10 caracteres');
    }

    const newStatus =
      action === 'approve' ? PromotionDecisionStatus.APPROVED :
      action === 'reject' ? PromotionDecisionStatus.REJECTED_BY_ADMIN :
      PromotionDecisionStatus.RETURNED_FOR_REVIEW;

    decision.status = newStatus;
    decision.decidedBy = actorId;
    decision.decidedAt = new Date();
    decision.decisionComment = comment.trim();
    if (action === 'approve') {
      decision.approvedTargetLevelId = approvedTargetLevelId ?? decision.endorsedTargetLevelId;
    }
    const saved = await this.decRepo.save(decision);

    this.auditService.log(
      tenantId, actorId,
      action === 'approve' ? 'promotion.decision.approved'
      : action === 'reject' ? 'promotion.decision.rejected'
      : 'promotion.decision.returned',
      'promotion_decision', saved.id,
      {
        candidateUserId: saved.userId,
        action,
        approvedTargetLevelId: saved.approvedTargetLevelId,
      },
      ipAddress,
    ).catch(() => {});

    return saved;
  }

  /**
   * Manager rechaza el candidato sin endorsar (no recomienda).
   */
  async rejectByManager(
    tenantId: string,
    actorId: string,
    actorRole: string,
    candidateUserId: string,
    comment: string,
    ipAddress?: string,
  ): Promise<PromotionDecision> {
    if (!comment || comment.trim().length < 10) {
      throw new BadRequestException('El rechazo requiere un comentario de al menos 10 caracteres');
    }
    const candidate = await this.userRepo.findOne({ where: { id: candidateUserId, tenantId } });
    if (!candidate) throw new NotFoundException('Candidato no encontrado');

    const isManagerOfCandidate = candidate.managerId === actorId;
    const isAdmin = actorRole === 'tenant_admin' || actorRole === 'super_admin';
    if (!isManagerOfCandidate && !isAdmin) {
      throw new ForbiddenException('Solo el manager directo puede rechazar');
    }

    const rec = await this.recRepo.findOne({ where: { tenantId, userId: candidateUserId } });

    const decision = this.decRepo.create({
      tenantId,
      userId: candidateUserId,
      recommendationId: rec?.id ?? null,
      status: PromotionDecisionStatus.REJECTED_BY_MANAGER,
      endorsedBy: actorId,
      endorsedAt: new Date(),
      endorsementComment: comment.trim(),
    });
    const saved = await this.decRepo.save(decision);

    this.auditService.log(
      tenantId, actorId, 'promotion.rejected_by_manager', 'promotion_decision', saved.id,
      { candidateUserId, comment: comment.trim() },
      ipAddress,
    ).catch(() => {});

    return saved;
  }
}
