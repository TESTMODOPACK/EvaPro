import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserNote } from './entities/user-note.entity';
import { UserDeparture } from './entities/user-departure.entity';
import { UserMovement } from './entities/user-movement.entity';
import { BulkImport } from './entities/bulk-import.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Department } from '../tenants/entities/department.entity';
import { Position } from '../tenants/entities/position.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditModule } from '../audit/audit.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserNote, UserDeparture, UserMovement, BulkImport, Tenant, Department, Position]),
    AuditModule,
    SubscriptionsModule,
    NotificationsModule,
    UploadsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
