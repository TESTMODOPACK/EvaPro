import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  // B2-15: AuditModule expone AuditService que el service usa para
  // dejar trazabilidad de cada upload (uploaderUserId, tenant, archivo).
  imports: [AuditModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
