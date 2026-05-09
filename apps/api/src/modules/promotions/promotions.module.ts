import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PositionLevel } from './entities/position-level.entity';
import { CareerPath } from './entities/career-path.entity';
import { PromotionRecommendation } from './entities/promotion-recommendation.entity';
import { PromotionDecision } from './entities/promotion-decision.entity';

import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { CalibrationEntry } from '../talent/entities/calibration-entry.entity';
import { DevelopmentPlan } from '../development/entities/development-plan.entity';
import { DevelopmentAction } from '../development/entities/development-action.entity';
import { Recognition } from '../recognition/entities/recognition.entity';
import { MoodCheckin } from '../mood-checkins/entities/mood-checkin.entity';

import { PromotionScoringEngineService } from './services/promotion-scoring-engine.service';
import { PromotionBiasAnalyzerService } from './services/promotion-bias-analyzer.service';
import { PromotionWorkflowService } from './services/promotion-workflow.service';
import { PromotionsController } from './promotions.controller';

import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      // Entities propias
      PositionLevel, CareerPath, PromotionRecommendation, PromotionDecision,
      // Entities cross-module (lectura)
      User, Tenant, EvaluationCycle, EvaluationAssignment, EvaluationResponse,
      CalibrationEntry, DevelopmentPlan, DevelopmentAction, Recognition, MoodCheckin,
    ]),
    AuditModule,
  ],
  controllers: [PromotionsController],
  providers: [
    PromotionScoringEngineService,
    PromotionBiasAnalyzerService,
    PromotionWorkflowService,
  ],
  exports: [
    PromotionScoringEngineService,
    PromotionBiasAnalyzerService,
    PromotionWorkflowService,
  ],
})
export class PromotionsModule {}
