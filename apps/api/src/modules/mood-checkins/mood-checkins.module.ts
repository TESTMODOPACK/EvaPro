import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MoodCheckin } from './entities/mood-checkin.entity';
import { User } from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { MoodCheckinsService } from './mood-checkins.service';
import { MoodCheckinsController } from './mood-checkins.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([MoodCheckin, User]),
    AuditModule,
    SubscriptionsModule, // requerido por FeatureGuard
  ],
  providers: [MoodCheckinsService],
  controllers: [MoodCheckinsController],
  exports: [MoodCheckinsService],
})
export class MoodCheckinsModule {}
