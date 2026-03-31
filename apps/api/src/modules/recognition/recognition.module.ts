import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recognition } from './entities/recognition.entity';
import { Badge } from './entities/badge.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserPoints } from './entities/user-points.entity';
import { PointsBudget } from './entities/points-budget.entity';
import { RedemptionItem } from './entities/redemption-item.entity';
import { RedemptionTransaction } from './entities/redemption-transaction.entity';
import { User } from '../users/entities/user.entity';
import { RecognitionService } from './recognition.service';
import { RecognitionController } from './recognition.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recognition, Badge, UserBadge, UserPoints, PointsBudget, RedemptionItem, RedemptionTransaction, User]),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [RecognitionController],
  providers: [RecognitionService],
  exports: [RecognitionService],
})
export class RecognitionModule {}
