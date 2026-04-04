import {
  Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ContractsService } from './contracts.service';

@Controller('contracts')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get('types')
  getContractTypes() {
    return this.contractsService.getContractTypes();
  }

  @Get('templates')
  @Roles('super_admin')
  getDefaultTemplates() {
    return this.contractsService.getDefaultTemplates();
  }

  @Get()
  @Roles('super_admin', 'tenant_admin')
  list(@Request() req: any) {
    if (req.user.role === 'super_admin') return this.contractsService.findAll();
    return this.contractsService.findByTenant(req.user.tenantId);
  }

  @Get(':id')
  @Roles('super_admin', 'tenant_admin')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.contractsService.findById(id, tenantId);
  }

  @Post()
  @Roles('super_admin')
  create(@Request() req: any, @Body() dto: any) {
    return this.contractsService.create(dto, req.user.userId);
  }

  @Post('bulk-create/:tenantId')
  @Roles('super_admin')
  createAllBase(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Request() req: any) {
    return this.contractsService.createAllBaseContracts(tenantId, req.user.userId);
  }

  @Patch(':id')
  @Roles('super_admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() dto: any) {
    return this.contractsService.update(id, dto, req.user.userId);
  }

  @Delete(':id')
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.contractsService.remove(id, req.user.userId);
  }

  @Post(':id/send')
  @Roles('super_admin')
  sendForSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.contractsService.sendForSignature(id, req.user.userId);
  }
}
