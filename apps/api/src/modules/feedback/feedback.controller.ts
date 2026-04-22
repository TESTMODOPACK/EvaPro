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
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FeedbackService } from './feedback.service';
import { CreateCheckInDto, UpdateCheckInDto, RejectCheckInDto } from './dto/create-checkin.dto';
import { CreateQuickFeedbackDto } from './dto/create-quick-feedback.dto';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('feedback')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.FEEDBACK)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // ─── Export ─────────────────────────────────────────────────────────────

  /** P7.3 — Manager exporta solo check-ins de su equipo (donde él o un
   *  reporte directo participó). Admin exporta todo el tenant. */
  @Get('export')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async exportFeedback(
    @Request() req: any,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    if (format === 'xlsx') {
      const buffer = await this.feedbackService.exportFeedbackXlsx(req.user.tenantId, managerId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=feedback-checkins.xlsx');
      return res.send(buffer);
    }
    const csv = await this.feedbackService.exportFeedbackCsv(req.user.tenantId, managerId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=feedback-checkins.csv');
    return res.send(csv);
  }

  // ─── Check-ins ────────────────────────────────────────────────────────────

  @Post('checkins')
  @Roles('super_admin', 'tenant_admin', 'manager')
  createCheckIn(@Request() req: any, @Body() dto: CreateCheckInDto) {
    return this.feedbackService.createCheckIn(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  @Get('checkins')
  findCheckIns(@Request() req: any) {
    return this.feedbackService.findCheckIns(req.user.tenantId, req.user.userId, req.user.role);
  }

  /**
   * v3.1 — Historial de temas usados en check-ins previos, para
   * autocompletar al crear uno nuevo. Admin ve todos los temas del
   * tenant; manager solo los suyos; employee recibe lista vacía.
   */
  @Get('my-topics')
  @Roles('super_admin', 'tenant_admin', 'manager')
  findMyTopicsHistory(@Request() req: any) {
    return this.feedbackService.findMyTopicsHistory(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
    );
  }

  @Patch('checkins/:id')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  updateCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateCheckInDto,
  ) {
    return this.feedbackService.updateCheckIn(req.user.tenantId, id, dto);
  }

  @Post('checkins/request')
  @Roles('employee')
  requestCheckIn(@Request() req: any, @Body() dto: { topic: string; suggestedDate?: string }) {
    return this.feedbackService.requestCheckIn(req.user.tenantId, req.user.userId, dto);
  }

  /** P5.6 — Secondary cross-tenant: super_admin → undefined. */
  @Post('checkins/:id/accept')
  @Roles('super_admin', 'tenant_admin', 'manager')
  acceptCheckInRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { scheduledDate?: string; scheduledTime?: string; locationId?: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.feedbackService.acceptCheckInRequest(tenantId, id, req.user.userId, body);
  }

  @Delete('checkins/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  deleteCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.feedbackService.deleteCheckIn(tenantId, id, req.user.userId, req.user.role);
  }

  @Post('checkins/:id/complete')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  completeCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { notes?: string; actionItems?: any[]; rating?: number; minutes?: string },
  ) {
    return this.feedbackService.completeCheckIn(req.user.tenantId, id, req.user.userId, body);
  }

  /** Update minutes on a completed check-in (editable post-completion) */
  @Patch('checkins/:id/minutes')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  updateMinutes(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { minutes: string },
  ) {
    return this.feedbackService.updateMinutes(req.user.tenantId, id, req.user.userId, body.minutes);
  }

  /**
   * v3.1 — Edición retroactiva de un check-in ya COMPLETED (típicamente
   * auto-cerrado por el cron de +5 días). Solo manager del check-in o
   * admin. Acepta cualquier combinación de notes/minutes/actionItems/rating.
   */
  @Patch('checkins/:id/retroactive-info')
  @Roles('super_admin', 'tenant_admin', 'manager')
  editCompletedCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: {
      notes?: string;
      minutes?: string;
      rating?: number;
      actionItems?: Array<{
        text: string;
        completed?: boolean;
        assigneeId?: string;
        assigneeName?: string;
        dueDate?: string;
      }>;
    },
  ) {
    return this.feedbackService.editCompletedCheckIn(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      body || {},
    );
  }

  @Patch('checkins/:id/add-topic')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  addTopicToCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { text: string },
  ) {
    return this.feedbackService.addTopicToCheckIn(
      req.user.tenantId,
      id,
      req.user.userId,
      dto.text,
    );
  }

  // ─── v3.1 F1 — Agenda Mágica de 1:1 ─────────────────────────────────────

  /**
   * GET /feedback/checkins/:id/agenda
   *
   * Retorna la agenda mágica ya generada (si existe) + los actionItems
   * heredados del 1:1 anterior. Lecturas — rol mínimo: participante.
   * NO regenera nada ni consume créditos de IA.
   */
  @Get('checkins/:id/agenda')
  @Feature(PlanFeature.MAGIC_MEETINGS)
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getMagicAgenda(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.feedbackService.getMagicAgenda(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
    );
  }

  /**
   * POST /feedback/checkins/:id/agenda/generate
   *
   * Genera la agenda mágica on-demand. Escritura — solo manager dueño
   * o admin. Si ya existe agenda con la versión actual y NO se pasa
   * `{ force: true }`, retorna la cacheada sin quemar crédito IA.
   *
   * Body (opcional): `{ force?: boolean }` — fuerza regeneración.
   */
  @Post('checkins/:id/agenda/generate')
  @Feature(PlanFeature.MAGIC_MEETINGS)
  @Roles('super_admin', 'tenant_admin', 'manager')
  generateMagicAgenda(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { force?: boolean; includeAi?: boolean },
  ) {
    return this.feedbackService.generateMagicAgenda(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      {
        force: !!body?.force,
        // Default true (conservamos comportamiento previo); solo si el
        // frontend manda includeAi=false saltamos la IA — ahorra crédito.
        includeAi: body?.includeAi !== false,
      },
    );
  }

  /**
   * PATCH /feedback/checkins/:id/agenda
   *
   * Permite dismissear sugerencias IA individuales (para que no molesten
   * en el render pero queden trazables como "no aplicadas").
   *
   * Body: `{ dismissedSuggestionIds: string[] }`.
   */
  @Patch('checkins/:id/agenda')
  @Feature(PlanFeature.MAGIC_MEETINGS)
  @Roles('super_admin', 'tenant_admin', 'manager')
  patchMagicAgenda(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { dismissedSuggestionIds?: string[] },
  ) {
    return this.feedbackService.patchMagicAgenda(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      body || {},
    );
  }

  @Post('checkins/:id/reject')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  rejectCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: RejectCheckInDto,
  ) {
    return this.feedbackService.rejectCheckIn(req.user.tenantId, id, req.user.userId, dto);
  }

  // ─── Meeting Locations ──────────────────────────────────────────────────

  @Get('meeting-locations')
  findLocations(@Request() req: any) {
    return this.feedbackService.findLocations(req.user.tenantId);
  }

  /**
   * P2.4 — Cross-tenant defense: super_admin debe pasar data.tenantId
   * explícito al crear location; tenant_admin/manager ignoran body y
   * operan en su propio. Los endpoints :id (update/delete) ya son
   * defensivos por findOne scoped del service.
   */
  @Post('meeting-locations')
  @Roles('super_admin', 'tenant_admin', 'manager')
  createLocation(
    @Request() req: any,
    @Body() data: { name: string; type: string; address?: string; capacity?: number; tenantId?: string },
  ) {
    const tenantId = resolveOperatingTenantId(req.user, data?.tenantId);
    return this.feedbackService.createLocation(tenantId, data);
  }

  @Patch('meeting-locations/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() data: { name?: string; type?: string; address?: string; capacity?: number },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.feedbackService.updateLocation(tenantId, id, data);
  }

  @Delete('meeting-locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  deactivateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.feedbackService.deactivateLocation(tenantId, id);
  }

  // ─── Quick Feedback ───────────────────────────────────────────────────────

  @Post('quick')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  sendQuickFeedback(@Request() req: any, @Body() dto: CreateQuickFeedbackDto) {
    return this.feedbackService.createQuickFeedback(req.user.tenantId, req.user.userId, dto, req.user.role);
  }

  @Get('quick/received')
  receivedFeedback(@Request() req: any) {
    return this.feedbackService.findFeedbackReceived(req.user.tenantId, req.user.userId);
  }

  @Get('quick/given')
  givenFeedback(@Request() req: any) {
    return this.feedbackService.findFeedbackGiven(req.user.tenantId, req.user.userId);
  }

  @Get('quick/summary')
  feedbackSummary(@Request() req: any) {
    return this.feedbackService.getFeedbackSummary(req.user.tenantId, req.user.userId);
  }
}
