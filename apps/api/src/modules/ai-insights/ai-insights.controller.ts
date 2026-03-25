import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Feature } from '../../common/decorators/feature.decorator';
import { AiInsightsService } from './ai-insights.service';
import { InsightType } from './entities/ai-insight.entity';

@Controller('ai')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature('IA')
export class AiInsightsController {
  constructor(private readonly aiService: AiInsightsService) {}

  private validateAccess(req: any, targetUserId: string) {
    const { role, userId } = req.user;
    if (role === 'employee' && userId !== targetUserId) {
      throw new ForbiddenException('Solo puedes ver tus propios análisis de IA');
    }
    if (role === 'external') {
      throw new ForbiddenException('Los asesores externos no tienen acceso a análisis de IA');
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  @Post('summary/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  generateSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.aiService.generateSummary(req.user.tenantId, cycleId, userId, req.user.userId);
  }

  @Get('summary/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getSummary(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    this.validateAccess(req, userId);
    return this.aiService.getInsight(req.user.tenantId, InsightType.SUMMARY, cycleId, userId);
  }

  // ─── Bias Detection ────────────────────────────────────────────────────

  @Post('bias/:cycleId')
  @Roles('super_admin', 'tenant_admin')
  analyzeBias(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.aiService.analyzeBias(req.user.tenantId, cycleId, req.user.userId);
  }

  @Get('bias/:cycleId')
  @Roles('super_admin', 'tenant_admin')
  getBias(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.aiService.getInsight(req.user.tenantId, InsightType.BIAS, cycleId);
  }

  // ─── Suggestions ───────────────────────────────────────────────────────

  @Post('suggestions/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  generateSuggestions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.aiService.generateSuggestions(req.user.tenantId, cycleId, userId, req.user.userId);
  }

  @Get('suggestions/:userId/:cycleId')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  getSuggestions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    this.validateAccess(req, userId);
    return this.aiService.getInsight(req.user.tenantId, InsightType.SUGGESTIONS, cycleId, userId);
  }

  // ─── Cache Management ─────────────────────────────────────────────────

  @Delete('cache/:cycleId')
  @Roles('super_admin', 'tenant_admin')
  clearCycleCache(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('type') type: string,
    @Query('userId') userId: string,
    @Request() req: any,
  ) {
    const insightType = type === 'bias' ? InsightType.BIAS : type === 'suggestions' ? InsightType.SUGGESTIONS : InsightType.SUMMARY;
    return this.aiService.clearCache(req.user.tenantId, insightType, cycleId, userId || undefined);
  }
}
