import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Request,
  Query,
  ParseUUIDPipe,
  UseGuards,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TalentService } from './talent.service';
import { Response } from 'express';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Feature } from '../../common/decorators/feature.decorator';
import { PlanFeature } from '../../common/constants/plan-features';

@Controller('talent')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.NINE_BOX)
@Roles('super_admin', 'tenant_admin', 'manager')
export class TalentController {
  constructor(private readonly talentService: TalentService) {}

  // ─── Assessments ───────────────────────────────────────────────────────

  @Post('generate/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  generate(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.talentService.generateAssessments(req.user.tenantId, cycleId, req.user.userId);
  }

  @Get('cycle/:cycleId')
  findByCycle(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    const managerId = role === 'manager' ? userId : undefined;
    return this.talentService.findByCycle(req.user.tenantId, cycleId, managerId);
  }

  @Get('cycle/:cycleId/nine-box')
  getNineBox(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    const managerId = role === 'manager' ? userId : undefined;
    return this.talentService.getNineBoxSummary(req.user.tenantId, cycleId, managerId);
  }

  @Get('cycle/:cycleId/segmentation')
  getSegmentation(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    const { role, userId } = req.user;
    const managerId = role === 'manager' ? userId : undefined;
    return this.talentService.getSegmentation(req.user.tenantId, cycleId, managerId);
  }

  /** Export talent assessments in CSV, XLSX, or PDF format */
  @Get('cycle/:cycleId/export')
  async exportTalent(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('format') format: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const { tenantId, role, userId } = req.user;
    const managerId = role === 'manager' ? userId : undefined;
    const ext = format?.toLowerCase() || 'csv';

    if (ext === 'xlsx') {
      const buffer = await this.talentService.exportTalentXlsx(tenantId, cycleId, managerId);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename=talento-${cycleId}.xlsx` });
      return res.send(buffer);
    }
    if (ext === 'pdf') {
      const buffer = await this.talentService.exportTalentPdf(tenantId, cycleId, managerId);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename=talento-${cycleId}.pdf` });
      return res.send(buffer);
    }
    const csv = await this.talentService.exportTalentCsv(tenantId, cycleId, managerId);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=talento-${cycleId}.csv` });
    return res.send(csv);
  }

  @Patch(':id')
  @Roles('super_admin', 'tenant_admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
    @Request() req: any,
  ) {
    return this.talentService.updateAssessment(req.user.tenantId, id, dto, req.user.userId);
  }

  @Get('user/:userId')
  userHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.talentService.findByUser(req.user.tenantId, userId);
  }

  // ─── Calibration ──────────────────────────────────────────────────────

  @Post('calibration')
  @Roles('super_admin', 'tenant_admin')
  createSession(@Body() dto: any, @Request() req: any) {
    return this.talentService.createSession(req.user.tenantId, {
      ...dto,
      moderatorId: req.user.userId,
    });
  }

  @Get('calibration')
  findSessions(@Request() req: any, @Query('cycleId') cycleId?: string) {
    return this.talentService.findSessions(req.user.tenantId, cycleId);
  }

  @Get('calibration/:id/preview')
  @Roles('super_admin', 'tenant_admin')
  previewEntries(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.talentService.previewEntries(id, req.user.tenantId);
  }

  @Get('calibration/:id')
  getSessionDetail(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.talentService.getSessionDetail(id, req.user.tenantId);
  }

  @Post('calibration/:id/populate')
  @Roles('super_admin', 'tenant_admin')
  populateEntries(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() body?: { excludeUserIds?: string[] }) {
    return this.talentService.populateEntries(id, req.user.tenantId, body?.excludeUserIds);
  }

  @Post('calibration/:id/add-entry')
  @Roles('super_admin', 'tenant_admin')
  addEntry(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Body() body: { userId: string }) {
    return this.talentService.addSingleEntry(id, req.user.tenantId, body.userId);
  }

  @Delete('calibration/entry/:entryId')
  @Roles('super_admin', 'tenant_admin')
  removeEntry(@Param('entryId', ParseUUIDPipe) entryId: string, @Request() req: any) {
    return this.talentService.removeEntry(entryId, req.user.tenantId);
  }

  @Patch('calibration/entry/:entryId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateEntry(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: any,
    @Request() req: any,
  ) {
    return this.talentService.updateEntry(entryId, dto, req.user.userId);
  }

  @Post('calibration/:id/complete')
  @Roles('super_admin', 'tenant_admin')
  completeSession(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.talentService.completeSession(id, req.user.tenantId);
  }

  @Post('calibration/entries/:entryId/approve')
  @Roles('super_admin', 'tenant_admin')
  approveCalibrationChange(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Request() req: any,
    @Body() dto: { approved: boolean },
  ) {
    return this.talentService.approveCalibrationChange(entryId, req.user.userId, dto.approved);
  }

  @Get('calibration/:id/distribution')
  @Roles('super_admin', 'tenant_admin', 'manager')
  distributionAnalysis(@Param('id', ParseUUIDPipe) id: string) {
    return this.talentService.getDistributionAnalysis(id);
  }

  @Get('calibration/:id/pdf')
  @Roles('super_admin', 'tenant_admin')
  async calibrationPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: any,
  ) {
    const pdfBuffer = await this.talentService.generateCalibrationPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=acta-calibracion-${id}.pdf`);
    return res.send(pdfBuffer);
  }
}
