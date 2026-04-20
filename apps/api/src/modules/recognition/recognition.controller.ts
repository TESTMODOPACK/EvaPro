import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Request, Res,
  ParseUUIDPipe, ParseIntPipe, DefaultValuePipe,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RecognitionService } from './recognition.service';
import { CreateRecognitionDto, CreateBadgeDto, AwardBadgeDto, AddReactionDto } from './dto/recognition.dto';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('recognition')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RecognitionController {
  constructor(private readonly service: RecognitionService) {}

  // ─── Recognition Wall ────────────────────────────────────────────

  /** Export recognitions in CSV, XLSX, or PDF.
   *  P7.3 — Manager exporta solo reconocimientos relacionados con su equipo
   *  (fromUserId o toUserId ∈ {reportes directos, self}). Admin exporta todo. */
  @Get('export')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async exportRecognitions(@Request() req: any, @Query('format') format: string, @Res() res: Response) {
    const tenantId = req.user.tenantId;
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    const ext = format?.toLowerCase() || 'csv';
    if (ext === 'xlsx') {
      const buffer = await this.service.exportRecognitionsXlsx(tenantId, managerId);
      res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename=reconocimientos.xlsx' });
      return res.send(buffer);
    }
    if (ext === 'pdf') {
      const buffer = await this.service.exportRecognitionsPdf(tenantId, managerId);
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=reconocimientos.pdf' });
      return res.send(buffer);
    }
    const csv = await this.service.exportRecognitionsCsv(tenantId, managerId);
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

  /** P2.5 — Cross-tenant defense: super_admin debe pasar dto.tenantId. */
  @Post('badges')
  @Roles('super_admin', 'tenant_admin')
  createBadge(@Request() req: any, @Body() dto: CreateBadgeDto) {
    const tenantId = resolveOperatingTenantId(req.user, dto.tenantId);
    return this.service.createBadge(tenantId, dto);
  }

  /** P5.3 — Secondary cross-tenant: super_admin → undefined.
   *  Editar un badge (nombre, icono, criterios, etc.). No toca isActive. */
  @Patch('badges/:id')
  @Roles('super_admin', 'tenant_admin')
  updateBadge(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: Partial<CreateBadgeDto>,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateBadge(tenantId, id, dto);
  }

  /** Soft-delete: isActive=false + deactivatedAt=now. Preserva referencias
   *  históricas (user_badges earned con ese badge siguen intactas). */
  @Delete('badges/:id')
  @Roles('super_admin', 'tenant_admin')
  deleteBadge(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.softDeleteBadge(tenantId, id);
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
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.awardBadge(tenantId, dto.userId, dto.badgeId, req.user.userId);
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

  /**
   * Ops-only: recompute the denormalized user_points_summary table for this
   * tenant from the ledger. Safe to re-run; used on first cutover after the
   * summary table is introduced, or if an external event ever corrupts the
   * per-user totals.
   */
  @Post('points-summary/backfill')
  @Roles('super_admin', 'tenant_admin')
  backfillPointsSummary(@Request() req: any) {
    return this.service.backfillUserPointsSummary(req.user.tenantId);
  }

  // ─── Stats ──────────────────────────────────────────────────────

  /** P7.3 — Manager ve stats filtrados a reconocimientos de su equipo. */
  @Get('stats')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getStats(@Request() req: any) {
    const managerId = req.user.role === 'manager' ? req.user.userId : undefined;
    return this.service.getStats(req.user.tenantId, managerId);
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
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.approveRecognition(tenantId, id, req.user.userId, dto.approved);
  }

  // ─── Redemption Catalog ──────────────────────────────────────────
  @Get('catalog')
  listCatalog(@Request() req: any) {
    const isAdmin = ['super_admin', 'tenant_admin'].includes(req.user.role);
    return this.service.listRedemptionItems(req.user.tenantId, isAdmin);
  }

  /** P2.5 — Cross-tenant defense (catalog item). */
  @Post('catalog')
  @Roles('super_admin', 'tenant_admin')
  createCatalogItem(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.service.createRedemptionItem(tenantId, dto);
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
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateRedemptionItem(tenantId, id, dto);
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
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateRedemptionStatus(tenantId, id, dto.status);
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

  /** P2.5 — Cross-tenant defense (challenge). */
  @Post('challenges')
  @Roles('super_admin', 'tenant_admin')
  createChallenge(@Request() req: any, @Body() dto: any) {
    const tenantId = resolveOperatingTenantId(req.user, dto?.tenantId);
    return this.service.createChallenge(tenantId, dto);
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
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.updateChallenge(tenantId, id, dto);
  }

  /** Soft-delete: isActive=false + deactivatedAt=now. No borra histórico. */
  @Delete('challenges/:id')
  @Roles('super_admin', 'tenant_admin')
  deleteChallenge(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.service.softDeleteChallenge(tenantId, id);
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
