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
  Request,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CreateDepartureDto } from './dto/create-departure.dto';
import { CreateMovementDto } from './dto/create-movement.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
    @Query('role') role?: string,
    @Query('position') position?: string,
    @Query('status') status?: string,
    @Query('tenantId') filterTenantId?: string,
  ) {
    const filters = (search || department || role || position || status)
      ? { search, department, role, position, status }
      : undefined;
    // super_admin can query any tenant's users via ?tenantId=
    const tenantId = (req.user.role === 'super_admin' && filterTenantId) ? filterTenantId : req.user.tenantId;
    return this.usersService.findAll(tenantId, page, limit, filters);
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
    // super_admin can create users in any tenant by passing tenantId in body
    const tenantId = (req.user.role === 'super_admin' && (dto as any).tenantId) ? (dto as any).tenantId : req.user.tenantId;
    return this.usersService.create(tenantId, dto);
  }

  /** POST /users/bulk-import */
  @Post('bulk-import')
  @Roles('super_admin', 'tenant_admin')
  bulkImport(@Request() req: any, @Body('csv') csv: string) {
    return this.usersService.bulkImport(req.user.tenantId, csv, req.user.userId);
  }

  /** POST /users/invite-bulk — invite multiple users by email list */
  @Post('invite-bulk')
  @Roles('super_admin', 'tenant_admin')
  inviteBulk(
    @Request() req: any,
    @Body() body: { emails: string[]; role?: string },
  ) {
    return this.usersService.inviteBulk(req.user.tenantId, body.emails ?? [], body.role);
  }

  /** POST /users/:id/resend-invite */
  @Post(':id/resend-invite')
  @Roles('super_admin', 'tenant_admin')
  resendInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.resendInvite(req.user.tenantId, id);
  }

  /** GET /users/bulk-imports/:id */
  @Get('bulk-imports/:id')
  getBulkImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.getBulkImport(id, req.user.tenantId);
  }

  /** POST /users/normalize-departments — Fix user departments that don't match configured list */
  @Post('normalize-departments')
  @Roles('super_admin', 'tenant_admin')
  normalizeDepartments(
    @Request() req: any,
    @Query('apply') apply?: string,
  ) {
    return this.usersService.normalizeDepartments(req.user.tenantId, apply === 'true');
  }

  /** POST /users/fill-fake-ruts — Generate valid fake RUTs for users without one */
  @Post('fill-fake-ruts')
  @Roles('super_admin', 'tenant_admin')
  fillFakeRuts(@Request() req: any) {
    const tenantId = req.user.role === 'super_admin' ? undefined : req.user.tenantId;
    return this.usersService.fillFakeRuts(tenantId);
  }

  /** PATCH /users/:id */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(id, req.user.tenantId, dto, req.user.role);
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
