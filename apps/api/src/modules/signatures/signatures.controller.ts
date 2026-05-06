import {
  Controller, Get, Post, Body, Param, UseGuards, Request, ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SignaturesService } from './signatures.service';
import { getClientIp } from '../../common/utils/get-client-ip';

@Controller('signatures')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  /** Request OTP to sign a document */
  @Post('request')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee', 'external')
  requestSignature(
    @Request() req: any,
    @Body() dto: {
      documentType: string;
      documentId: string;
      // G2 (TAREA 5): rol de firma. Default = 'recipient'. 'author' para
      // manager/external que firma su feedback emitido. 'employer_witness'
      // solo tenant_admin (TAREA 6).
      signatureRole?: 'recipient' | 'author' | 'employer_witness';
    },
  ) {
    return this.signaturesService.requestSignature(
      req.user.tenantId, req.user.userId, req.user.role,
      dto.documentType, dto.documentId,
      dto.signatureRole ? { signatureRole: dto.signatureRole as any } : undefined,
    );
  }

  /** Verify OTP and sign the document */
  @Post('verify')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee', 'external')
  verifyAndSign(
    @Request() req: any,
    @Body() dto: {
      documentType: string;
      documentId: string;
      code: string;
      acknowledgmentType?: 'agree' | 'agree_with_comments' | 'decline';
      acknowledgmentComment?: string;
      signatureRole?: 'recipient' | 'author' | 'employer_witness';
    },
  ) {
    return this.signaturesService.verifyAndSign(
      req.user.tenantId, req.user.userId, req.user.role,
      dto.documentType, dto.documentId, dto.code,
      getClientIp(req),
      dto.acknowledgmentType
        ? { type: dto.acknowledgmentType as any, comment: dto.acknowledgmentComment }
        : undefined,
      dto.signatureRole ? { signatureRole: dto.signatureRole as any } : undefined,
    );
  }

  /** List my own signatures (all roles, including external) */
  @Get('mine')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee', 'external')
  listMine(@Request() req: any) {
    return this.signaturesService.getSignaturesByUser(req.user.tenantId, req.user.userId);
  }

  /** List signatures of my team's members (manager only) */
  @Get('team')
  @Roles('super_admin', 'tenant_admin', 'manager')
  listTeam(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.signaturesService.getSignaturesByTeam(req.user.tenantId, managerId);
  }

  /** Verify integrity of a signature (specific routes MUST be before generic GET /) */
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

  /** List all signatures for the tenant (admin) — generic route MUST be last */
  @Get()
  @Roles('super_admin', 'tenant_admin')
  listAll(@Request() req: any) {
    return this.signaturesService.getSignaturesByTenant(req.user.tenantId);
  }

  /**
   * G8 (TAREA 9) — Revocación de firma. Solo super_admin.
   * Body: { reason: string } con min 20 chars.
   * La firma queda preservada en DB con status='revoked' + metadata
   * (revokedAt, revokedBy, revocationReason) para auditoría legal.
   */
  @Post(':id/revoke')
  @Roles('super_admin')
  revokeSignature(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { reason: string },
    @Request() req: any,
  ) {
    return this.signaturesService.revokeSignature(
      req.user.tenantId, req.user.userId, req.user.role,
      id, dto?.reason, getClientIp(req),
    );
  }
}
