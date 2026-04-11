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

  /** Get survey trends across closed surveys */
  @Get('trends')
  @Roles('super_admin', 'tenant_admin')
  getTrends(@Request() req: any) {
    return this.surveysService.getTrends(req.user.tenantId);
  }

  /** Get survey detail — employees need access to respond */
  @Get(':id')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.findById(req.user.tenantId, id);
  }

  /** Create a new survey */
  @Post()
  @Roles('super_admin', 'tenant_admin')
  create(@Request() req: any, @Body() dto: any) {
    return this.surveysService.create(req.user.tenantId, req.user.userId, dto);
  }

  /** Update a draft survey */
  @Patch(':id')
  @Roles('super_admin', 'tenant_admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() dto: any) {
    return this.surveysService.update(req.user.tenantId, id, dto);
  }

  /** Delete a draft survey */
  @Delete(':id')
  @Roles('super_admin', 'tenant_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.delete(req.user.tenantId, id);
  }

  /** Launch a survey (draft → active) */
  @Post(':id/launch')
  @Roles('super_admin', 'tenant_admin')
  launch(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.launch(req.user.tenantId, id);
  }

  /** Close a survey (active → closed) */
  @Post(':id/close')
  @Roles('super_admin', 'tenant_admin')
  close(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.closeSurvey(req.user.tenantId, id);
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

  /** Get eNPS — must be before :id/results */
  @Get(':id/results/enps')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getENPS(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.getENPS(req.user.tenantId, id);
  }

  /** Get aggregated results */
  @Get(':id/results')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getResults(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.surveysService.getResults(req.user.tenantId, id);
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
    return this.surveysService.generateAiAnalysis(
      req.user.tenantId,
      id,
      req.user.userId,
      body?.force === true,
    );
  }

  /** Get existing AI analysis */
  @Get(':id/ai-analysis')
  @Roles('super_admin', 'tenant_admin', 'manager')
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
    return this.surveysService.createInitiativesFromSurvey(req.user.tenantId, id, dto.targetPlanId);
  }
}
