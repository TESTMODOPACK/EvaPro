import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('templates')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  findAll(@Request() req: any) {
    return this.templatesService.findAll(req.user.tenantId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.templatesService.findById(id, req.user.tenantId);
  }

  @Post()
  @Roles('super_admin', 'tenant_admin')
  create(@Request() req: any, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Patch(':id')
  @Roles('super_admin', 'tenant_admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, req.user.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.templatesService.remove(id, req.user.tenantId);
  }

  @Post(':id/duplicate')
  @Roles('super_admin', 'tenant_admin')
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.templatesService.duplicate(id, req.user.tenantId, req.user.userId);
  }

  @Post('import-csv')
  @Roles('super_admin', 'tenant_admin')
  importCsv(
    @Request() req: any,
    @Body() body: { name: string; description?: string; csvData: string },
  ) {
    return this.templatesService.importFromCsv(
      req.user.tenantId,
      req.user.userId,
      body.name,
      body.description || '',
      body.csvData,
    );
  }
}
