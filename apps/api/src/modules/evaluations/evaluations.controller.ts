import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EvaluationsService } from './evaluations.service';
import { CreateCycleDto, UpdateCycleDto } from './dto/cycle.dto';
import { SaveResponseDto, SubmitResponseDto } from './dto/response.dto';
import { AddPeerAssignmentDto, BulkPeerAssignmentDto } from './dto/peer-assignment.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  // ─── Cycles ───────────────────────────────────────────────────────────────

  @Get('evaluation-cycles')
  findAllCycles(@Request() req: any) {
    return this.evaluationsService.findAllCycles(req.user.tenantId);
  }

  @Get('evaluation-cycles/:id')
  findCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.findCycleById(id, req.user.tenantId);
  }

  @Post('evaluation-cycles')
  @Roles('super_admin', 'tenant_admin')
  createCycle(@Request() req: any, @Body() dto: CreateCycleDto) {
    return this.evaluationsService.createCycle(req.user.tenantId, req.user.userId, dto);
  }

  @Patch('evaluation-cycles/:id')
  updateCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateCycleDto,
  ) {
    return this.evaluationsService.updateCycle(id, req.user.tenantId, dto);
  }

  @Delete('evaluation-cycles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.deleteCycle(id, req.user.tenantId);
  }

  @Post('evaluation-cycles/:id/launch')
  @Roles('super_admin', 'tenant_admin')
  launchCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.launchCycle(id, req.user.tenantId, req.user.userId);
  }

  @Post('evaluation-cycles/:id/close')
  @Roles('super_admin', 'tenant_admin')
  closeCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.closeCycle(id, req.user.tenantId, req.user.userId);
  }

  // ─── Peer Assignments (pre-launch) ──────────────────────────────────────

  @Get('evaluation-cycles/:cycleId/peer-assignments')
  getPeerAssignments(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.getPeerAssignments(req.user.tenantId, cycleId);
  }

  @Post('evaluation-cycles/:cycleId/peer-assignments')
  @Roles('super_admin', 'tenant_admin')
  addPeerAssignment(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
    @Body() dto: AddPeerAssignmentDto,
  ) {
    return this.evaluationsService.addPeerAssignment(req.user.tenantId, cycleId, dto);
  }

  @Post('evaluation-cycles/:cycleId/peer-assignments/bulk')
  @Roles('super_admin', 'tenant_admin')
  bulkAddPeerAssignments(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
    @Body() dto: BulkPeerAssignmentDto,
  ) {
    return this.evaluationsService.bulkAddPeerAssignments(req.user.tenantId, cycleId, dto);
  }

  @Delete('evaluation-cycles/:cycleId/peer-assignments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  removePeerAssignment(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.removePeerAssignment(req.user.tenantId, cycleId, id);
  }

  // ─── Assignments ──────────────────────────────────────────────────────────

  @Get('evaluation-cycles/:cycleId/assignments')
  findAssignments(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.findAssignmentsByCycle(cycleId, req.user.tenantId);
  }

  @Get('evaluations/pending')
  findPending(@Request() req: any) {
    return this.evaluationsService.findPendingForUser(req.user.userId, req.user.tenantId);
  }

  @Get('evaluations/:assignmentId')
  getAssignmentDetail(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.getAssignmentDetail(assignmentId, req.user.tenantId);
  }

  // ─── Responses ────────────────────────────────────────────────────────────

  @Post('evaluations/:assignmentId/responses')
  saveResponse(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Request() req: any,
    @Body() dto: SaveResponseDto,
  ) {
    return this.evaluationsService.saveResponse(
      assignmentId, req.user.tenantId, req.user.userId, dto,
    );
  }

  @Patch('evaluations/:assignmentId/responses')
  updateResponse(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Request() req: any,
    @Body() dto: SaveResponseDto,
  ) {
    return this.evaluationsService.saveResponse(
      assignmentId, req.user.tenantId, req.user.userId, dto,
    );
  }

  @Post('evaluations/:assignmentId/submit')
  submitResponse(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Request() req: any,
    @Body() dto: SubmitResponseDto,
  ) {
    return this.evaluationsService.submitResponse(
      assignmentId, req.user.tenantId, req.user.userId, dto,
    );
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────────────

  @Get('dashboard/stats')
  getStats(@Request() req: any) {
    return this.evaluationsService.getStats(req.user.tenantId);
  }
}
