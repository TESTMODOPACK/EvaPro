import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DevelopmentService } from './development.service';

@Controller('development')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class DevelopmentController {
  constructor(private readonly developmentService: DevelopmentService) {}

  // ─── Competencies ──────────────────────────────────────────────────────

  @Get('competencies')
  @Roles('super_admin', 'tenant_admin')
  findAllCompetencies(@Request() req: any) {
    return this.developmentService.findAllCompetencies(req.user.tenantId);
  }

  @Post('competencies')
  @Roles('super_admin', 'tenant_admin')
  createCompetency(@Request() req: any, @Body() dto: any) {
    return this.developmentService.createCompetency(req.user.tenantId, dto);
  }

  @Patch('competencies/:id')
  @Roles('super_admin', 'tenant_admin')
  updateCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.updateCompetency(req.user.tenantId, id, dto);
  }

  @Delete('competencies/:id')
  @Roles('super_admin', 'tenant_admin')
  deactivateCompetency(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.deactivateCompetency(req.user.tenantId, id);
  }

  // ─── Plans ─────────────────────────────────────────────────────────────

  @Get('plans')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findPlans(@Request() req: any) {
    const { tenantId, userId, role } = req.user;
    if (role === 'tenant_admin' || role === 'super_admin') {
      return this.developmentService.findAllPlans(tenantId);
    }
    if (role === 'manager') {
      return this.developmentService.findPlansByManager(tenantId, userId);
    }
    return this.developmentService.findPlansByUser(tenantId, userId);
  }

  @Get('plans/:id')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findPlanById(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.findPlanById(req.user.tenantId, id);
  }

  @Post('plans')
  @Roles('super_admin', 'tenant_admin', 'manager')
  createPlan(@Request() req: any, @Body() dto: any) {
    return this.developmentService.createPlan(req.user.tenantId, req.user.userId, dto);
  }

  @Patch('plans/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.updatePlan(req.user.tenantId, id, dto);
  }

  @Post('plans/:id/activate')
  @Roles('super_admin', 'tenant_admin', 'manager')
  activatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.activatePlan(req.user.tenantId, id);
  }

  @Post('plans/:id/complete')
  @Roles('super_admin', 'tenant_admin', 'manager')
  completePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.completePlan(req.user.tenantId, id);
  }

  // ─── Actions ───────────────────────────────────────────────────────────

  @Post('plans/:planId/actions')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  addAction(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.addAction(req.user.tenantId, planId, dto);
  }

  @Patch('actions/:id')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  updateAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.updateAction(req.user.tenantId, id, dto);
  }

  @Post('actions/:id/complete')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  completeAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.completeAction(req.user.tenantId, id);
  }

  @Delete('actions/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  removeAction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.developmentService.removeAction(req.user.tenantId, id);
  }

  // ─── Comments ──────────────────────────────────────────────────────────

  @Get('plans/:planId/comments')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  listComments(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
  ) {
    return this.developmentService.listComments(req.user.tenantId, planId);
  }

  @Post('plans/:planId/comments')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  createComment(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.developmentService.createComment(
      req.user.tenantId,
      planId,
      req.user.userId,
      dto,
    );
  }

  @Delete('plans/:planId/comments/:commentId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  deleteComment(
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Request() req: any,
  ) {
    return this.developmentService.deleteComment(
      req.user.tenantId,
      commentId,
      req.user.userId,
      req.user.role,
    );
  }

  // ─── Suggestions ───────────────────────────────────────────────────────

  @Get('suggest/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  suggestPlanFromAssessment(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.developmentService.suggestPlanFromAssessment(
      req.user.tenantId,
      userId,
      cycleId,
    );
  }
}
