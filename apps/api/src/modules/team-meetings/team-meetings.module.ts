import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamMeeting } from './entities/team-meeting.entity';
import { TeamMeetingParticipant } from './entities/team-meeting-participant.entity';
import { User } from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
// SubscriptionsModule es requerido por FeatureGuard (que usa
// SubscriptionsService para chequear PlanFeature en el decorator
// @Feature del controller). Sin este import, NestJS falla al arrancar
// con "Nest can't resolve dependencies of FeatureGuard (?, Reflector,
// SubscriptionsService)".
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamMeetingsService } from './team-meetings.service';
import { TeamMeetingsController } from './team-meetings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TeamMeeting, TeamMeetingParticipant, User]),
    AuditModule,
    SubscriptionsModule,
  ],
  providers: [TeamMeetingsService],
  controllers: [TeamMeetingsController],
  exports: [TeamMeetingsService],
})
export class TeamMeetingsModule {}
