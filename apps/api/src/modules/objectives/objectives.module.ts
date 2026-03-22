import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Objective } from './entities/objective.entity';
import { ObjectiveUpdate } from './entities/objective-update.entity';
import { ObjectivesService } from './objectives.service';
import { ObjectivesController } from './objectives.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Objective, ObjectiveUpdate])],
  controllers: [ObjectivesController],
  providers: [ObjectivesService],
  exports: [ObjectivesService],
})
export class ObjectivesModule {}
