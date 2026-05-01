import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
  Request,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { SurveysService } from './surveys.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('surveys')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SurveysController {
  constructor(private readonly surveysService: SurveysService) {}

  /** List all surveys for the tenant */
  @Get()
  @Roles('super_admin', 'tenant_admin', 'manager')
  findAll(@Request() req: any) {
    return this.surveysService.findAll(req.user.tenantId);
  }

  /** Get pending surveys for the current user */
  @Get('pending')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getMyPending(@Request() req: any) {
    return this.surveysService.getMyPendingSurveys(req.user.tenantId, req.user.userId);
  }

  /** Get survey trends across closed surveys.
   *  T2 — Manager ve la evolucion historica de su equipo (encuestas no
   *  anonimas asignadas a el o sus reportes directos). Las anonimas se
   *  omiten del trend del manager para preservar anonimato (ver getTrends).
   */
  @Get('trends')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getTrends(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.surveysService.getTrends(req.user.tenantId, managerId);
  }

  /** Encuestas activas próximas a cerrar con baja participación.
   *  Para el widget CommandCenter del admin dashboard. */
  @Get('low-participation')
  @Roles('super_admin', 'tenant_admin')
  getLowParticipation(@Request() req: any) {
    return this.surveysService.getLowParticipationActiveSurveys(req.user.tenantId);
  }

  /** Get survey detail — employees need access to respond */
  @Get(':id')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.findById(req.user.tenantId, id);
  }

  /** Create a new survey.
   *
   * P2.4 — Cross-tenant defense: super_admin debe pasar dto.tenantId
   * explícito; tenant_admin ignora body.tenantId y crea en su propio.
   * Los otros endpoints con :id ya son defensivos por surveysService
   * scoping por tenantId al hacer findById.
   */
  @Post()
  @Roles('super_admin', 'tenant_admin')
  create(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.surveysService.create(tenantId, req.user.userId, dto);
  }

  /** Update a draft survey.
   *
   * P5.1 — Secondary cross-tenant: super_admin → undefined, el service
   *        busca por id sin filtro y usa entity.tenantId authoritative.
   */
  @Patch(':id')
  @Roles('super_admin', 'tenant_admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() dto: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.surveysService.update(tenantId, id, dto);
  }

  /** Delete a survey. tenant_admin can only delete drafts; super_admin
   *  can delete in any status (including closed with responses). */
  @Delete(':id')
  @Roles('super_admin', 'tenant_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.surveysService.delete(tenantId, id, req.user.role);
  }

  /** Launch a survey (draft → active) */
  @Post(':id/launch')
  @Roles('super_admin', 'tenant_admin')
  launch(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.surveysService.launch(tenantId, id);
  }

  /** Close a survey (active → closed) */
  @Post(':id/close')
  @Roles('super_admin', 'tenant_admin')
  close(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.surveysService.closeSurvey(tenantId, id);
  }

  /** Submit survey response */
  @Post(':id/respond')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { answers: Array<{ questionId: string; value: number | string | string[] }> },
  ) {
    return this.surveysService.submitResponse(req.user.tenantId, id, req.user.userId, dto.answers);
  }

  /** Export survey results in CSV, XLSX, or PDF format */
  @Get(':id/export')
  @Roles('super_admin', 'tenant_admin')
  async exportResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const tenantId = req.user.tenantId;
    const ext = format?.toLowerCase() || 'csv';

    if (ext === 'xlsx') {
      const buffer = await this.surveysService.exportSurveyXlsx(tenantId, id);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename=encuesta-${id}.xlsx` });
      return res.send(buffer);
    }
    if (ext === 'pdf') {
      const buffer = await this.surveysService.exportSurveyPdf(tenantId, id);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename=encuesta-${id}.pdf` });
      return res.send(buffer);
    }
    // Default: CSV
    const csv = await this.surveysService.exportSurveyCsv(tenantId, id);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=encuesta-${id}.csv` });
    return res.send(csv);
  }

  /** Get results by department — must be before :id/results */
  @Get(':id/results/department')
  @Roles('super_admin', 'tenant_admin')
  getResultsByDepartment(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.getResultsByDepartment(req.user.tenantId, id);
  }

  /** Get eNPS — must be before :id/results.
   *  P7.2 — Manager ve eNPS de su equipo (si survey no es anónima). */
  @Get(':id/results/enps')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getENPS(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.surveysService.getENPS(req.user.tenantId, id, managerId);
  }

  /** Get aggregated results.
   *  P7.2 — Manager ve resultados de su equipo (si survey no es anónima).
   *  Para surveys anónimas, manager recibe 403. */
  @Get(':id/results')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getResults(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.surveysService.getResults(req.user.tenantId, id, managerId);
  }

  /** Generate AI analysis for a closed survey.
   * Body `{ force?: boolean }` — when true, skips cache and wipes prior
   * insights so a fresh analysis is produced. Useful after backend scale
   * or prompt fixes, where the cached analysis would otherwise be stale. */
  @Post(':id/ai-analysis')
  @Roles('super_admin', 'tenant_admin')
  generateAiAnalysis(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { force?: boolean },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.surveysService.generateAiAnalysis(
      tenantId,
      id,
      req.user.userId,
      body?.force === true,
    );
  }

  /** Get existing AI analysis.
   *  P7.2 — Manager removido: el análisis IA cacheado se genera sobre
   *  toda la organización (no scoped por equipo). Si manager lo viera,
   *  tendría fuga de data agregada de otros equipos. Si en el futuro
   *  queremos habilitar manager, hay que generar insight separado por
   *  equipo (caché separado per-manager). Por ahora, admin-only. */
  @Get(':id/ai-analysis')
  @Roles('super_admin', 'tenant_admin')
  getAiAnalysis(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.getAiAnalysis(req.user.tenantId, id);
  }

  /** Create org development initiatives from AI analysis */
  @Post(':id/create-initiatives')
  @Roles('super_admin', 'tenant_admin')
  createInitiatives(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { targetPlanId?: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.surveysService.createInitiativesFromSurvey(tenantId, id, dto.targetPlanId);
  }
}
