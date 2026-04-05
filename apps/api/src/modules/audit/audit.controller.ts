import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Request,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Super admin: all logs with advanced filters
  @Get()
  @Roles('super_admin')
  findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('action') action?: string,
    @Query('tenantId') tenantId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('entityType') entityType?: string,
    @Query('searchText') searchText?: string,
  ) {
    return this.auditService.findAll(page, limit, { action, tenantId, dateFrom, dateTo, entityType, searchText });
  }

  // Tenant admin (+ super_admin): own organization logs with advanced filters
  @Get('tenant')
  @Roles('super_admin', 'tenant_admin')
  findByTenant(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(25), ParseIntPipe) limit: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('evidenceOnly') evidenceOnly?: string,
    @Query('searchText') searchText?: string,
  ) {
    return this.auditService.findByTenant(req.user.tenantId, {
      page, limit, dateFrom, dateTo, action, entityType,
      evidenceOnly: evidenceOnly === 'true',
      searchText,
    });
  }

  // Export CSV
  @Get('tenant/export')
  @Roles('super_admin', 'tenant_admin')
  async exportCsv(
    @Request() req: any,
    @Res() res: Response,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('evidenceOnly') evidenceOnly?: string,
    @Query('searchText') searchText?: string,
  ) {
    const csv = await this.auditService.exportTenantCsv(req.user.tenantId, {
      dateFrom, dateTo, action, entityType,
      evidenceOnly: evidenceOnly === 'true',
      searchText,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=auditoria_' + new Date().toISOString().slice(0, 10) + '.csv');
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  }
}
