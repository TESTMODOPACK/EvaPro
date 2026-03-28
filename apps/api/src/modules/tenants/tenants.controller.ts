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
