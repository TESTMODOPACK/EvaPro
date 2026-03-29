import {
  Controller, Post, Get, Patch, Body, Param, Query,
  ParseUUIDPipe, UseGuards, Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PostulantsService } from './postulants.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';

@Controller('postulants')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.POSTULANTS)
@Roles('super_admin', 'tenant_admin', 'manager')
export class PostulantsController {
  constructor(private readonly service: PostulantsService) {}

  // ─── Processes (static routes MUST come before :id wildcard) ─────────

  @Post('processes')
  @Roles('super_admin', 'tenant_admin')
  createProcess(@Request() req: any, @Body() dto: any) {
    return this.service.createProcess(req.user.tenantId, req.user.userId, dto);
  }

  @Get('processes')
  listProcesses(@Request() req: any, @Query('status') status?: string) {
    return this.service.listProcesses(req.user.tenantId, status);
  }

  @Get('processes/:id')
  getProcess(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getProcess(req.user.tenantId, id);
  }

  @Patch('processes/:id')
  @Roles('super_admin', 'tenant_admin')
  updateProcess(@Request() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.service.updateProcess(req.user.tenantId, id, dto);
  }

  // ─── Postulants ─────────────────────────────────────────────────────

  @Post()
  @Roles('super_admin', 'tenant_admin')
  createPostulant(@Request() req: any, @Body() dto: any) {
    return this.service.createPostulant(req.user.tenantId, dto);
  }

  @Get()
  listPostulants(@Request() req: any, @Query('search') search?: string) {
    return this.service.listPostulants(req.user.tenantId, search);
  }

  @Get(':id')
  getPostulant(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getPostulant(req.user.tenantId, id);
  }

  // ─── Process Entries ────────────────────────────────────────────────

  @Post('processes/:id/postulants')
  @Roles('super_admin', 'tenant_admin')
  addPostulant(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) processId: string,
    @Body('postulantId', ParseUUIDPipe) postulantId: string,
  ) {
    return this.service.addPostulantToProcess(req.user.tenantId, processId, postulantId);
  }

  @Patch('entries/:entryId/status')
  @Roles('super_admin', 'tenant_admin')
  updateEntryStatus(
    @Request() req: any,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: { status: string; statusNotes?: string },
  ) {
    return this.service.updateEntryStatus(req.user.tenantId, entryId, dto.status, dto.statusNotes);
  }

  // ─── Assessments ────────────────────────────────────────────────────

  @Post('assessments')
  submitAssessment(@Request() req: any, @Body() dto: any) {
    return this.service.submitAssessment(req.user.tenantId, req.user.userId, dto);
  }

  @Get('entries/:entryId/scorecard')
  getScorecard(@Request() req: any, @Param('entryId', ParseUUIDPipe) entryId: string) {
    return this.service.getScorecard(req.user.tenantId, entryId);
  }

  @Get('processes/:id/comparative')
  getComparative(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getComparative(req.user.tenantId, id);
  }
}
