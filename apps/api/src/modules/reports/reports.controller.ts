import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin', 'tenant_admin', 'manager')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('cycle/:cycleId/summary')
  cycleSummary(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Request() req: any,
  ) {
    return this.reportsService.cycleSummary(cycleId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/individual/:userId')
  individualResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Request() req: any,
  ) {
    return this.reportsService.individualResults(cycleId, userId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/team/:managerId')
  teamResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('managerId', ParseUUIDPipe) managerId: string,
    @Request() req: any,
  ) {
    return this.reportsService.teamResults(cycleId, managerId, req.user.tenantId);
  }

  @Get('cycle/:cycleId/export')
  async exportResults(
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Query('format') format: string,
    @Request() req: any,
    @Res() res: Response,
  ) {
    const csv = await this.reportsService.exportCsv(cycleId, req.user.tenantId);

    if (format === 'pdf') {
      // PDF generation with basic HTML approach for now
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=report-${cycleId}.csv`);
      return res.send(csv);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=report-${cycleId}.csv`);
    return res.send(csv);
  }
}
