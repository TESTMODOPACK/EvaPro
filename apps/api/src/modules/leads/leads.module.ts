import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Lead } from './entities/lead.entity';
import { LeadsService } from './leads.service';
import { LeadsPublicController } from './leads.public.controller';
import { LeadsAdminController } from './leads.admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Módulo de captura y gestión de leads (prospects pre-venta).
 *
 *   - LeadsPublicController  → `POST /public/leads` (sin auth, con CAPTCHA)
 *   - LeadsAdminController   → `GET|PATCH|DELETE /leads/*` (super_admin)
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Lead]),
    NotificationsModule, // provee EmailService
    AuditModule,         // provee AuditService
  ],
  controllers: [LeadsPublicController, LeadsAdminController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
