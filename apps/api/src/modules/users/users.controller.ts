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

  /** GET /users?page=1&limit=50 */
  @Get()
  @Roles('super_admin', 'tenant_admin', 'manager', 'employee')
  findAll(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.usersService.findAll(req.user.tenantId, page, limit);
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
    return this.usersService.create(req.user.tenantId, dto);
  }

  /** POST /users/bulk-import */
  @Post('bulk-import')
  @Roles('super_admin', 'tenant_admin')
  bulkImport(@Request() req: any, @Body('csv') csv: string) {
    return this.usersService.bulkImport(req.user.tenantId, csv, req.user.userId);
  }

  /** GET /users/bulk-imports/:id */
  @Get('bulk-imports/:id')
  getBulkImport(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.getBulkImport(id, req.user.tenantId);
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

  // ─── User Notes (HR Reports) ───────────────────────────────────────────────

  /** GET /users/:id/notes */
  @Get(':id/notes')
  @Roles('super_admin', 'tenant_admin', 'manager')
  listNotes(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ) {
    return this.usersService.listNotes(req.user.tenantId, id);
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
