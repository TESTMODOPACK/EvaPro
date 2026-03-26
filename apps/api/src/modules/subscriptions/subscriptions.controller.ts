import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
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
  @Roles('super_admin')
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
  planPricing(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptionsService.calculatePriceForPeriod(id, 'monthly' as any);
  }

  // ─── My Subscription (for tenant_admin) ────────────────────────────────

  @Get('my-subscription')
  @Roles('tenant_admin', 'manager', 'employee', 'external')
  mySubscription(@Request() req: any) {
    return this.subscriptionsService.findMySubscription(req.user.tenantId);
  }

  @Get('my-payments')
  @Roles('tenant_admin', 'manager', 'employee', 'external')
  myPayments(@Request() req: any) {
    return this.subscriptionsService.getPaymentHistory(req.user.tenantId);
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
}
