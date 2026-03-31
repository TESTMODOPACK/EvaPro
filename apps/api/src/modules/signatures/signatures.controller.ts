import {
  Controller, Get, Post, Body, Param, UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SignaturesService } from './signatures.service';

@Controller('signatures')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  /** Request OTP to sign a document */
  @Post('request')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  requestSignature(
    @Request() req: any,
    @Body() dto: { documentType: string; documentId: string },
  ) {
    return this.signaturesService.requestSignature(
      req.user.tenantId, req.user.userId, dto.documentType, dto.documentId,
    );
  }

  /** Verify OTP and sign the document */
  @Post('verify')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  verifyAndSign(
    @Request() req: any,
    @Body() dto: { documentType: string; documentId: string; code: string },
  ) {
    const ip = req.headers?.['x-forwarded-for'] || req.ip || req.connection?.remoteAddress;
    return this.signaturesService.verifyAndSign(
      req.user.tenantId, req.user.userId, dto.documentType, dto.documentId, dto.code,
      typeof ip === 'string' ? ip : ip?.[0],
    );
  }

  /** List all signatures for the tenant (admin) */
  @Get()
  @Roles('super_admin', 'tenant_admin')
  listAll(@Request() req: any) {
    return this.signaturesService.getSignaturesByTenant(req.user.tenantId);
  }

  /** Verify integrity of a signature (MUST be before :documentType/:documentId) */
  @Get('verify/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  verifyIntegrity(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.signaturesService.verifyIntegrity(req.user.tenantId, id);
  }

  /** List signatures for a document */
  @Get('document/:documentType/:documentId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getSignatures(
    @Param('documentType') documentType: string,
    @Param('documentId', ParseUUIDPipe) documentId: string,
    @Request() req: any,
  ) {
    return this.signaturesService.getSignatures(req.user.tenantId, documentType, documentId);
  }
}
