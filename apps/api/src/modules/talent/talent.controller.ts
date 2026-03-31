import {
  Controller,
  Get,
  Post,
  Patch,
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
  @Roles('super_admin', 'tenant_admin')
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

  @Patch(':id')
  @Roles('super_admin', 'tenant_admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
    @Request() req: any,
  ) {
    return this.talentService.updateAssessment(id, dto, req.user.userId);
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

  @Get('calibration/:id')
  getSessionDetail(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.talentService.getSessionDetail(id, req.user.tenantId);
  }

  @Post('calibration/:id/populate')
  @Roles('super_admin', 'tenant_admin')
  populateEntries(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.talentService.populateEntries(id, req.user.tenantId);
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
