import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CheckIn } from '../feedback/entities/checkin.entity';
import { QuickFeedback } from '../feedback/entities/quick-feedback.entity';
import { Recognition } from '../recognition/entities/recognition.entity';
import { User } from '../users/entities/user.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { LeaderStreaksService } from './leader-streaks.service';
import { LeaderStreaksController } from './leader-streaks.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([CheckIn, QuickFeedback, Recognition, User]),
    SubscriptionsModule, // FeatureGuard dep
  ],
  providers: [LeaderStreaksService],
  controllers: [LeaderStreaksController],
  exports: [LeaderStreaksService],
})
export class LeaderStreaksModule {}
