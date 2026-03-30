import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
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
}
