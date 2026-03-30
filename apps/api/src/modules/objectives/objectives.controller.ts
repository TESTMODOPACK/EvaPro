import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ObjectivesService } from './objectives.service';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto, CreateObjectiveUpdateDto } from './dto/update-objective.dto';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';

@Controller('objectives')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.OKR)
export class ObjectivesController {
  constructor(private readonly objectivesService: ObjectivesService) {}

  @Post()
  create(@Request() req: any, @Body() dto: CreateObjectiveDto) {
    const role = req.user.role;
    // tenant_admin and manager can assign to others via dto.userId
    // employee always creates for themselves
    let targetUserId = req.user.userId;
    if ((role === 'tenant_admin' || role === 'manager') && (dto as any).userId) {
      targetUserId = (dto as any).userId;
    }
    return this.objectivesService.create(req.user.tenantId, targetUserId, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('userId') filterUserId?: string) {
    const role = req.user.role;
    const tenantId = req.user.tenantId;

    if (role === 'tenant_admin' || role === 'super_admin') {
      return this.objectivesService.findAll(tenantId, filterUserId);
    }

    if (role === 'manager') {
      return this.objectivesService.findByManager(tenantId, req.user.userId);
    }

    // employee, external: only own
    return this.objectivesService.findByUser(tenantId, req.user.userId);
  }

  // B2.11: Objectives at risk (<40% progress)
  @Get('at-risk')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getAtRisk(@Request() req: any, @Query('userId') filterUserId?: string) {
    return this.objectivesService.getAtRiskObjectives(req.user.tenantId, filterUserId);
  }

  // B4 Item 12: Team objectives summary
  @Get('team-summary')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getTeamSummary(@Request() req: any) {
    // tenant_admin/super_admin: show ALL active users, not just direct reports
    const managerId = (req.user.role === 'tenant_admin' || req.user.role === 'super_admin')
      ? undefined
      : req.user.userId;
    return this.objectivesService.getTeamObjectivesSummary(req.user.tenantId, managerId);
  }

  // B3.15: Hierarchical OKR tree
  @Get('tree')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getTree(@Request() req: any) {
    return this.objectivesService.getObjectiveTree(req.user.tenantId);
  }

  @Get('history-by-period')
  getHistoryByPeriod(
    @Request() req: any,
    @Query('userId') userId?: string,
    @Query('cycleId') cycleId?: string,
  ) {
    const role = req.user.role;
    // Employees can only see their own history
    const effectiveUserId = (role === 'employee' || role === 'external')
      ? req.user.userId
      : userId;
    return this.objectivesService.getObjectiveHistory(req.user.tenantId, effectiveUserId, cycleId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.findById(req.user.tenantId, id);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateObjectiveDto,
  ) {
    const { role, userId, tenantId } = req.user;

    // Employees can only update their own objectives
    if (role === 'employee') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (objective.userId !== userId) {
        throw new ForbiddenException('Solo puedes modificar tus propios objetivos');
      }
    }

    // External advisors cannot update objectives
    if (role === 'external') {
      throw new ForbiddenException('Los asesores externos no pueden modificar objetivos');
    }

    return this.objectivesService.update(tenantId, id, dto);
  }

  @Post(':id/submit-for-approval')
  async submitForApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const { role, userId, tenantId } = req.user;
    if (role === 'employee') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (objective.userId !== userId) {
        throw new ForbiddenException('Solo puedes enviar tus propios objetivos a aprobaci\u00f3n');
      }
    }
    return this.objectivesService.submitForApproval(tenantId, id);
  }

  @Post(':id/approve')
  @Roles('super_admin', 'tenant_admin', 'manager')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.approve(req.user.tenantId, id);
  }

  @Post(':id/reject')
  @Roles('super_admin', 'tenant_admin', 'manager')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.reject(req.user.tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin', 'manager')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.remove(req.user.tenantId, id);
  }

  @Post(':id/progress')
  async addProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: CreateObjectiveUpdateDto,
  ) {
    const { role, userId, tenantId, firstName, lastName } = req.user;

    // Employees can only add progress to their own objectives
    if (role === 'employee') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (objective.userId !== userId) {
        throw new ForbiddenException('Solo puedes registrar avances en tus propios objetivos');
      }
    }

    // External advisors cannot add progress
    if (role === 'external') {
      throw new ForbiddenException('Los asesores externos no pueden registrar avances');
    }

    // Admin/manager overriding someone else's progress: require note and tag it
    if (role === 'tenant_admin' || role === 'manager' || role === 'super_admin') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (objective.userId !== userId) {
        if (!dto.notes || dto.notes.trim() === '') {
          throw new BadRequestException('Debes indicar el motivo al actualizar el progreso de otro colaborador');
        }
        const updaterName = [firstName, lastName].filter(Boolean).join(' ') || role;
        dto.notes = `[Actualizado por encargado — ${updaterName}] ${dto.notes.trim()}`;
      }
    }

    return this.objectivesService.addProgressUpdate(tenantId, userId, id, dto);
  }

  @Get(':id/history')
  getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.getProgressHistory(req.user.tenantId, id);
  }

  // ─── Comments ────────────────────────────────────────────────────────────

  @Get(':id/comments')
  listComments(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.listComments(req.user.tenantId, id);
  }

  @Post(':id/comments')
  createComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() data: { content: string; type?: string; attachmentUrl?: string; attachmentName?: string },
  ) {
    return this.objectivesService.createComment(
      req.user.tenantId, id, req.user.userId, data,
    );
  }

  @Delete(':id/comments/:commentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteComment(
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Request() req: any,
  ) {
    return this.objectivesService.deleteComment(
      req.user.tenantId, commentId, req.user.userId, req.user.role,
    );
  }

  // ─── Key Results (B2.10) ──────────────────────────────────────────────

  @Get(':id/key-results')
  listKeyResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.listKeyResults(req.user.tenantId, id);
  }

  @Post(':id/key-results')
  createKeyResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() data: { description: string; unit?: string; baseValue?: number; targetValue?: number },
  ) {
    return this.objectivesService.createKeyResult(req.user.tenantId, id, data);
  }

  @Patch('key-results/:krId')
  updateKeyResult(
    @Param('krId', ParseUUIDPipe) krId: string,
    @Request() req: any,
    @Body() data: { currentValue?: number; description?: string; targetValue?: number; status?: string },
  ) {
    return this.objectivesService.updateKeyResult(req.user.tenantId, krId, data as any);
  }

  @Delete('key-results/:krId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteKeyResult(
    @Param('krId', ParseUUIDPipe) krId: string,
    @Request() req: any,
  ) {
    return this.objectivesService.deleteKeyResult(req.user.tenantId, krId);
  }
}
