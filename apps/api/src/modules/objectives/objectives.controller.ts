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
  Res,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ObjectivesService } from './objectives.service';
import { CreateObjectiveDto } from './dto/create-objective.dto';
import { UpdateObjectiveDto, CreateObjectiveUpdateDto } from './dto/update-objective.dto';
import { BulkApproveDto } from './dto/bulk-approve.dto';
import { CancelObjectiveDto } from './dto/cancel-objective.dto';
import { ListObjectivesQueryDto } from './dto/list-objectives-query.dto';
import { CarryOverObjectivesDto } from './dto/carry-over-objectives.dto';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';
import { User } from '../users/entities/user.entity';
import { assertManagerCanAccessUser } from '../../common/utils/validate-manager-scope';

@Controller('objectives')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.OKR)
export class ObjectivesController {
  constructor(
    private readonly objectivesService: ObjectivesService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * P2.5 — Cross-tenant defense: super_admin debe pasar dto.tenantId;
   * resto de roles opera en su propio tenant (body.tenantId ignorado).
   * Los demás endpoints (:id/progress, :id/approve, etc.) son defensivos
   * por findOne tenant-scoped del service.
   */
  @Post()
  async create(@Request() req: any, @Body() dto: CreateObjectiveDto) {
    const role = req.user.role;
    const tenantId = resolveOperatingTenantId(req.user, (dto as any)?.tenantId);
    // tenant_admin and manager can assign to others via dto.userId
    // employee always creates for themselves
    let targetUserId = req.user.userId;
    if ((role === 'tenant_admin' || role === 'manager') && (dto as any).userId) {
      targetUserId = (dto as any).userId;
    }
    // P10 audit manager — si el manager asigna objetivo a otro user,
    // validar que sea direct report. Antes podía asignar a cualquier
    // user del tenant. tenant_admin/super_admin no necesita validación.
    if (role === 'manager' && targetUserId !== req.user.userId) {
      await assertManagerCanAccessUser(
        this.userRepo,
        req.user.userId,
        role,
        targetUserId,
        req.user.tenantId,
      );
    }
    return this.objectivesService.create(tenantId, targetUserId, dto);
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

  /**
   * T12 — Audit P2: listado paginado con filtros server-side.
   * Reemplaza el patrón legacy `GET /objectives` (capado a 200).
   *
   * Query: ?page=1&pageSize=50&userId=&status=&type=&cycleId=&search=&department=
   *
   * Response: { data, total, page, pageSize, totalPages }
   *
   * Nota: el endpoint legacy `GET /objectives` se mantiene por
   * compatibilidad con consumidores que aún esperan un array directo
   * (export internals, otros). Migrar progresivamente a este endpoint.
   */
  @Get('list')
  listPaginated(@Request() req: any, @Query() query: ListObjectivesQueryDto) {
    return this.objectivesService.listObjectives(
      req.user.tenantId,
      req.user.role,
      req.user.userId,
      {
        page: query.page,
        pageSize: query.pageSize,
        userId: query.userId,
        status: query.status,
        type: query.type,
        cycleId: query.cycleId,
        search: query.search,
        department: query.department,
      },
    );
  }

  // B2.11: Objectives at risk (<40% progress)
  @Get('at-risk')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getAtRisk(@Request() req: any, @Query('userId') filterUserId?: string) {
    return this.objectivesService.getAtRiskObjectives(req.user.tenantId, filterUserId, req.user.role, req.user.userId);
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
    return this.objectivesService.getObjectiveTree(req.user.tenantId, req.user.role, req.user.userId);
  }

  /** Export objectives in XLSX or PDF format — view=tree includes hierarchy */
  @Get('export')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async exportObjectives(
    @Request() req: any,
    @Query('format') format: string,
    @Query('view') view: string,
    @Res() res: Response,
  ) {
    const { tenantId, userId, role } = req.user;
    const ext = format?.toLowerCase() || 'xlsx';
    const isTree = view === 'tree';
    const suffix = isTree ? 'arbol' : 'lista';

    if (ext === 'xlsx') {
      const buffer = isTree
        ? await this.objectivesService.exportObjectivesTreeXlsx(tenantId, role, userId)
        : await this.objectivesService.exportObjectivesXlsx(tenantId, userId, role);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename=objetivos-${suffix}.xlsx` });
      return res.send(buffer);
    }
    if (ext === 'pdf') {
      const buffer = isTree
        ? await this.objectivesService.exportObjectivesTreePdf(tenantId, role, userId)
        : await this.objectivesService.exportObjectivesPdf(tenantId, userId, role);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename=objetivos-${suffix}.pdf` });
      return res.send(buffer);
    }
    // Default: xlsx list
    const buffer = await this.objectivesService.exportObjectivesXlsx(tenantId, userId, role);
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename=objetivos-lista.xlsx` });
    return res.send(buffer);
  }

  @Get('history-by-period')
  getHistoryByPeriod(
    @Request() req: any,
    @Query('userId') userId?: string,
    @Query('cycleId') cycleId?: string,
    /**
     * T9 — Audit P1 (Issue B): si `includeActive=true`, el reporte
     * incluye también ACTIVE/OVERDUE. Para esos, usa el cycle-wide
     * snapshot del cierre si existe (ciclos cerrados); sino marca
     * inProgress para que la UI muestre etiqueta "aún en curso".
     */
    @Query('includeActive') includeActive?: string,
  ) {
    const role = req.user.role;
    // Employees can only see their own history
    const effectiveUserId = (role === 'employee' || role === 'external')
      ? req.user.userId
      : userId;
    const includeActiveFlag = includeActive === 'true' || includeActive === '1';
    return this.objectivesService.getObjectiveHistory(
      req.user.tenantId,
      effectiveUserId,
      cycleId,
      includeActiveFlag,
    );
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

    // External advisors cannot update objectives.
    if (role === 'external') {
      throw new ForbiddenException('Los asesores externos no pueden modificar objetivos');
    }

    // Employees can only update their own objectives.
    // P10 audit manager — managers tambien estaban limitados ahora:
    // solo pueden modificar objetivos propios o de sus direct reports.
    // Antes un manager podía modificar cualquier objetivo del tenant.
    if (role === 'employee' || role === 'manager') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (role === 'employee' && objective.userId !== userId) {
        throw new ForbiddenException('Solo puedes modificar tus propios objetivos');
      }
      if (role === 'manager' && objective.userId !== userId) {
        // Verificar que el owner sea su direct report.
        await assertManagerCanAccessUser(
          this.userRepo,
          userId,
          role,
          objective.userId,
          tenantId,
        );
      }
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

  /** P5.4 — Secondary cross-tenant: super_admin → undefined. */
  @Post(':id/approve')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    // P10 audit manager — validar que el manager solo apruebe objetivos
    // de su equipo directo. Antes cualquier manager podía aprobar
    // objetivos de colaboradores ajenos (IDOR).
    if (req.user.role === 'manager') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (objective.userId !== req.user.userId) {
        await assertManagerCanAccessUser(
          this.userRepo,
          req.user.userId,
          req.user.role,
          objective.userId,
          req.user.tenantId,
        );
      }
    }
    return this.objectivesService.approve(tenantId, id, req.user.userId);
  }

  /**
   * T4.1 — BUG-10: bulk approval transaccional. Reemplaza el loop
   * client-side que no reportaba fallidos. Cada item se procesa de
   * manera independiente; un fallo no aborta el resto.
   */
  /**
   * T11 — Audit P2: carry-over de objetivos no terminados al ciclo
   * siguiente. Body: { objectiveIds, targetCycleId, cancelSource?,
   * sourceCancelReason? }. Devuelve { created, cancelled, failed[] }.
   *
   * Permisos: super_admin / tenant_admin / manager. El service valida
   * cada item; manager solo puede llevar objetivos de su scope (similar
   * a bulk-approve en T4).
   */
  @Post('carry-over')
  @Roles('super_admin', 'tenant_admin', 'manager')
  carryOver(@Request() req: any, @Body() dto: CarryOverObjectivesDto) {
    return this.objectivesService.carryOverObjectives(
      req.user.tenantId,
      req.user.userId,
      {
        objectiveIds: dto.objectiveIds,
        targetCycleId: dto.targetCycleId,
        cancelSource: dto.cancelSource,
        sourceCancelReason: dto.sourceCancelReason,
      },
    );
  }

  @Post('bulk-approve')
  @Roles('super_admin', 'tenant_admin', 'manager')
  bulkApprove(@Request() req: any, @Body() dto: BulkApproveDto) {
    const tenantId =
      req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.objectivesService.bulkApprove(
      tenantId,
      dto.ids,
      req.user.userId,
      req.user.role,
    );
  }

  @Post(':id/reject')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { reason?: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    // P10 audit manager — mismo check que approve.
    if (req.user.role === 'manager') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (objective.userId !== req.user.userId) {
        await assertManagerCanAccessUser(
          this.userRepo,
          req.user.userId,
          req.user.role,
          objective.userId,
          req.user.tenantId,
        );
      }
    }
    return this.objectivesService.reject(tenantId, id, req.user.userId, body?.reason);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.objectivesService.remove(tenantId, id);
  }

  /**
   * T7.2 — Audit P1: cancela un objetivo por decisión de negocio.
   * Reemplaza el delete-style flow para casos en que el objetivo deja
   * de ser relevante (cambio de estrategia, scope-change). Razón
   * obligatoria — queda registrada en cancellation_reason.
   *
   * Permisos:
   *   - tenant_admin / super_admin: cualquier objetivo
   *   - manager: propios o de reportes directos (P10 audit manager scope)
   *   - employee: solo propios
   *   - external: bloqueado
   */
  @Post(':id/cancel')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  async cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: CancelObjectiveDto,
  ) {
    const { role, userId, tenantId } = req.user;
    if (role === 'external') {
      throw new ForbiddenException(
        'Los asesores externos no pueden cancelar objetivos',
      );
    }

    // Owner/scope check
    if (role === 'employee' || role === 'manager') {
      const objective = await this.objectivesService.findById(tenantId, id);
      if (role === 'employee' && objective.userId !== userId) {
        throw new ForbiddenException('Solo puedes cancelar tus propios objetivos');
      }
      if (role === 'manager' && objective.userId !== userId) {
        await assertManagerCanAccessUser(
          this.userRepo,
          userId,
          role,
          objective.userId,
          tenantId,
        );
      }
    }

    const effectiveTenantId =
      role === 'super_admin' ? undefined : tenantId;
    return this.objectivesService.cancel(
      effectiveTenantId,
      id,
      dto.reason,
      userId,
    );
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

  /**
   * T8.2 — Audit P1: historial completo de rechazos del objetivo. Útil
   * para que el owner vea cuántas veces fue rechazado y qué corregir
   * (la columna rejection_reason solo guarda el último).
   */
  @Get(':id/rejection-history')
  getRejectionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.objectivesService.listRejectionHistory(req.user.tenantId, id);
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
    return this.objectivesService.updateKeyResult(
      req.user.tenantId,
      krId,
      data as any,
      req.user.userId,
    );
  }

  @Delete('key-results/:krId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteKeyResult(
    @Param('krId', ParseUUIDPipe) krId: string,
    @Request() req: any,
  ) {
    return this.objectivesService.deleteKeyResult(
      req.user.tenantId,
      krId,
      req.user.userId,
    );
  }
}
