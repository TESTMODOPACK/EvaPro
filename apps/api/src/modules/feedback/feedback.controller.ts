import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeedbackService } from './feedback.service';
import { CreateCheckInDto, UpdateCheckInDto } from './dto/create-checkin.dto';
import { CreateQuickFeedbackDto } from './dto/create-quick-feedback.dto';

@Controller('feedback')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  // ─── Check-ins ────────────────────────────────────────────────────────────

  @Post('checkins')
  createCheckIn(@Request() req: any, @Body() dto: CreateCheckInDto) {
    return this.feedbackService.createCheckIn(req.user.tenantId, req.user.userId, dto);
  }

  @Get('checkins')
  findCheckIns(@Request() req: any) {
    return this.feedbackService.findCheckIns(req.user.tenantId, req.user.userId, req.user.role);
  }

  @Patch('checkins/:id')
  updateCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateCheckInDto,
  ) {
    return this.feedbackService.updateCheckIn(req.user.tenantId, id, dto);
  }

  @Post('checkins/:id/complete')
  completeCheckIn(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.feedbackService.completeCheckIn(req.user.tenantId, id);
  }

  // ─── Quick Feedback ───────────────────────────────────────────────────────

  @Post('quick')
  sendQuickFeedback(@Request() req: any, @Body() dto: CreateQuickFeedbackDto) {
    return this.feedbackService.createQuickFeedback(req.user.tenantId, req.user.userId, dto);
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
