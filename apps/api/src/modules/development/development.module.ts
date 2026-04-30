import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Competency } from './entities/competency.entity';
import { RoleCompetency } from './entities/role-competency.entity';
import { DevelopmentPlan } from './entities/development-plan.entity';
import { DevelopmentAction } from './entities/development-action.entity';
import { DevelopmentComment } from './entities/development-comment.entity';
import { User } from '../users/entities/user.entity';
import { TalentAssessment } from '../talent/entities/talent-assessment.entity';
import { Position } from '../tenants/entities/position.entity';
import { DevelopmentService } from './development.service';
import { DevelopmentController } from './development.controller';
import { DevelopmentUserTransferredListener } from './listeners/user-transferred.listener';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecognitionModule } from '../recognition/recognition.module';

@Module({
  imports: [
    AuditModule,
    SubscriptionsModule,
    NotificationsModule,
    RecognitionModule,
    TypeOrmModule.forFeature([Competency, RoleCompetency, DevelopmentPlan, DevelopmentAction, DevelopmentComment, User, TalentAssessment, Position]),
  ],
  controllers: [DevelopmentController],
  providers: [
    DevelopmentService,
    // S2.3 — listener async de user.transferred. Notifica al nuevo
    // manager + anterior sobre PDIs activos heredados.
    DevelopmentUserTransferredListener,
  ],
  exports: [DevelopmentService],
})
export class DevelopmentModule {}
