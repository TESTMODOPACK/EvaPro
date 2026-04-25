import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { EvaluationsService } from './evaluations.service';
import { CreateCycleDto, UpdateCycleDto } from './dto/cycle.dto';
import { SaveResponseDto, SubmitResponseDto } from './dto/response.dto';
import { AddPeerAssignmentDto, BulkPeerAssignmentDto } from './dto/peer-assignment.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class EvaluationsController {
  constructor(private readonly evaluationsService: EvaluationsService) {}

  // ─── Cycles ───────────────────────────────────────────────────────────────
  // Read: all authenticated tenant users (each sees their tenant data)
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

  // Write: admin only
  //
  // P2.3 — Defensa cross-tenant (primary POST): super_admin debe pasar
  //        dto.tenantId explícito (falla 400 si no); tenant_admin ignora
  //        body.tenantId y opera siempre en su propio tenant.
  // P3.1 — Defensa cross-tenant (secondary POST/PATCH/DELETE): super_admin
  //        puede actuar cross-tenant pasando tenantId=undefined al service,
  //        que busca la entidad sin filtro de tenant y usa entity.tenantId
  //        como authoritative. tenant_admin sigue scoped: si pasa un :id
  //        que no pertenece a su tenant, findOne retorna 404.
  @Post('evaluation-cycles')
  @Roles('super_admin', 'tenant_admin')
  createCycle(@Request() req: any, @Body() dto: CreateCycleDto) {
    const tenantId = resolveOperatingTenantId(req.user, dto.tenantId);
    return this.evaluationsService.createCycle(tenantId, req.user.userId, dto);
  }

  @Patch('evaluation-cycles/:id')
  @Roles('super_admin', 'tenant_admin')
  updateCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateCycleDto,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.updateCycle(id, tenantId, dto, req.user.userId);
  }

  @Get('evaluation-cycles/:id/history')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getCycleHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.getCycleHistory(id, tenantId);
  }

  @Delete('evaluation-cycles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  deleteCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.deleteCycle(id, tenantId);
  }

  @Post('evaluation-cycles/:id/launch')
  @Roles('super_admin', 'tenant_admin')
  launchCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.launchCycle(id, tenantId, req.user.userId);
  }

  @Post('evaluation-cycles/:id/close')
  @Roles('super_admin', 'tenant_admin')
  closeCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.closeCycle(id, tenantId, req.user.userId);
  }

  @Post('evaluation-cycles/:id/pause')
  @Roles('super_admin', 'tenant_admin')
  pauseCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.pauseCycle(id, tenantId, req.user.userId);
  }

  @Post('evaluation-cycles/:id/resume')
  @Roles('super_admin', 'tenant_admin')
  resumeCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? null : req.user.tenantId;
    return this.evaluationsService.resumeCycle(id, tenantId, req.user.userId);
  }

  // ─── Cycle Stages (B3.14) ──────────────────────────────────────────────

  @Get('evaluation-cycles/:cycleId/stages')
  findStages(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.findStagesByCycle(cycleId, req.user.tenantId);
  }

  @Post('evaluation-cycles/:cycleId/advance-stage')
  @Roles('super_admin', 'tenant_admin')
  advanceStage(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.advanceStage(cycleId, req.user.tenantId, req.user.userId);
  }

  @Patch('evaluation-cycles/stages/:stageId')
  @Roles('super_admin', 'tenant_admin')
  updateStage(
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Request() req: any,
    @Body() data: { startDate?: string; endDate?: string; name?: string },
  ) {
    return this.evaluationsService.updateStage(stageId, req.user.tenantId, data);
  }

  // ─── Peer Suggestion ──────────────────────────────────────────────────
  @Get('evaluation-cycles/:cycleId/suggest-peers/:evaluateeId')
  @Roles('super_admin', 'tenant_admin')
  suggestPeers(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('evaluateeId', ParseUUIDPipe) evaluateeId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.suggestPeers(req.user.tenantId, cycleId, evaluateeId);
  }

  // ─── Peer Assignments (pre-launch) — admin only ──────────────────────────
  @Get('evaluation-cycles/:cycleId/peer-assignments')
  @Roles('super_admin', 'tenant_admin')
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

  @Get('evaluation-cycles/:cycleId/allowed-relations')
  @Roles('super_admin', 'tenant_admin')
  getAllowedRelations(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.getAllowedRelationsForCycle(req.user.tenantId, cycleId);
  }

  @Post('evaluation-cycles/:cycleId/auto-generate')
  @Roles('super_admin', 'tenant_admin')
  autoGenerateAssignments(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.autoGenerateAssignments(req.user.tenantId, cycleId);
  }

  /** Assignments — admin + manager (con scope a su equipo). Employees usan
   *  /evaluations/pending|completed|received para ver las suyas.
   *
   *  P7.6 — Manager ve solo assignments donde evaluateeId o evaluatorId
   *  sea del equipo (reportes directos + self). Admin ve todos. */
  @Get('evaluation-cycles/:cycleId/assignments')
  @Roles('super_admin', 'tenant_admin', 'manager')
  findAssignments(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.evaluationsService.findAssignmentsByCycle(cycleId, req.user.tenantId, managerId);
  }

  // ─── User's own evaluations — open to all roles (service scopes by userId) ─
  //
  // Query params opcionales (back-compat: si no se pasan, devuelve array crudo
  // como antes; si se pasa `?page` o `?limit`, devuelve `{ items, total }`):
  //   - search:  filtro por nombre/apellido del evaluado (ILIKE)
  //   - cycleId: limitar a un ciclo
  //   - page:    1-indexed (default 1)
  //   - limit:   items por página (1..100)
  @Get('evaluations/pending')
  async findPending(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('cycleId', new ParseUUIDPipe({ optional: true }))
    cycleId?: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    const opts = this.parseEvalListOpts(search, cycleId, pageParam, limitParam);
    const result = await this.evaluationsService.findPendingForUser(
      req.user.userId,
      req.user.tenantId,
      opts,
    );
    // Back-compat: array crudo si no se pidió paginación
    return pageParam === undefined && limitParam === undefined
      ? result.items
      : result;
  }

  @Get('evaluations/completed')
  async findCompleted(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('cycleId', new ParseUUIDPipe({ optional: true }))
    cycleId?: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    const opts = this.parseEvalListOpts(search, cycleId, pageParam, limitParam);
    const result = await this.evaluationsService.findCompletedForUser(
      req.user.userId,
      req.user.tenantId,
      opts,
    );
    return pageParam === undefined && limitParam === undefined
      ? result.items
      : result;
  }

  private parseEvalListOpts(
    search: string | undefined,
    cycleId: string | undefined,
    pageParam: string | undefined,
    limitParam: string | undefined,
  ) {
    const page =
      pageParam !== undefined ? parseInt(pageParam, 10) : undefined;
    const limit =
      limitParam !== undefined ? parseInt(limitParam, 10) : undefined;
    if (page !== undefined && (Number.isNaN(page) || page < 1)) {
      throw new BadRequestException('page debe ser un entero positivo');
    }
    if (
      limit !== undefined &&
      (Number.isNaN(limit) || limit < 1 || limit > 100)
    ) {
      throw new BadRequestException('limit debe estar entre 1 y 100');
    }
    return { search, cycleId, page, limit };
  }

  /** Evaluations where the current user was EVALUATED (by others).
   *  Acepta los mismos query params opcionales que /evaluations/completed
   *  (search, cycleId, page, limit). Search aquí filtra por nombre del
   *  evaluador (no del evaluado, que es el caller).
   */
  @Get('evaluations/received')
  async findEvaluationsReceived(
    @Request() req: any,
    @Query('search') search?: string,
    @Query('cycleId', new ParseUUIDPipe({ optional: true }))
    cycleId?: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    const opts = this.parseEvalListOpts(search, cycleId, pageParam, limitParam);
    const result = await this.evaluationsService.findEvaluationsOfUser(
      req.user.userId,
      req.user.tenantId,
      opts,
    );
    return pageParam === undefined && limitParam === undefined
      ? result.items
      : result;
  }

  /** Evaluations where an arbitrary userId was EVALUATED.
   *
   *  Reglas de acceso (de mayor a menor permiso):
   *    · super_admin / tenant_admin → cualquier usuario del tenant
   *    · manager                    → sí mismo, o reportes directos
   *    · employee                   → solo sí mismo
   *
   *  Las respuestas de evaluaciones contienen feedback sensible (pares,
   *  subordinados) — por eso la validación manager↔team es estricta. */
  @Get('users/:userId/received-evaluations')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async findEvaluationsByUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
    @Query('search') search?: string,
    @Query('cycleId', new ParseUUIDPipe({ optional: true }))
    cycleId?: string,
    @Query('page') pageParam?: string,
    @Query('limit') limitParam?: string,
  ) {
    await this.evaluationsService.assertCanViewUserEvaluations(
      userId,
      req.user.userId,
      req.user.tenantId,
      req.user.role,
    );
    const opts = this.parseEvalListOpts(search, cycleId, pageParam, limitParam);
    const result = await this.evaluationsService.findEvaluationsOfUser(
      userId,
      req.user.tenantId,
      opts,
    );
    return pageParam === undefined && limitParam === undefined
      ? result.items
      : result;
  }

  @Get('evaluations/:assignmentId')
  getAssignmentDetail(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Request() req: any,
  ) {
    return this.evaluationsService.getAssignmentDetail(assignmentId, req.user.tenantId);
  }

  // ─── Responses — open to all roles (service validates evaluatorId === userId) ─
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

  // ─── Dashboard Stats — admin + manager ───────────────────────────────────
  @Get('dashboard/stats')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getStats(@Request() req: any) {
    return this.evaluationsService.getStats(req.user.tenantId, req.user.userId, req.user.role);
  }

  // ─── Next Actions — all authenticated users ───────────────────────────────
  @Get('dashboard/next-actions')
  getNextActions(@Request() req: any) {
    return this.evaluationsService.getNextActions(req.user.tenantId, req.user.userId, req.user.role);
  }
}
