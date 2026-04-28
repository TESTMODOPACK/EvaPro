import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
import {
  CreateSubTemplateDto,
  UpdateSubTemplateDto,
  UpdateWeightsDto,
} from './dto/sub-template.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('templates')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  findAll(@Request() req: any) {
    const includeAll = req.user.role === 'super_admin' || req.user.role === 'tenant_admin';
    return this.templatesService.findAll(req.user.tenantId, includeAll);
  }

  // ─── Workflow (static routes MUST be before :id) ────────────────────

  @Post('propose')
  @Roles('super_admin', 'tenant_admin', 'manager')
  propose(@Request() req: any, @Body() dto: CreateTemplateDto) {
    return this.templatesService.propose(req.user.tenantId, req.user.userId, dto);
  }

  @Get('pending')
  @Roles('super_admin', 'tenant_admin')
  findPending(@Request() req: any) {
    return this.templatesService.findPending(req.user.tenantId);
  }

  @Post('generate-samples')
  @Roles('super_admin', 'tenant_admin')
  generateSamples(@Request() req: any) {
    return this.templatesService.generateSampleTemplates(req.user.tenantId, req.user.userId);
  }

  // ─── Parameterized routes ───────────────────────────────────────────

  @Get(':id/preview')
  @Roles('super_admin', 'tenant_admin', 'manager')
  async preview(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.templatesService.getPreview(id, req.user.tenantId);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang: string,
    @Request() req: any,
  ) {
    const template = await this.templatesService.findById(id, req.user.tenantId);
    // If a specific language is requested, return sections in that language
    if (lang && lang !== template.language) {
      const localizedSections = this.templatesService.getSectionsForLanguage(template, lang);
      return { ...template, sections: localizedSections, requestedLanguage: lang };
    }
    return template;
  }

  /** P2.6 — Cross-tenant defense (template create). */
  @Post()
  @Roles('super_admin', 'tenant_admin')
  create(@Request() req: any, @Body() dto: CreateTemplateDto) {
    const tenantId = resolveOperatingTenantId(req.user, (dto as any)?.tenantId);
    return this.templatesService.create(tenantId, req.user.userId, dto);
  }

  /** P5.2 — Secondary cross-tenant: super_admin → undefined. */
  @Patch(':id')
  @Roles('super_admin', 'tenant_admin')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateTemplateDto,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.update(id, tenantId, req.user.userId, dto);
  }

  @Get(':id/versions')
  @Roles('super_admin', 'tenant_admin')
  getVersionHistory(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.getVersionHistory(id, tenantId);
  }

  @Post(':id/restore/:version')
  @Roles('super_admin', 'tenant_admin')
  restoreVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('version') version: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.restoreVersion(id, tenantId, req.user.userId, parseInt(version, 10));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.remove(id, tenantId);
  }

  @Post(':id/duplicate')
  @Roles('super_admin', 'tenant_admin')
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.duplicate(id, tenantId, req.user.userId);
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

  // ─── Workflow: publish/reject (parameterized, must be after static) ─

  @Post(':id/publish')
  @Roles('super_admin', 'tenant_admin')
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { note?: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.publish(id, tenantId, req.user.userId, body?.note);
  }

  @Post(':id/reject')
  @Roles('super_admin', 'tenant_admin')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { note: string },
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.reject(id, tenantId, req.user.userId, body?.note);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Fase 3 (Opción A) — Subplantillas (form_sub_templates)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Devuelve la plantilla padre + sus subplantillas anidadas (ordenadas
   * por displayOrder). Si la plantilla tiene formato legacy con
   * applicableTo, lo migra inline al primer GET (one-time, idempotente).
   *
   * Usado por el editor con tabs.
   */
  @Get(':id/sub-templates')
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee', 'external')
  async getWithSubTemplates(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.findByIdWithSubTemplates(id, tenantId);
  }

  /** Crea una subplantilla nueva manualmente (ej. agregar `external` después). */
  @Post(':id/sub-templates')
  @Roles('super_admin', 'tenant_admin')
  createSubTemplate(
    @Param('id', ParseUUIDPipe) parentId: string,
    @Body() dto: CreateSubTemplateDto,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.createSubTemplate(parentId, tenantId, dto);
  }

  /** Actualiza una subplantilla específica (sections/weight/displayOrder/isActive). */
  @Patch('sub-templates/:subId')
  @Roles('super_admin', 'tenant_admin')
  updateSubTemplate(
    @Param('subId', ParseUUIDPipe) subId: string,
    @Body() dto: UpdateSubTemplateDto,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.updateSubTemplate(subId, tenantId, dto);
  }

  /** Elimina una subplantilla (hard delete). */
  @Delete('sub-templates/:subId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  deleteSubTemplate(
    @Param('subId', ParseUUIDPipe) subId: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.deleteSubTemplate(subId, tenantId);
  }

  /**
   * Update batch de pesos. Body: { weights: { manager: 0.4, self: 0.2, ... } }
   * Valida que la suma de pesos activos quede en 1.0 ± tolerancia.
   */
  @Put(':id/sub-templates/weights')
  @Roles('super_admin', 'tenant_admin')
  updateWeights(
    @Param('id', ParseUUIDPipe) parentId: string,
    @Body() dto: UpdateWeightsDto,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.templatesService.updateWeights(parentId, tenantId, dto);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Fase 3 (Opción A) - Bonus IA: sugerencia de distribucion
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Pide a Claude que sugiera distribucion de competencias entre los
   * relationTypes de la plantilla, con preguntas ejemplo por rol.
   * Retorna las sugerencias SIN persistirlas — el admin decide aplicar.
   */
  @Post(':id/suggest-distribution')
  @Roles('super_admin', 'tenant_admin')
  suggestDistribution(
    @Param('id', ParseUUIDPipe) templateId: string,
    @Request() req: any,
  ) {
    return this.templatesService.suggestCompetencyDistribution(
      templateId,
      req.user.tenantId,
      req.user.userId,
    );
  }

  /**
   * Aplica las sugerencias de IA. Body: { suggestions: { manager: [...], ... } }
   * El admin debio haber editado/aceptado las sugerencias antes de llamar.
   */
  @Post(':id/apply-suggestions')
  @Roles('super_admin', 'tenant_admin')
  applySuggestions(
    @Param('id', ParseUUIDPipe) templateId: string,
    @Body() body: { suggestions: any },
    @Request() req: any,
  ) {
    return this.templatesService.applySuggestions(
      templateId,
      req.user.tenantId,
      body.suggestions,
    );
  }
}
