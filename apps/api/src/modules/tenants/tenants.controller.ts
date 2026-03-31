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

@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

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

  @Get('usage-metrics')
  getUsageMetrics() {
    return this.tenantsService.getUsageMetrics();
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
  create(@Body() dto: any) {
    return this.tenantsService.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
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
    @Body() dto: { response: string; status?: string },
    @Request() req: any,
  ) {
    return this.tenantsService.respondTicket(ticketId, req.user.userId, dto.response, dto.status);
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
