import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { EvaluationResponse } from '../evaluations/entities/evaluation-response.entity';
import { EvaluationAssignment } from '../evaluations/entities/evaluation-assignment.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { DeiCorrectiveAction } from './entities/dei-corrective-action.entity';
import { DeiService } from './dei.service';
import { DeiController } from './dei.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, EvaluationResponse, EvaluationAssignment, Tenant, DeiCorrectiveAction]),
  ],
  controllers: [DeiController],
  providers: [DeiService],
  exports: [DeiService],
})
export class DeiModule {}
