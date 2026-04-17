import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepartureDto } from './dto/create-departure.dto';
import { UpdateDepartureDto } from './dto/update-departure.dto';
import { ReactivateUserDto } from './dto/reactivate-user.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UploadsService } from '../uploads/uploads.service';
import { resolveOperatingTenantId } from '../../common/utils/tenant-scope';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly uploadsService: UploadsService,
  ) {}

  /** GET /users/me */
  @Get('me')
  findMe(@Request() req: any) {
    return this.usersService.findById(req.user.userId);
  }

  /** GET /users?page=1&limit=10&search=ana&department=Ventas&role=employee&status=active */
  @Get()
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findAll(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('department') department?: string,
    @Query('departmentId') departmentId?: string,
    @Query('role') role?: string,
    @Query('position') position?: string,
    @Query('status') status?: string,
    @Query('tenantId') filterTenantId?: string,
  ) {
    const filters = (search || department || departmentId || role || position || status)
      ? { search, department, departmentId, role, position, status }
      : undefined;
    // super_admin can query any tenant's users via ?tenantId=
    const tenantId = (req.user.role === 'super_admin' && filterTenantId) ? filterTenantId : req.user.tenantId;
    return this.usersService.findAll(tenantId, page, limit, filters);
  }

  /** POST /users/me/cv — Upload CV (PDF/DOCX, max 5MB) */
  @Post('me/cv')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadCv(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    if (!file) throw new BadRequestException('No se envió ningún archivo');
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowed.includes(file.mimetype)) throw new BadRequestException('Solo se permiten archivos PDF o Word (.docx)');
    const result = await this.uploadsService.uploadFile(file, req.user.tenantId, `users/${req.user.userId}/cv`);
    await this.usersService.updateCv(req.user.userId, req.user.tenantId, result.url, file.originalname);
    return { cvUrl: result.url, cvFileName: file.originalname };
  }

  /** DELETE /users/me/cv — Remove CV */
  @Delete('me/cv')
  @HttpCode(HttpStatus.OK)
  async deleteCv(@Request() req: any) {
    await this.usersService.updateCv(req.user.userId, req.user.tenantId, null, null);
    return { deleted: true };
  }

  /** GET /users/org-chart — Hierarchical org chart tree */
  @Get('org-chart')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getOrgChart(@Request() req: any) {
    return this.usersService.getOrgChart(req.user.tenantId);
  }

  /** GET /users/:id */
  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    // super_admin can see any user; others only their tenant's users
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.usersService.findByIdScoped(id, tenantId);
  }

  /** POST /users */
  @Post()
  @Roles('super_admin', 'tenant_admin')
  create(@Request() req: any, @Body() dto: CreateUserDto) {
    let tenantId: string;
    if (req.user.role === 'super_admin') {
      // super_admin MUST specify tenantId explicitly. We used to fall back to
      // req.user.tenantId silently, but if the super_admin's user row had a
      // residual tenantId from an old seed (it had tenantId=<demo_tenant_id>),
      // every new user was silently created in Demo Company — a cross-tenant
      // leak. Fail loud if the body didn't carry it. CreateUserDto now
      // whitelists the field so the global ValidationPipe no longer strips it.
      if (!dto.tenantId) {
        throw new BadRequestException(
          'super_admin debe especificar tenantId en el body para crear usuarios.',
        );
      }
      tenantId = dto.tenantId;
    } else {
      // tenant_admin: always use their own tenantId. If the body tries to
      // smuggle a different tenantId, ignore it silently (they can't create
      // cross-tenant).
      tenantId = req.user.tenantId;
    }
    return this.usersService.create(tenantId, dto);
  }

  /** POST /users/bulk-import
   *
   * Importa usuarios masivos desde CSV. super_admin debe especificar tenantId
   * explícitamente (body o ?tenantId=) para evitar fugas cross-tenant.
   * tenant_admin siempre importa a su propio tenant (ignora body.tenantId).
   */
  @Post('bulk-import')
  @Roles('super_admin', 'tenant_admin')
  bulkImport(
    @Request() req: any,
    @Body() body: { csv: string; tenantId?: string },
    @Query('tenantId') qTenantId?: string,
  ) {
    const tenantId = resolveOperatingTenantId(req.user, body?.tenantId ?? qTenantId);
    return this.usersService.bulkImport(tenantId, body?.csv, req.user.userId);
  }

  /** POST /users/invite-bulk — invite multiple users by email list
   *
   * super_admin debe pasar tenantId en el body para indicar a qué tenant
   * pertenecen los invitados. tenant_admin invita a su propio tenant.
   */
  @Post('invite-bulk')
  @Roles('super_admin', 'tenant_admin')
  inviteBulk(
    @Request() req: any,
    @Body() body: { emails: string[]; role?: string; tenantId?: string },
  ) {
    const tenantId = resolveOperatingTenantId(req.user, body?.tenantId);
    return this.usersService.inviteBulk(tenantId, body?.emails ?? [], body?.role);
  }

  /** POST /users/:id/resend-invite
   *
   * Reenvía invitación (con nueva password temporal) al user objetivo.
   * super_admin puede reenviar a usuarios de cualquier tenant (pasa
   * tenantId=undefined al service, que busca por id sin filtrar por tenant).
   * tenant_admin solo puede reenviar a usuarios de su tenant.
   */
  @Post(':id/resend-invite')
  @Roles('super_admin', 'tenant_admin')
  resendInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.usersService.resendInvite(id, tenantId);
  }

  /** GET /users/bulk-imports/:id */
  @Get('bulk-imports/:id')
  getBulkImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.getBulkImport(id, req.user.tenantId);
  }

  /** POST /users/normalize-departments — Fix user departments that don't match configured list
   *
   * super_admin debe pasar ?tenantId= para indicar sobre qué tenant operar.
   * tenant_admin normaliza departamentos de su propio tenant.
   */
  @Post('normalize-departments')
  @Roles('super_admin', 'tenant_admin')
  normalizeDepartments(
    @Request() req: any,
    @Query('apply') apply?: string,
    @Query('tenantId') qTenantId?: string,
  ) {
    const tenantId = resolveOperatingTenantId(req.user, qTenantId);
    return this.usersService.normalizeDepartments(tenantId, apply === 'true');
  }

  /** POST /users/fill-fake-ruts — Generate valid fake RUTs for users without one */
  @Post('fill-fake-ruts')
  @Roles('super_admin', 'tenant_admin')
  fillFakeRuts(@Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.usersService.fillFakeRuts(tenantId);
  }

  /** PATCH /users/:id — admins pueden editar cualquier user del tenant;
   *  usuarios no-admin solo pueden editar su propio perfil (validacion en el
   *  service). */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, req.user.tenantId, dto, req.user.role, req.user.userId);
  }

  /** DELETE /users/:id  (soft delete – deactivates) */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.remove(id, req.user.tenantId, req.user.role);
  }

  // ─── Departure Tracking ────────────────────────────────────────────────────

  /** POST /users/:id/departure — Register departure with reason/type */
  @Post(':id/departure')
  @Roles('super_admin', 'tenant_admin')
  registerDeparture(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: CreateDepartureDto,
  ) {
    return this.usersService.registerDeparture(id, req.user.tenantId, dto, req.user.userId);
  }

  /** GET /users/:id/departures — Departure history */
  @Get(':id/departures')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getUserDepartures(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.getUserDepartures(id, req.user.tenantId);
  }

  // ─── Stage C: Reactivación / Edit / Cancel departure ────────────────────

  /** POST /users/:id/reactivate — Reactivar usuario desvinculado */
  @Post(':id/reactivate')
  @Roles('super_admin', 'tenant_admin')
  reactivateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: ReactivateUserDto,
  ) {
    return this.usersService.reactivateUser(id, req.user.tenantId, dto, req.user.userId);
  }

  /** PATCH /users/:id/departures/:depId — Editar categoría/detalle/rehire */
  @Patch(':id/departures/:depId')
  @Roles('super_admin', 'tenant_admin')
  updateDeparture(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('depId', ParseUUIDPipe) depId: string,
    @Request() req: any,
    @Body() dto: UpdateDepartureDto,
  ) {
    return this.usersService.updateDeparture(id, depId, req.user.tenantId, dto, req.user.userId);
  }

  /** DELETE /users/:id/departures/:depId — Cancelar desvinculación (soft rollback).
   *  Consistente con registrar/editar/reactivar: el tenant_admin puede corregir
   *  sus propios errores. super_admin se mantiene por patrón transversal del
   *  módulo (rol de soporte). Ver docs/FASES_PENDIENTES.md para la
   *  segregación futura del rol super_admin. */
  @Delete(':id/departures/:depId')
  @Roles('super_admin', 'tenant_admin')
  cancelDeparture(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('depId', ParseUUIDPipe) depId: string,
    @Request() req: any,
    @Body() body: { reason?: string } = {},
  ) {
    return this.usersService.cancelDeparture(id, depId, req.user.tenantId, req.user.userId, body.reason);
  }

  // ─── Internal Movement Tracking ───────────────────────────────────────────

  /** POST /users/:id/movement — Register manual internal movement */
  @Post(':id/movement')
  @Roles('super_admin', 'tenant_admin', 'manager')
  registerMovement(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: CreateMovementDto,
  ) {
    return this.usersService.registerMovement(id, req.user.tenantId, dto, req.user.userId);
  }

  /** GET /users/:id/movements — Movement history */
  @Get(':id/movements')
  @Roles('super_admin', 'tenant_admin', 'manager')
  getUserMovements(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.getUserMovements(id, req.user.tenantId);
  }

  // ─── User Notes (HR Reports) ───────────────────────────────────────────────

  /** GET /users/:id/notes */
  @Get(':id/notes')
  @Roles('super_admin', 'tenant_admin', 'manager')
  listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.listNotes(req.user.tenantId, id, req.user.role);
  }

  /** POST /users/:id/notes */
  @Post(':id/notes')
  @Roles('super_admin', 'tenant_admin', 'manager')
  createNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() body: { title: string; content: string; category?: string; isConfidential?: boolean },
  ) {
    return this.usersService.createNote(req.user.tenantId, id, req.user.userId, body);
  }

  /** PATCH /users/:id/notes/:noteId */
  @Patch(':id/notes/:noteId')
  @Roles('super_admin', 'tenant_admin', 'manager')
  updateNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Request() req: any,
    @Body() body: { title?: string; content?: string; category?: string; isConfidential?: boolean },
  ) {
    return this.usersService.updateNote(noteId, req.user.tenantId, body);
  }

  /** DELETE /users/:id/notes/:noteId */
  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('super_admin', 'tenant_admin')
  deleteNote(
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Request() req: any,
  ) {
    return this.usersService.deleteNote(noteId, req.user.tenantId);
  }
}
