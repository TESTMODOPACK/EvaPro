import {
  Controller, Get, Post, Body, Param, Query, UseGuards, Request,
  ParseUUIDPipe, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RecognitionService } from './recognition.service';
import { CreateRecognitionDto, CreateBadgeDto, AwardBadgeDto, AddReactionDto } from './dto/recognition.dto';

@Controller('recognition')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RecognitionController {
  constructor(private readonly service: RecognitionService) {}

  // ─── Recognition Wall ────────────────────────────────────────────

  @Get('wall')
  getWall(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.service.getWall(req.user.tenantId, page, Math.min(limit, 50));
  }

  @Post()
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  create(@Request() req: any, @Body() dto: CreateRecognitionDto) {
    return this.service.createRecognition(req.user.tenantId, req.user.userId, dto);
  }

  @Post(':id/reaction')
  addReaction(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: AddReactionDto,
  ) {
    return this.service.addReaction(req.user.tenantId, id, dto.emoji);
  }

  // ─── Badges ──────────────────────────────────────────────────────

  @Get('badges')
  getBadges(@Request() req: any) {
    return this.service.getBadges(req.user.tenantId);
  }

  @Post('badges')
  @Roles('super_admin', 'tenant_admin')
  createBadge(@Request() req: any, @Body() dto: CreateBadgeDto) {
    return this.service.createBadge(req.user.tenantId, dto);
  }

  @Get('badges/user/:userId')
  getUserBadges(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.service.getUserBadges(req.user.tenantId, userId);
  }

  @Get('badges/mine')
  getMyBadges(@Request() req: any) {
    return this.service.getUserBadges(req.user.tenantId, req.user.userId);
  }

  @Post('badges/award')
  @Roles('super_admin', 'tenant_admin', 'manager')
  awardBadge(@Request() req: any, @Body() dto: AwardBadgeDto) {
    return this.service.awardBadge(req.user.tenantId, dto.userId, dto.badgeId, req.user.userId);
  }

  // ─── Points & Leaderboard ───────────────────────────────────────

  @Get('points/mine')
  getMyPoints(@Request() req: any) {
    return this.service.getUserPoints(req.user.tenantId, req.user.userId);
  }

  @Get('points/user/:userId')
  getUserPoints(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.service.getUserPoints(req.user.tenantId, userId);
  }

  @Get('leaderboard')
  getLeaderboard(
    @Request() req: any,
    @Query('period') period: 'week' | 'month' | 'quarter' | 'all',
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.service.getLeaderboard(req.user.tenantId, period || 'month', Math.min(limit, 50));
  }

  // ─── Stats ──────────────────────────────────────────────────────

  @Get('stats')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getStats(@Request() req: any) {
    return this.service.getStats(req.user.tenantId);
  }
}
