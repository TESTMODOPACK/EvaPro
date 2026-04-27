import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { GdprService } from './gdpr.service';
import { DeleteConfirmDto } from './dto/delete-confirm.dto';
import { ExportTenantDto } from './dto/export-tenant.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NoImpersonation } from '../../common/decorators/no-impersonation.decorator';

// P1.3: getClientIp centralizado (ver auth.controller).
import { getClientIp } from '../../common/utils/get-client-ip';

@Controller('gdpr')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class GdprController {
  constructor(private readonly svc: GdprService) {}

  /**
   * POST /gdpr/export-my-data
   *
   * Any authenticated user can request an export of their own data. Returns
   * immediately even though v1 runs the build synchronously — so the UI can
   * show a "processing" state. Email with link is sent when done.
   */
  @Post('export-my-data')
  @NoImpersonation()
  @HttpCode(HttpStatus.OK)
  async exportMyData(@Req() req: any) {
    const userId = req.user.userId || req.user.id;
    const tenantId = req.user.tenantId ?? null;
    return this.svc.exportMyData(userId, tenantId, getClientIp(req));
  }

  /**
   * POST /gdpr/delete-my-account
   *
   * Step 1 of the 2-step deletion. Emits a 6-digit code via email; the user
   * must then POST /gdpr/delete-my-account/confirm within 30 minutes.
   *
   * Restringido a super_admin y external (Opción B):
   * Empleados de tenants (employee/manager/tenant_admin) NO pueden auto-
   * eliminarse — el employer es el cliente B2B y necesita procesar
   * offboarding via su tenant_admin / RRHH. Esto cumple GDPR/Ley 19.628
   * (el derecho sigue existiendo) pero canaliza el ejercicio por el flujo
   * apropiado (RRHH solicita por email al DPO; el tenant_admin gatilla).
   * Externos (consultores, evaluadores invitados sin contrato laboral) y
   * super_admin (sin tenantId) sí pueden auto-eliminarse directamente.
   */
  @Post('delete-my-account')
  @NoImpersonation()
  @Roles('super_admin', 'external')
  @HttpCode(HttpStatus.OK)
  async requestDelete(@Req() req: any) {
    const userId = req.user.userId || req.user.id;
    const tenantId = req.user.tenantId ?? null;
    return this.svc.requestAccountDeletion(userId, tenantId, getClientIp(req));
  }

  /**
   * POST /gdpr/delete-my-account/confirm
   *
   * Step 2 of the 2-step deletion. Validates the 6-digit code, runs the
   * anonymization cascade, bumps tokenVersion so the current JWT is invalid,
   * and sends a final confirmation email. The client should call auth logout
   * right after receiving 200.
   *
   * Mismo @Roles que /delete-my-account — defense-in-depth.
   */
  @Post('delete-my-account/confirm')
  @NoImpersonation()
  @Roles('super_admin', 'external')
  @HttpCode(HttpStatus.OK)
  async confirmDelete(@Req() req: any, @Body() dto: DeleteConfirmDto) {
    const userId = req.user.userId || req.user.id;
    const tenantId = req.user.tenantId ?? null;
    return this.svc.confirmAccountDeletion(userId, tenantId, dto.requestId, dto.code, getClientIp(req));
  }

  /**
   * POST /gdpr/export-tenant-data?anonymize=true
   *
   * Tenant_admin only. Exports organization-wide data. `anonymize=true`
   * replaces names/emails/RUTs with pseudonyms so the export can be shared
   * externally without leaking PII.
   */
  @Post('export-tenant-data')
  @Roles('tenant_admin')
  @HttpCode(HttpStatus.OK)
  async exportTenantData(@Req() req: any, @Query() query: ExportTenantDto) {
    const adminUserId = req.user.userId || req.user.id;
    const tenantId = req.user.tenantId;
    if (!tenantId) {
      // super_admin without a tenant context shouldn't land here.
      return { error: 'tenant_admin debe estar asociado a un tenant' };
    }
    return this.svc.exportTenantData(adminUserId, tenantId, Boolean(query.anonymize), getClientIp(req));
  }

  /**
   * GET /gdpr/my-requests
   *
   * Returns the caller's own GDPR requests from the last 30 days. Used by
   * the /perfil card to show status ("processing", "completed"),
   * download link when available, and expiry. Expired links are redacted.
   */
  @Get('my-requests')
  async myRequests(@Req() req: any) {
    const userId = req.user.userId || req.user.id;
    return this.svc.listMyRequests(userId);
  }

  /**
   * GET /gdpr/tenant-requests
   *
   * Tenant_admin view of all requests in the tenant (last 90 days) — used
   * for HR audit. Does NOT expose individual download links for privacy.
   */
  @Get('tenant-requests')
  @Roles('tenant_admin')
  async tenantRequests(@Req() req: any) {
    const tenantId = req.user.tenantId;
    if (!tenantId) return [];
    return this.svc.listTenantRequests(tenantId);
  }
}
