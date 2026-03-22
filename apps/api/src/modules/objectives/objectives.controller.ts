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
    return this.objectivesService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Get()
  findAll(@Request() req: any, @Query('userId') userId?: string) {
    const targetUserId = userId || req.user.userId;
    return this.objectivesService.findByUser(req.user.tenantId, targetUserId);
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
}
