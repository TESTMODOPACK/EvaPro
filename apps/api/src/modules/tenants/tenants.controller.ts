import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Put,
} from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audited } from '../../common/decorators/audited.decorator';

@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /** Returns feedback configuration for any authenticated user */
  @Get('me/feedback-config')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee', 'external')
  async getFeedbackConfig(@Request() req: any) {
    const tenant = await this.tenantsService.findById(req.user.tenantId);
    return tenant?.settings?.feedbackConfig || {};
  }

  /** Returns the current user's own tenant — accessible to tenant_admin */
  @Get('me')
  @Roles('super_admin', 'tenant_admin')
  getMyTenant(@Request() req: any) {
    return this.tenantsService.findById(req.user.tenantId);
  }

  /** Get all custom settings for the current tenant */
  @Get('me/custom-settings')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getAllCustomSettings(@Request() req: any) {
    return this.tenantsService.getAllCustomSettings(req.user.tenantId);
  }

  /** Get a specific custom setting */
  @Get('me/custom-settings/:key')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getCustomSetting(@Request() req: any, @Param('key') key: string) {
    return this.tenantsService.getCustomSetting(req.user.tenantId, key);
  }

  /** Check if a custom setting value is in use */
  @Get('me/custom-settings/:key/check-usage')
  @Roles('super_admin', 'tenant_admin')
  checkSettingUsage(@Request() req: any, @Param('key') key: string, @Query('value') value: string) {
    return this.tenantsService.checkSettingUsage(req.user.tenantId, key, value);
  }

  /** Update a specific custom setting (tenant_admin only) */
  @Put('me/custom-settings/:key')
  @Roles('super_admin', 'tenant_admin')
  setCustomSetting(@Request() req: any, @Param('key') key: string, @Body('values') values: string[]) {
    return this.tenantsService.setCustomSetting(req.user.tenantId, key, values);
  }

  /** Positions catalog — structured objects, not plain strings */
  @Get('me/positions')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getPositionsCatalog(@Request() req: any) {
    return this.tenantsService.getPositionsCatalog(req.user.tenantId);
  }

  @Put('me/positions')
  @Roles('super_admin', 'tenant_admin')
  setPositionsCatalog(@Request() req: any, @Body('positions') positions: { name: string; level: number }[]) {
    return this.tenantsService.setPositionsCatalog(req.user.tenantId, positions);
  }

  @Get('me/positions/all')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getPositionsWithInUse(@Request() req: any) {
    return this.tenantsService.getPositionsWithInUse(req.user.tenantId);
  }

  @Get('me/positions/check-usage')
  @Roles('super_admin', 'tenant_admin')
  checkPositionUsage(@Request() req: any, @Query('name') name: string) {
    return this.tenantsService.checkPositionUsage(req.user.tenantId, name);
  }

  // ─── Onboarding Progress ─────────────────────────────────────────────

  @Get('me/onboarding-progress')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getOnboardingProgress(@Request() req: any) {
    return this.tenantsService.getOnboardingProgress(req.user.tenantId, req.user.userId, req.user.role);
  }

  // ─── Departments Table CRUD ──────────────────────────────────────────

  @Get('me/departments')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getDepartmentsTable(@Request() req: any) {
    return this.tenantsService.getDepartmentsTable(req.user.tenantId);
  }

  @Post('me/departments')
  @Roles('super_admin', 'tenant_admin')
  createDepartmentRecord(@Request() req: any, @Body() dto: { name: string; sortOrder?: number }) {
    return this.tenantsService.createDepartmentRecord(req.user.tenantId, dto);
  }

  @Patch('me/departments/:id')
  @Roles('super_admin', 'tenant_admin')
  updateDepartmentRecord(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { name?: string; sortOrder?: number; isActive?: boolean },
  ) {
    return this.tenantsService.updateDepartmentRecord(req.user.tenantId, id, dto);
  }

  @Delete('me/departments/:id')
  @Roles('super_admin', 'tenant_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteDepartmentRecord(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.deleteDepartmentRecord(req.user.tenantId, id);
  }

  // ─── Positions Table CRUD ──────────────────────────────────────────

  @Get('me/positions-v2')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getPositionsTable(@Request() req: any) {
    return this.tenantsService.getPositionsTable(req.user.tenantId);
  }

  @Post('me/positions-v2')
  @Roles('super_admin', 'tenant_admin')
  createPositionRecord(@Request() req: any, @Body() dto: { name: string; level?: number }) {
    return this.tenantsService.createPositionRecord(req.user.tenantId, dto);
  }

  @Patch('me/positions-v2/:id')
  @Roles('super_admin', 'tenant_admin')
  updatePositionRecord(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { name?: string; level?: number; isActive?: boolean },
  ) {
    return this.tenantsService.updatePositionRecord(req.user.tenantId, id, dto);
  }

  @Delete('me/positions-v2/:id')
  @Roles('super_admin', 'tenant_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deletePositionRecord(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.deletePositionRecord(req.user.tenantId, id);
  }

  /** Update tenant general settings (timezone, sessionTimeout, etc.) */
  @Patch('me/settings')
  @Roles('super_admin', 'tenant_admin')
  updateMySettings(@Request() req: any, @Body() dto: Record<string, any>) {
    return this.tenantsService.updateTenantSettings(req.user.tenantId, dto);
  }

  @Get('system-stats')
  getSystemStats() {
    return this.tenantsService.getSystemStats();
  }

  /** Super admin: get departments for any tenant */
  @Get(':tenantId/departments')
  @Roles('super_admin')
  getDepartmentsForTenant(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenantsService.getDepartmentsTable(tenantId);
  }

  /** Super admin: get positions for any tenant */
  @Get(':tenantId/positions')
  @Roles('super_admin')
  getPositionsForTenant(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.tenantsService.getPositionsTable(tenantId);
  }

  @Get('usage-metrics')
  getUsageMetrics() {
    return this.tenantsService.getUsageMetrics();
  }

  @Get('ai-usage')
  getAiUsage() {
    return this.tenantsService.getAiUsageByTenant();
  }

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.findById(id);
  }

  @Post()
  @Audited('tenant.created', 'tenant')
  create(@Body() dto: any) {
    return this.tenantsService.create(dto);
  }

  /** Bulk onboard a new organization from Excel data */
  @Post('bulk-onboard')
  @Audited('tenant.bulk_onboarded', 'tenant')
  bulkOnboard(@Body() dto: any) {
    return this.tenantsService.bulkOnboard(dto);
  }

  @Patch(':id')
  @Audited('tenant.updated', 'tenant')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Audited('tenant.deactivated', 'tenant')
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantsService.deactivate(id);
  }

  // ─── Support Tickets ──────────────────────────────────────────────

  /** Tenant admin: list own tickets */
  @Get('me/tickets')
  @Roles('super_admin', 'tenant_admin')
  listMyTickets(@Request() req: any) {
    return this.tenantsService.listTickets(req.user.tenantId);
  }

  /** Tenant admin: create ticket */
  @Post('me/tickets')
  @Roles('tenant_admin')
  createTicket(@Request() req: any, @Body() dto: any) {
    return this.tenantsService.createTicket(req.user.tenantId, req.user.userId, dto);
  }

  /** Super admin: list ALL tickets across tenants */
  @Get('tickets/all')
  @Roles('super_admin')
  listAllTickets() {
    return this.tenantsService.listTickets();
  }

  /** Super admin: respond to a ticket */
  @Patch('tickets/:ticketId/respond')
  @Roles('super_admin')
  respondTicket(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: { response: string; status?: string; responseAttachments?: Array<{ url: string; name: string; size?: number }> },
    @Request() req: any,
  ) {
    return this.tenantsService.respondTicket(ticketId, req.user.userId, dto.response, dto.status, dto.responseAttachments);
  }

  /** Super admin: update ticket status */
  @Patch('tickets/:ticketId/status')
  @Roles('super_admin')
  updateTicketStatus(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: { status: string },
  ) {
    return this.tenantsService.updateTicketStatus(ticketId, dto.status);
  }
}
