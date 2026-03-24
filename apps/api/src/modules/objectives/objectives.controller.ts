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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ObjectivesService } from './objectives.service';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto, CreateObjectiveUpdateDto } from './dto/update-objective.dto';

@Controller('objectives')
@UseGuards(AuthGuard('jwt'), RolesGuard)
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
    const { role, userId, tenantId } = req.user;

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
}
