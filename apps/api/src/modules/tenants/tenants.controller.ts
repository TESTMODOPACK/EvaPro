import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  // En producción, solo Super Admin Ascenda podría crear tenants
  // @UseGuards(JwtAuthGuard, RolesGuard)
  // @Roles('super_admin')
  async create(@Body() createTenantDto: any) {
    return this.tenantsService.create(createTenantDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  async findAll() {
    return this.tenantsService.findAll();
  }
}
