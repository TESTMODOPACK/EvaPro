import { Controller, Get, Query, UseGuards, Request, ParseUUIDPipe } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { DeiService } from './dei.service';

@Controller('dei')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin', 'tenant_admin')
export class DeiController {
  constructor(private readonly deiService: DeiService) {}

  @Get('demographics')
  getDemographics(@Request() req: any) {
    return this.deiService.getDemographicOverview(req.user.tenantId);
  }

  @Get('equity')
  getEquity(
    @Request() req: any,
    @Query('cycleId', ParseUUIDPipe) cycleId: string,
  ) {
    return this.deiService.getEquityAnalysis(req.user.tenantId, cycleId);
  }

  @Get('gap-report')
  getGapReport(
    @Request() req: any,
    @Query('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('dimension') dimension: string,
  ) {
    return this.deiService.getGapReport(req.user.tenantId, cycleId, dimension || 'gender');
  }
}
