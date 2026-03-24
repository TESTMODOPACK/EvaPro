import {
  Controller,
  Get,
  Patch,
  Param,
  UseGuards,
  Request,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Get my notifications (latest 50 by default) */
  @Get()
  findMine(@Request() req: any, @Query('limit') limit?: string) {
    const take = limit ? Math.min(parseInt(limit, 10), 100) : 50;
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
}
