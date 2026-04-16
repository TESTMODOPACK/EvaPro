import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { UnsubscribeService } from './unsubscribe.service';
import { UnsubscribeController } from './unsubscribe.controller';

// AuditModule is @Global, so AuditService is already available for injection.

/**
 * Public unsubscribe flow. EmailService does NOT inject this — it mints tokens
 * using the stateless `signToken()` utility directly, which keeps the email
 * path free of circular deps. This module owns the public validation + update
 * endpoints and the audit-logged persistence.
 */
@Module({
  imports: [TypeOrmModule.forFeature([User, Tenant])],
  controllers: [UnsubscribeController],
  providers: [UnsubscribeService],
})
export class UnsubscribeModule {}
