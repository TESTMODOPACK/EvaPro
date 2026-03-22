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
@Roles('super_admin', 'tenant_admin')
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
  create(@Request() req: any, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(req.user.tenantId, req.user.userId, dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, req.user.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.templatesService.remove(id, req.user.tenantId);
  }

  @Post(':id/duplicate')
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.templatesService.duplicate(id, req.user.tenantId, req.user.userId);
  }
}
