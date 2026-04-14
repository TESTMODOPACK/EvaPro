import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email.service';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly emailService: EmailService,
  ) {}

  /** Get my notifications (latest 50 by default) */
  @Get()
  findMine(@Request() req: any, @Query('limit') limit?: string) {
    const take = limit ? Math.min(parseInt(limit, 10), 200) : 50;
    return this.notificationsService.findByUser(req.user.tenantId, req.user.userId, take);
  }

  /** Get count of unread notifications */
  @Get('unread-count')
  async countUnread(@Request() req: any) {
    const count = await this.notificationsService.countUnread(req.user.tenantId, req.user.userId);
    return { count };
  }

  /** Mark a single notification as read */
  @Patch(':id/read')
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.notificationsService.markAsRead(req.user.tenantId, req.user.userId, id);
  }

  /** Mark all notifications as read */
  @Patch('read-all')
  markAllAsRead(@Request() req: any) {
    return this.notificationsService.markAllAsRead(req.user.tenantId, req.user.userId);
  }

  /** Get user notification preferences */
  @Get('preferences')
  getPreferences(@Request() req: any) {
    return this.notificationsService.getPreferences(req.user.tenantId, req.user.userId);
  }

  /** Update user notification preferences */
  @Patch('preferences')
  updatePreferences(@Request() req: any, @Body() body: Record<string, boolean>) {
    return this.notificationsService.updatePreferences(req.user.tenantId, req.user.userId, body);
  }

  /** Delete all read notifications */
  @Delete('read')
  @HttpCode(HttpStatus.OK)
  async deleteAllRead(@Request() req: any) {
    const deleted = await this.notificationsService.deleteAllRead(req.user.tenantId, req.user.userId);
    return { deleted };
  }

  /** Delete a single notification */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteOne(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.notificationsService.deleteOne(req.user.tenantId, req.user.userId, id);
  }

  /** POST /notifications/test-email — super_admin only, sends all templates to provided address */
  @Post('test-email')
  @Roles('super_admin')
  async testEmail(@Body() body: { to: string; template?: string }) {
    const to = body.to;
    const template = body.template || 'all';
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';
    const sent: string[] = [];

    if (template === 'all' || template === 'invitation') {
      await this.emailService.sendInvitation(to, {
        firstName: 'Ricardo',
        orgName: 'Demo Corp',
        tempPassword: 'Temp1234!',
        inviterName: 'Admin EvaPro',
      });
      sent.push('invitation');
    }

    if (template === 'all' || template === 'cycle_launched') {
      await this.emailService.sendCycleLaunched(to, {
        firstName: 'Ricardo',
        cycleName: 'Evaluación Anual 2025',
        cycleType: '360',
        dueDate: '15 de abril 2025',
        cycleId: 'test-cycle-id',
      });
      sent.push('cycle_launched');
    }

    if (template === 'all' || template === 'reminder') {
      await this.emailService.sendEvaluationReminder(to, {
        firstName: 'Ricardo',
        cycleName: 'Evaluación Anual 2025',
        pendingCount: 3,
        daysLeft: 2,
        cycleId: 'test-cycle-id',
      });
      sent.push('reminder');
    }

    if (template === 'all' || template === 'cycle_closed') {
      await this.emailService.sendCycleClosed(to, {
        firstName: 'Ricardo',
        cycleName: 'Evaluación Anual 2025',
        cycleId: 'test-cycle-id',
      });
      sent.push('cycle_closed');
    }

    if (template === 'all' || template === 'subscription_expiring') {
      await this.emailService.sendSubscriptionExpiring(to, {
        orgName: 'Demo Corp',
        planName: 'Pro',
        daysLeft: 5,
        expiresAt: '15/04/2025',
      });
      sent.push('subscription_expiring');
    }

    if (template === 'all' || template === 'okr_at_risk') {
      await this.emailService.sendOkrAtRisk(to, {
        firstName: 'Ricardo',
        objectives: [
          { title: 'Aumentar NPS a 75', progress: 30, daysLeft: 12 },
          { title: 'Reducir churn a 2%', progress: 15, daysLeft: 8 },
        ],
      });
      sent.push('okr_at_risk');
    }

    return {
      message: `Test emails sent to ${to}`,
      templates: sent,
      appUrl,
    };
  }
}
