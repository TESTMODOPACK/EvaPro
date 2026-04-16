import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Objective } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { KeyResult } from './entities/key-result.entity';
import { User } from '../users/entities/user.entity';
import { EvaluationCycle } from '../evaluations/entities/evaluation-cycle.entity';
import { ObjectivesService } from './objectives.service';
import { ObjectivesController } from './objectives.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecognitionModule } from '../recognition/recognition.module';

@Module({
  imports: [
    AuditModule,
    SubscriptionsModule,
    NotificationsModule,
    RecognitionModule,
    TypeOrmModule.forFeature([Objective, ObjectiveUpdate, ObjectiveComment, KeyResult, User, EvaluationCycle]),
  ],
  controllers: [ObjectivesController],
  providers: [ObjectivesService],
  exports: [ObjectivesService],
})
export class ObjectivesModule {}
