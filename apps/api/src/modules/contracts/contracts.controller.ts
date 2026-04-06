import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Res, UseGuards, Request, ParseUUIDPipe, HttpCode, HttpStatus,
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

  /** SA gets queries for contracts — must be before :id route */
  @Get('queries/pending')
  @Roles('super_admin')
  getPendingQueries() {
    return this.contractsService.getPendingQueries();
  }

  @Get()
  @Roles('super_admin', 'tenant_admin')
  list(@Request() req: any, @Query('tenantId') filterTenantId?: string) {
    if (req.user.role === 'super_admin') {
      // SA can filter by org or see all
      return filterTenantId
        ? this.contractsService.findByTenant(filterTenantId)
        : this.contractsService.findAll();
    }
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

  @Get(':id/pdf')
  @Roles('super_admin', 'tenant_admin')
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Res() res: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    const pdf = await this.contractsService.generatePdf(id, tenantId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=contrato-${id.slice(0, 8)}.pdf`);
    res.send(pdf);
  }

  @Post(':id/send')
  @Roles('super_admin')
  sendForSignature(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.contractsService.sendForSignature(id, req.user.userId);
  }

  /** Admin sends a query/request about a contract to super_admin */
  @Post(':id/query')
  @Roles('tenant_admin')
  submitQuery(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { type: string; message: string },
  ) {
    return this.contractsService.submitContractQuery(id, req.user.tenantId, req.user.userId, dto);
  }

}
