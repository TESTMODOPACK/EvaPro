import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Objective } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { KeyResult } from './entities/key-result.entity';
import { User } from '../users/entities/user.entity';
import { ObjectivesService } from './objectives.service';
import { ObjectivesController } from './objectives.controller';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [
    SubscriptionsModule,
    TypeOrmModule.forFeature([Objective, ObjectiveUpdate, ObjectiveComment, KeyResult, User]),
  ],
  controllers: [ObjectivesController],
  providers: [ObjectivesService],
  exports: [ObjectivesService],
})
export class ObjectivesModule {}
