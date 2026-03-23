import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Objective } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectiveComment } from './entities/objective-comment.entity';
import { User } from '../users/entities/user.entity';
import { ObjectivesService } from './objectives.service';
import { ObjectivesController } from './objectives.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Objective, ObjectiveUpdate, ObjectiveComment, User])],
  controllers: [ObjectivesController],
  providers: [ObjectivesService],
  exports: [ObjectivesService],
})
export class ObjectivesModule {}
