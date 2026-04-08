import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  ParseUUIDPipe,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  // ─── Plans ─────────────────────────────────────────────────────────────

  @Get('plans')
  @Roles('super_admin', 'tenant_admin')
  findAllPlans() {
    return this.subscriptionsService.findAllPlans();
  }

  @Post('plans')
  @Roles('super_admin')
  createPlan(@Body() dto: any) {
    return this.subscriptionsService.createPlan(dto);
  }

  @Patch('plans/:id')
  @Roles('super_admin')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.subscriptionsService.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deactivatePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.deactivatePlan(id);
  }

  // ─── Plan Pricing ──────────────────────────────────────────────────────

  @Get('plans/:id/pricing')
  @Roles('super_admin', 'tenant_admin')
  planPricing(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('period') period?: string,
  ) {
    const validPeriod = ['monthly', 'quarterly', 'semiannual', 'annual'].includes(period || '')
      ? period as any
      : 'monthly';
    return this.subscriptionsService.calculatePriceForPeriod(id, validPeriod);
  }

  // ─── My Subscription (for tenant_admin) ────────────────────────────────

  @Get('my-subscription')
  @Roles('tenant_admin', 'manager', 'employee', 'external')
  mySubscription(@Request() req: any) {
    return this.subscriptionsService.findMySubscription(req.user.tenantId);
  }

  @Get('my-payments')
  @Roles('tenant_admin')
  myPayments(@Request() req: any) {
    return this.subscriptionsService.getPaymentHistory(req.user.tenantId);
  }

  @Get('my-subscription/proration')
  @Roles('tenant_admin')
  getProration(@Request() req: any) {
    return this.subscriptionsService.calculateProration(req.user.tenantId);
  }

  // ─── AI Add-on Packs ──────────────────────────────────────────────────

  @Get('ai-packs')
  @Roles('super_admin', 'tenant_admin')
  getAiPacks() {
    return this.subscriptionsService.getAiPacks();
  }

  @Get('ai-addon')
  @Roles('super_admin', 'tenant_admin')
  getAiAddon(@Request() req: any) {
    return this.subscriptionsService.getAiAddon(req.user.tenantId);
  }

  @Patch('ai-addon')
  @Roles('super_admin', 'tenant_admin')
  setAiAddon(
    @Request() req: any,
    @Body() body: { packId: string | null },
  ) {
    return this.subscriptionsService.setAiAddon(req.user.tenantId, body.packId, req.user.userId);
  }

  @Patch('my-subscription/auto-renew')
  @Roles('tenant_admin')
  toggleAutoRenew(
    @Request() req: any,
    @Body() body: { autoRenew: boolean },
  ) {
    return this.subscriptionsService.toggleAutoRenew(req.user.tenantId, body.autoRenew);
  }

  // ─── Subscription Requests ─────────────────────────────────────────────

  @Post('requests')
  @Roles('tenant_admin')
  createRequest(
    @Request() req: any,
    @Body() dto: { type: 'plan_change' | 'cancel'; targetPlan?: string; targetBillingPeriod?: string; notes?: string },
  ) {
    return this.subscriptionsService.createRequest(req.user.tenantId, req.user.userId, dto);
  }

  @Get('requests/my')
  @Roles('tenant_admin')
  myRequests(@Request() req: any) {
    return this.subscriptionsService.getMyRequests(req.user.tenantId);
  }

  @Get('requests/pending')
  @Roles('super_admin')
  pendingRequests() {
    return this.subscriptionsService.getPendingRequests();
  }

  @Patch('requests/:id/approve')
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  approveRequest(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.subscriptionsService.approveRequest(id, req.user.userId);
  }

  @Patch('requests/:id/reject')
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  rejectRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { reason?: string },
  ) {
    return this.subscriptionsService.rejectRequest(id, req.user.userId, body.reason || '');
  }

  // ─── Subscriptions ─────────────────────────────────────────────────────

  @Get('stats')
  @Roles('super_admin')
  getStats() {
    return this.subscriptionsService.getStats();
  }

  @Get()
  @Roles('super_admin')
  findAll() {
    return this.subscriptionsService.findAll();
  }

  @Get(':id')
  @Roles('super_admin')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.findById(id);
  }

  @Post()
  @Roles('super_admin')
  create(@Body() dto: any, @Request() req: any) {
    return this.subscriptionsService.create(dto, req.user?.userId);
  }

  @Patch(':id')
  @Roles('super_admin')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: any, @Request() req: any) {
    return this.subscriptionsService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  @Roles('super_admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.subscriptionsService.cancel(id, req.user?.userId);
  }

  // ─── Payments ─────────────────────────────────────────────────────────

  @Get(':id/payments')
  @Roles('super_admin')
  getPayments(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.getPaymentsBySubscription(id);
  }

  @Post(':id/payments')
  @Roles('super_admin')
  registerPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
    @Request() req: any,
  ) {
    return this.subscriptionsService.registerPayment(id, dto, req.user?.userId);
  }

  @Patch('payments/:paymentId')
  @Roles('super_admin')
  updatePayment(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() dto: any,
    @Request() req: any,
  ) {
    return this.subscriptionsService.updatePayment(paymentId, dto, req.user?.userId);
  }

  @Delete('payments/:paymentId')
  @Roles('super_admin')
  deletePayment(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Request() req: any,
  ) {
    return this.subscriptionsService.deletePayment(paymentId, req.user?.userId);
  }
}
