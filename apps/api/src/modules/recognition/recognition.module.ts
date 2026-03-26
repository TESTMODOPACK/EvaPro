import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Recognition } from './entities/recognition.entity';
import { Badge } from './entities/badge.entity';
import { UserBadge } from './entities/user-badge.entity';
import { UserPoints } from './entities/user-points.entity';
import { User } from '../users/entities/user.entity';
import { RecognitionService } from './recognition.service';
import { RecognitionController } from './recognition.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Recognition, Badge, UserBadge, UserPoints, User]),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [RecognitionController],
  providers: [RecognitionService],
  exports: [RecognitionService],
})
export class RecognitionModule {}
