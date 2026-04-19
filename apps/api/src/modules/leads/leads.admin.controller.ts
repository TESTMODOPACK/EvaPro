import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LeadsService } from './leads.service';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { LeadStatus } from './entities/lead.entity';

/**
 * Admin endpoints para el pipeline de leads — solo super_admin.
 *
 * Leads son prospects pre-venta que no pertenecen a ningún tenant todavía,
 * por lo que no hay patrón cross-tenant: siempre son visibles/operables por
 * super_admin exclusivamente. Los tenant_admin NO tienen visibilidad sobre
 * leads de Ascenda.
 */
@Controller('leads')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class LeadsAdminController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get('stats')
  getStats() {
    return this.leadsService.getStats();
  }

  @Get()
  findAll(
    @Query('status') status?: LeadStatus,
    @Query('origin') origin?: string,
  ) {
    return this.leadsService.findAll({ status, origin });
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.leadsService.findById(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(id, dto, req.user.userId, req.user.tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.leadsService.remove(id, req.user.userId, req.user.tenantId);
  }
}
