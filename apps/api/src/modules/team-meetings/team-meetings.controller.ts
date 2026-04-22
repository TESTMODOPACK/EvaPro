import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post,
  Request, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Feature } from '../../common/decorators/feature.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlanFeature } from '../../common/constants/plan-features';
import { FeatureGuard } from '../../common/guards/feature.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  AddAgendaTopicDto, CancelTeamMeetingDto, CompleteTeamMeetingDto,
  CreateTeamMeetingDto, RespondInvitationDto, UpdateTeamMeetingDto,
} from './dto/team-meeting.dto';
import { TeamMeetingsService } from './team-meetings.service';

/**
 * v3.1 Tema B — Controller para reuniones de equipo.
 *
 * Gated por PlanFeature.FEEDBACK (mismo plan que check-ins 1:1; no
 * inflamos planes por sub-feature). Permisos por rol + ownership se
 * aplican en el service.
 */
@Controller('team-meetings')
@UseGuards(AuthGuard('jwt'), RolesGuard, FeatureGuard)
@Feature(PlanFeature.FEEDBACK)
export class TeamMeetingsController {
  constructor(private readonly service: TeamMeetingsService) {}

  /** Crear reunión — admin o manager. */
  @Post()
  @Roles('super_admin', 'tenant_admin', 'manager')
  create(@Request() req: any, @Body() dto: CreateTeamMeetingDto) {
    return this.service.createMeeting(req.user.tenantId, req.user.userId, dto);
  }

  /** Listar reuniones visibles para el caller. */
  @Get()
  list(@Request() req: any) {
    return this.service.listMeetings(
      req.user.tenantId,
      req.user.userId,
      req.user.role,
    );
  }

  /** Detalle de una reunión. */
  @Get(':id')
  getOne(@Request() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getMeetingById(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
    );
  }

  /** Editar una reunión programada — solo organizador o admin. */
  @Patch(':id')
  @Roles('super_admin', 'tenant_admin', 'manager')
  update(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamMeetingDto,
  ) {
    return this.service.updateMeeting(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  /** Cancelar reunión programada — solo organizador o admin. */
  @Post(':id/cancel')
  @Roles('super_admin', 'tenant_admin', 'manager')
  cancel(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelTeamMeetingDto,
  ) {
    return this.service.cancelMeeting(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  /** Completar reunión — solo organizador o admin. */
  @Post(':id/complete')
  @Roles('super_admin', 'tenant_admin', 'manager')
  complete(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteTeamMeetingDto,
  ) {
    return this.service.completeMeeting(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }

  /** Responder invitación (accept/decline) — cualquier participante. */
  @Post(':id/respond')
  respond(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondInvitationDto,
  ) {
    return this.service.respondToInvitation(
      req.user.tenantId,
      id,
      req.user.userId,
      dto,
    );
  }

  /**
   * v3.1 — Edición retroactiva de una reunión COMPLETED (típicamente
   * auto-cerrada por el cron +5 días). Solo organizador o admin.
   */
  @Patch(':id/retroactive-info')
  @Roles('super_admin', 'tenant_admin', 'manager')
  editCompleted(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      notes?: string;
      minutes?: string;
      rating?: number;
      actionItems?: Array<{
        text: string;
        completed?: boolean;
        assigneeId?: string;
        assigneeName?: string;
        dueDate?: string;
      }>;
    },
  ) {
    return this.service.editCompletedMeeting(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      body || {},
    );
  }

  /** Agregar tema a la agenda — cualquier participante. */
  @Patch(':id/topics')
  addTopic(
    @Request() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddAgendaTopicDto,
  ) {
    return this.service.addAgendaTopic(
      req.user.tenantId,
      id,
      req.user.userId,
      req.user.role,
      dto,
    );
  }
}
