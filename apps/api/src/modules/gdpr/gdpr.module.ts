import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GdprRequest } from './entities/gdpr-request.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { GdprService } from './gdpr.service';
import { GdprController } from './gdpr.controller';
import { GdprExportBuilder } from './export-builder.service';
import { GdprAnonymizerService } from './anonymizer.service';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * GDPR module — bundles export + anonymization + the paired REST endpoints.
 *
 * AuditModule is @Global so AuditService is available via plain DI.
 * NotificationsModule exports EmailService for the three transactional GDPR
 * messages (export-ready, delete-code, delete-confirmed).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([GdprRequest, User, Tenant]),
    NotificationsModule,
  ],
  controllers: [GdprController],
  providers: [GdprService, GdprExportBuilder, GdprAnonymizerService],
})
export class GdprModule {}
