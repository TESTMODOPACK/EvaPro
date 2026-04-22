import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeamMeeting } from './entities/team-meeting.entity';
import { TeamMeetingParticipant } from './entities/team-meeting-participant.entity';
import { User } from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';
import { TeamMeetingsService } from './team-meetings.service';
import { TeamMeetingsController } from './team-meetings.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([TeamMeeting, TeamMeetingParticipant, User]),
    AuditModule,
  ],
  providers: [TeamMeetingsService],
  controllers: [TeamMeetingsController],
  exports: [TeamMeetingsService],
})
export class TeamMeetingsModule {}
