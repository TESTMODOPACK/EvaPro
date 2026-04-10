import {
  Controller, Get, Post, Patch, Body, Param, Query, UseGuards, Request, Res,
  ParseUUIDPipe, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { Response } from 'express';
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

  /** Export recognitions in CSV, XLSX, or PDF */
  @Get('export')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async exportRecognitions(@Request() req: any, @Query('format') format: string, @Res() res: Response) {
    const tenantId = req.user.tenantId;
    const ext = format?.toLowerCase() || 'csv';
    if (ext === 'xlsx') {
      const buffer = await this.service.exportRecognitionsXlsx(tenantId);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=reconocimientos.xlsx' });
      return res.send(buffer);
    }
    if (ext === 'pdf') {
      const buffer = await this.service.exportRecognitionsPdf(tenantId);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=reconocimientos.pdf' });
      return res.send(buffer);
    }
    const csv = await this.service.exportRecognitionsCsv(tenantId);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename=reconocimientos.csv' });
    return res.send(csv);
  }

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
    return this.service.addReaction(req.user.tenantId, id, req.user.userId, dto.emoji);
  }

  // ─── Badges — IMPORTANT: /mine BEFORE /:userId to avoid route shadowing ──

  @Get('badges')
  getBadges(@Request() req: any) {
    return this.service.getBadges(req.user.tenantId);
  }

  @Post('badges')
  @Roles('super_admin', 'tenant_admin')
  createBadge(@Request() req: any, @Body() dto: CreateBadgeDto) {
    return this.service.createBadge(req.user.tenantId, dto);
  }

  @Get('badges/mine')
  getMyBadges(@Request() req: any) {
    return this.service.getUserBadges(req.user.tenantId, req.user.userId);
  }

  @Get('badges/user/:userId')
  getUserBadges(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.service.getUserBadges(req.user.tenantId, userId);
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
    @Query('period') period: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    const validPeriods = ['week', 'month', 'year', 'all'];
    const safePeriod = validPeriods.includes(period) ? period as any : 'year';
    return this.service.getLeaderboard(req.user.tenantId, safePeriod, Math.min(limit, 50));
  }

  @Get('leaderboard/historical')
  getHistoricalRanking(@Request() req: any) {
    return this.service.getHistoricalRanking(req.user.tenantId);
  }

  // ─── Stats ──────────────────────────────────────────────────────

  @Get('stats')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getStats(@Request() req: any) {
    return this.service.getStats(req.user.tenantId);
  }

  // ─── Points Budget ──────────────────────────────────────────────
  @Get('budget/mine')
  getMyBudget(@Request() req: any) {
    return this.service.getUserBudget(req.user.tenantId, req.user.userId);
  }

  // ─── Monetary Approval ──────────────────────────────────────────
  @Get('approvals/pending')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getPendingApprovals(@Request() req: any) {
    return this.service.getPendingApprovals(req.user.tenantId);
  }

  @Post(':id/approve')
  @Roles('super_admin', 'tenant_admin', 'manager')
  approveRecognition(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { approved: boolean },
  ) {
    return this.service.approveRecognition(req.user.tenantId, id, req.user.userId, dto.approved);
  }

  // ─── Redemption Catalog ──────────────────────────────────────────
  @Get('catalog')
  listCatalog(@Request() req: any) {
    const isAdmin = ['super_admin', 'tenant_admin'].includes(req.user.role);
    return this.service.listRedemptionItems(req.user.tenantId, isAdmin);
  }

  @Post('catalog')
  @Roles('super_admin', 'tenant_admin')
  createCatalogItem(@Request() req: any, @Body() dto: any) {
    return this.service.createRedemptionItem(req.user.tenantId, dto);
  }

  @Get('catalog/:id/redemptions')
  @Roles('super_admin', 'tenant_admin')
  getItemRedemptions(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.getItemRedemptions(req.user.tenantId, id);
  }

  @Patch('catalog/:id')
  @Roles('super_admin', 'tenant_admin')
  updateCatalogItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.updateRedemptionItem(req.user.tenantId, id, dto);
  }

  @Post('redeem/:itemId')
  redeemItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Request() req: any,
  ) {
    return this.service.redeemItem(req.user.tenantId, req.user.userId, itemId);
  }

  @Get('redemptions/mine')
  getMyRedemptions(@Request() req: any) {
    return this.service.getUserRedemptions(req.user.tenantId, req.user.userId);
  }

  @Patch('redemptions/:id')
  @Roles('super_admin', 'tenant_admin')
  updateRedemptionStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: { status: string },
  ) {
    return this.service.updateRedemptionStatus(req.user.tenantId, id, dto.status);
  }

  // ─── Challenges (F16 Gamification) ──────────────────────────────

  @Get('challenges')
  listChallenges(@Request() req: any) {
    return this.service.listChallenges(req.user.tenantId);
  }

  @Get('challenges/mine')
  getMyChallenges(@Request() req: any) {
    return this.service.getUserChallenges(req.user.tenantId, req.user.userId);
  }

  @Post('challenges')
  @Roles('super_admin', 'tenant_admin')
  createChallenge(@Request() req: any, @Body() dto: any) {
    return this.service.createChallenge(req.user.tenantId, dto);
  }

  @Get('challenges/:id/participants')
  @Roles('super_admin', 'tenant_admin')
  getChallengeParticipants(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.getChallengeParticipants(req.user.tenantId, id);
  }

  @Patch('challenges/:id')
  @Roles('super_admin', 'tenant_admin')
  updateChallenge(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: any,
  ) {
    return this.service.updateChallenge(req.user.tenantId, id, dto);
  }

  // ─── Leaderboard Opt-in ──────────────────────────────────────────

  @Get('leaderboard-optin')
  getLeaderboardOptIn(
    @Request() req: any,
    @Query('period') period: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('department') department: string,
    @Query('departmentId') departmentId: string,
  ) {
    const validPeriods = ['week', 'month', 'year', 'all'];
    const safePeriod = validPeriods.includes(period) ? period : 'year';
    return this.service.getLeaderboardOptIn(req.user.tenantId, safePeriod, Math.min(limit, 50), department || undefined, departmentId || undefined);
  }

  @Post('leaderboard-optin/toggle')
  toggleOptIn(@Request() req: any, @Body() dto: { optIn: boolean }) {
    return this.service.toggleLeaderboardOptIn(req.user.tenantId, req.user.userId, dto.optIn);
  }
}
