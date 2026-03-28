import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  Query,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgDevelopmentService } from './org-development.service';

@Controller('org-development')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class OrgDevelopmentController {
  constructor(private readonly service: OrgDevelopmentService) {}

  // ─── Planes ──────────────────────────────────────────────────────────────

  @Get('plans')
  // BUG #5 fix: managers también necesitan ver la lista de planes para luego ver sus iniciativas
  @Roles('tenant_admin', 'manager')
  findAllPlans(@Request() req: any) {
    return this.service.findAllPlans(req.user.tenantId);
  }

  @Post('plans')
  @Roles('tenant_admin')
  createPlan(@Request() req: any, @Body() dto: any) {
    return this.service.createPlan(req.user.tenantId, req.user.userId, dto);
  }

  @Patch('plans/:id')
  @Roles('tenant_admin')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.updatePlan(req.user.tenantId, id, dto);
  }

  @Delete('plans/:id')
  @Roles('tenant_admin')
  deletePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.service.deletePlan(req.user.tenantId, id);
  }

  // ─── Iniciativas ─────────────────────────────────────────────────────────

  @Get('plans/:planId/initiatives')
  @Roles('tenant_admin', 'manager')
  findInitiativesByPlan(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
  ) {
    return this.service.findInitiativesByPlan(req.user.tenantId, planId);
  }

  @Post('plans/:planId/initiatives')
  @Roles('tenant_admin')
  createInitiative(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.createInitiative(req.user.tenantId, planId, dto);
  }

  @Patch('initiatives/:id')
  @Roles('tenant_admin')
  updateInitiative(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.updateInitiative(req.user.tenantId, id, dto);
  }

  @Delete('initiatives/:id')
  @Roles('tenant_admin')
  deleteInitiative(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.service.deleteInitiative(req.user.tenantId, id);
  }

  // ─── Acciones de iniciativa ───────────────────────────────────────────────

  @Post('initiatives/:id/actions')
  @Roles('tenant_admin')
  addAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.addAction(req.user.tenantId, id, dto);
  }

  @Patch('actions/:id')
  @Roles('tenant_admin')
  updateAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.updateAction(req.user.tenantId, id, dto);
  }

  @Delete('actions/:id')
  @Roles('tenant_admin')
  deleteAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.service.deleteAction(req.user.tenantId, id);
  }

  // ─── Trazabilidad y dropdown PDI ─────────────────────────────────────────

  @Get('active-initiatives')
  @Roles('tenant_admin', 'manager', 'employee')
  getActiveInitiatives(
    @Request() req: any,
    @Query('dept') dept?: string,
  ) {
    // BUG #4 fix: `department` NO está en el JWT payload.
    // Para admins se usa el parámetro ?dept opcional.
    // Para manager/employee se pasa userId y el servicio busca el departamento en BD.
    if (req.user.role === 'tenant_admin') {
      return this.service.findActiveInitiatives(req.user.tenantId, { department: dept });
    }
    return this.service.findActiveInitiatives(req.user.tenantId, { userId: req.user.userId });
  }

  @Get('initiatives/:id/pdis')
  @Roles('tenant_admin', 'manager')
  getLinkedPdis(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.service.getLinkedPdis(req.user.tenantId, id);
  }
}
