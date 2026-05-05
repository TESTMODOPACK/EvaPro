import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RecurringMetricsService } from './recurring-metrics.service';
import { CreateRecurringMetricDto } from './dto/create-recurring-metric.dto';
import { UpdateRecurringMetricDto } from './dto/update-recurring-metric.dto';
import { AddMeasurementDto } from './dto/add-measurement.dto';

/**
 * RecurringMetricsController — Audit P2, Tarea 10.
 *
 * Endpoints para métricas recurrentes (KPI semánticamente correctos).
 * Permisos:
 *   - Crear/listar/ver: cualquier rol autenticado
 *   - Editar/eliminar: owner, admin, manager (manager solo de sus
 *     reportes — TODO: validar manager scope si necesario)
 *   - Agregar medición: owner + admin/manager
 */
@Controller('recurring-metrics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class RecurringMetricsController {
  constructor(private readonly service: RecurringMetricsService) {}

  @Get()
  list(
    @Request() req: any,
    @Query('ownerUserId') ownerUserId?: string,
    @Query('isActive') isActive?: string,
  ) {
    const opts: { ownerUserId?: string; isActive?: boolean } = {};
    // Employees ven solo las propias
    if (req.user.role === 'employee' || req.user.role === 'external') {
      opts.ownerUserId = req.user.userId;
    } else if (ownerUserId) {
      opts.ownerUserId = ownerUserId;
    }
    if (isActive !== undefined) {
      opts.isActive = isActive === 'true' || isActive === '1';
    }
    return this.service.findAll(req.user.tenantId, opts);
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.findById(req.user.tenantId, id);
  }

  @Get(':id/state')
  getState(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.getCurrentState(req.user.tenantId, id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateRecurringMetricDto) {
    return this.service.create(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateRecurringMetricDto,
  ) {
    return this.service.update(req.user.tenantId, id, req.user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin', 'manager')
  remove(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) {
    return this.service.remove(req.user.tenantId, id, req.user.userId);
  }

  // ─── Mediciones ────────────────────────────────────────────────────

  @Post(':id/measurements')
  addMeasurement(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: AddMeasurementDto,
  ) {
    return this.service.addMeasurement(
      req.user.tenantId,
      id,
      req.user.userId,
      dto,
    );
  }

  @Get(':id/measurements')
  listMeasurements(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.service.listMeasurements(req.user.tenantId, id, limit ?? 50);
  }
}
