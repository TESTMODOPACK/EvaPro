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
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
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
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateObjectiveDto,
  ) {
    return this.objectivesService.update(req.user.tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.remove(req.user.tenantId, id);
  }

  @Post(':id/progress')
  addProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: CreateObjectiveUpdateDto,
  ) {
    return this.objectivesService.addProgressUpdate(
      req.user.tenantId, req.user.userId, id, dto,
    );
  }

  @Get(':id/history')
  getHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.getProgressHistory(req.user.tenantId, id);
  }

  // ─── Comments ───────────────────────────────────────────────────────────────

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
