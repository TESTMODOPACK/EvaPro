import {
  BadRequestException, ForbiddenException, Injectable, Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { MoodCheckin } from './entities/mood-checkin.entity';
import { User } from '../users/entities/user.entity';
import { SubmitMoodCheckinDto } from './dto/mood-checkin.dto';
import { AuditService } from '../audit/audit.service';

/**
 * v3.1 F3 — Service para mood check-ins diarios.
 *
 * Reglas de negocio:
 *   - 1 registro por user por día (upsert): el usuario puede cambiar
 *     de opinión a lo largo del día.
 *   - Histórico personal: visible para el propio user.
 *   - Histórico del equipo: manager ve agregado de sus reportes directos;
 *     admin ve agregado de todo el tenant.
 *   - Privacidad: el agregado solo se muestra si el período consultado
 *     tiene >= `MIN_TEAM_RESPONSES` respuestas distintas (para evitar
 *     que el manager identifique individuos por patrones).
 */
@Injectable()
export class MoodCheckinsService {
  private readonly logger = new Logger(MoodCheckinsService.name);

  /** Mínimo de respuestas para mostrar agregado de equipo (privacidad). */
  private static readonly MIN_TEAM_RESPONSES = 3;

  constructor(
    @InjectRepository(MoodCheckin)
    private readonly moodRepo: Repository<MoodCheckin>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly auditService: AuditService,
  ) {}

  private todayYmd(): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private ymdOffset(daysBack: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysBack);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /**
   * Registra (o actualiza) el mood del día. Si ya existe un registro
   * para hoy del mismo user, se actualiza el score/note.
   */
  async submitMood(
    tenantId: string,
    userId: string,
    dto: SubmitMoodCheckinDto,
  ): Promise<MoodCheckin> {
    const today = this.todayYmd();

    const existing = await this.moodRepo.findOne({
      where: { tenantId, userId, checkinDate: today },
    });

    if (existing) {
      existing.score = dto.score;
      existing.note = dto.note?.trim() || null;
      const saved = await this.moodRepo.save(existing);
      await this.auditService
        .log(tenantId, userId, 'mood.updated', 'mood_checkin', saved.id, {
          score: dto.score,
        })
        .catch(() => undefined);
      return saved;
    }

    const entity = this.moodRepo.create({
      tenantId,
      userId,
      checkinDate: today,
      score: dto.score,
      note: dto.note?.trim() || null,
    });
    const saved = await this.moodRepo.save(entity);
    await this.auditService
      .log(tenantId, userId, 'mood.created', 'mood_checkin', saved.id, {
        score: dto.score,
      })
      .catch(() => undefined);
    return saved;
  }

  /** Retorna el registro de hoy del usuario, o null. Usado por el widget. */
  async getMyToday(tenantId: string, userId: string): Promise<MoodCheckin | null> {
    return this.moodRepo.findOne({
      where: { tenantId, userId, checkinDate: this.todayYmd() },
    });
  }

  /** Histórico personal de los últimos N días (default 30). */
  async getMyHistory(
    tenantId: string,
    userId: string,
    days: number = 30,
  ): Promise<MoodCheckin[]> {
    const from = this.ymdOffset(Math.max(1, Math.min(days, 180)));
    const to = this.todayYmd();
    return this.moodRepo.find({
      where: {
        tenantId,
        userId,
        checkinDate: Between(from, to),
      },
      order: { checkinDate: 'ASC' },
    });
  }

  /**
   * Agregado por día para el equipo del caller.
   *   - admin → todos los users activos del tenant.
   *   - manager → sus reportes directos (managerId = callerId).
   *   - employee → 403 (el endpoint debería bloquear antes).
   *
   * Retorna `{ date, avgScore, responseCount }[]` para cada día del
   * rango con >= MIN_TEAM_RESPONSES respuestas. Los días con menos
   * respuestas se filtran (privacidad).
   */
  async getTeamAggregate(
    tenantId: string,
    callerId: string,
    role: string,
    days: number = 14,
  ): Promise<Array<{ date: string; avgScore: number; responseCount: number }>> {
    if (role === 'employee') {
      throw new ForbiddenException('Los colaboradores no ven agregados de equipo.');
    }
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';

    // Determinar el conjunto de userIds del "equipo"
    let teamUserIds: string[];
    if (isAdmin) {
      const users = await this.userRepo.find({
        where: { tenantId, isActive: true },
        select: ['id'],
      });
      teamUserIds = users.map((u) => u.id);
    } else {
      const directReports = await this.userRepo.find({
        where: { tenantId, managerId: callerId, isActive: true },
        select: ['id'],
      });
      teamUserIds = directReports.map((u) => u.id);
    }

    if (teamUserIds.length === 0) return [];

    const from = this.ymdOffset(Math.max(1, Math.min(days, 90)));
    const to = this.todayYmd();

    const rows = await this.moodRepo.find({
      where: {
        tenantId,
        userId: In(teamUserIds),
        checkinDate: Between(from, to),
      },
      select: ['checkinDate', 'score', 'userId'],
    });

    // Agrupar por fecha, contar respuestas únicas por user, promedio
    const byDate = new Map<string, { sum: number; users: Set<string> }>();
    for (const r of rows) {
      const d = r.checkinDate;
      let bucket = byDate.get(d);
      if (!bucket) {
        bucket = { sum: 0, users: new Set() };
        byDate.set(d, bucket);
      }
      // Si el mismo user respondió varias veces ese día (no debería por
      // el UNIQUE), el Set evita contar doble.
      if (!bucket.users.has(r.userId)) {
        bucket.sum += r.score;
        bucket.users.add(r.userId);
      }
    }

    return Array.from(byDate.entries())
      .filter(([, b]) => b.users.size >= MoodCheckinsService.MIN_TEAM_RESPONSES)
      .map(([date, b]) => ({
        date,
        avgScore: Number((b.sum / b.users.size).toFixed(2)),
        responseCount: b.users.size,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Resumen del día actual para el dashboard del manager/admin.
   * Retorna avg + conteo + distribución de scores (1-5) solo si hay
   * >= MIN_TEAM_RESPONSES. Si no, retorna null.
   */
  async getTeamTodaySummary(
    tenantId: string,
    callerId: string,
    role: string,
  ): Promise<{
    date: string;
    avgScore: number;
    responseCount: number;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  } | null> {
    if (role === 'employee') {
      throw new ForbiddenException('Los colaboradores no ven agregados de equipo.');
    }
    const isAdmin = role === 'super_admin' || role === 'tenant_admin';

    let teamUserIds: string[];
    if (isAdmin) {
      const users = await this.userRepo.find({
        where: { tenantId, isActive: true },
        select: ['id'],
      });
      teamUserIds = users.map((u) => u.id);
    } else {
      const directReports = await this.userRepo.find({
        where: { tenantId, managerId: callerId, isActive: true },
        select: ['id'],
      });
      teamUserIds = directReports.map((u) => u.id);
    }

    if (teamUserIds.length === 0) return null;

    const today = this.todayYmd();
    const rows = await this.moodRepo.find({
      where: {
        tenantId,
        userId: In(teamUserIds),
        checkinDate: today,
      },
      select: ['score', 'userId'],
    });

    // Dedup por user (defensivo contra race del upsert)
    const byUser = new Map<string, number>();
    for (const r of rows) byUser.set(r.userId, r.score);

    if (byUser.size < MoodCheckinsService.MIN_TEAM_RESPONSES) return null;

    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0,
    };
    let sum = 0;
    for (const score of byUser.values()) {
      sum += score;
      const s = score as 1 | 2 | 3 | 4 | 5;
      distribution[s] = (distribution[s] || 0) + 1;
    }

    return {
      date: today,
      avgScore: Number((sum / byUser.size).toFixed(2)),
      responseCount: byUser.size,
      distribution,
    };
  }
}
