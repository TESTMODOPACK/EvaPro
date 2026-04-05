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

@Controller('feedback')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.FEEDBACK)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // ─── Export ─────────────────────────────────────────────────────────────

  @Get('export')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async exportFeedback(
    @Request() req: any,
    @Query('format') format: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (format === 'xlsx') {
      const buffer = await this.feedbackService.exportFeedbackXlsx(req.user.tenantId);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=feedback-checkins.xlsx');
      return res.send(buffer);
    }
    const csv = await this.feedbackService.exportFeedbackCsv(req.user.tenantId);
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

  @Patch('checkins/:id')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  updateCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateCheckInDto,
  ) {
    return this.feedbackService.updateCheckIn(req.user.tenantId, id, dto);
  }

  @Delete('checkins/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  deleteCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.feedbackService.deleteCheckIn(req.user.tenantId, id, req.user.userId, req.user.role);
  }

  @Post('checkins/:id/complete')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  completeCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body?: { notes?: string; actionItems?: any[]; rating?: number },
  ) {
    return this.feedbackService.completeCheckIn(req.user.tenantId, id, req.user.userId, body);
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

  @Post('meeting-locations')
  @Roles('super_admin', 'tenant_admin', 'manager')
  createLocation(
    @Request() req: any,
    @Body() data: { name: string; type: string; address?: string; capacity?: number },
  ) {
    return this.feedbackService.createLocation(req.user.tenantId, data);
  }

  @Patch('meeting-locations/:id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() data: { name?: string; type?: string; address?: string; capacity?: number },
  ) {
    return this.feedbackService.updateLocation(req.user.tenantId, id, data);
  }

  @Delete('meeting-locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  deactivateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.feedbackService.deactivateLocation(req.user.tenantId, id);
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
