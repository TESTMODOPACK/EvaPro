import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { signToken } from '../../common/utils/signed-token';
import {
  NotificationCategory,
  UserNotificationPreferences,
} from '../../common/types/jsonb-schemas';

/**
 * Purpose + TTL for the stateless unsubscribe token. Kept in sync with
 * `unsubscribe.service.ts` — if either file changes, update both.
 */
const UNSUBSCRIBE_PURPOSE = 'unsubscribe';
const UNSUBSCRIBE_TOKEN_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

/**
 * EmailService — Beautiful branded transactional emails for Eva360.
 *
 * Uses Resend (https://resend.com) when RESEND_API_KEY is set.
 * Falls back to console logging in development.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: any = null;
  private readonly from = process.env.EMAIL_FROM || 'Eva360 <onboarding@resend.dev>';
  private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';

  constructor(
    @Optional() @InjectRepository(Tenant)
    private readonly tenantRepo?: Repository<Tenant>,
    @Optional() @InjectRepository(User)
    private readonly userRepo?: Repository<User>,
    @Optional() private readonly auditService?: AuditService,
  ) {
    this.init();
  }

  /** Fetch org logo, name and email settings from tenant */
  async getOrgBranding(tenantId?: string): Promise<{ logoUrl: string | null; orgName: string; emailFrom: string | null }> {
    if (!tenantId || !this.tenantRepo) return { logoUrl: null, orgName: '', emailFrom: null };
    try {
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
      return {
        logoUrl: tenant?.settings?.logoUrl || null,
        orgName: tenant?.name || '',
        emailFrom: tenant?.settings?.emailFrom || null,
      };
    } catch {
      return { logoUrl: null, orgName: '', emailFrom: null };
    }
  }

  /** Get the FROM address for a tenant (tenant-specific > env default) */
  private async getFromAddress(tenantId?: string): Promise<string> {
    if (tenantId && this.tenantRepo) {
      try {
        const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings', 'name'] });
        const custom = tenant?.settings?.emailFrom;
        if (custom) {
          // Format: "OrgName <email>" or just "email"
          return custom.includes('<') ? custom : `${tenant?.name || 'EvaPro'} <${custom}>`;
        }
      } catch {}
    }
    return this.from;
  }

  private async init() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — emails will be logged to console only');
      return;
    }
    try {
      const { Resend } = await import('resend' as string);
      this.resend = new Resend(apiKey);
      this.logger.log('✉️  Email service ready (Resend)');
    } catch {
      this.logger.warn('resend package not installed — emails will be logged to console');
    }
  }

  /**
   * Check if email notifications are enabled for a tenant + category + user.
   *
   * Precedence (most specific wins on "block"):
   *  1. User opt-out (new — `user.notification_preferences[category] === false`)
   *  2. Tenant category toggle
   *  3. Tenant master toggle
   *
   * Default is `true` (send) on any missing data or error — we prefer to
   * err on the side of communicating rather than silently drop.
   *
   * Transactional methods (password reset, OTP, invitation, GDPR, billing
   * lifecycle) MUST NOT call this — they are always sent unconditionally.
   */
  async isEmailEnabled(tenantId?: string, category?: string, userId?: string): Promise<boolean> {
    // User-level opt-out first — it's the most specific signal.
    if (userId && category && this.userRepo) {
      try {
        const user = await this.userRepo.findOne({
          where: { id: userId },
          select: ['id', 'notificationPreferences'],
        });
        if (user) {
          const prefs = (user.notificationPreferences ?? {}) as UserNotificationPreferences;
          if (prefs[category as NotificationCategory] === false) return false;
        }
      } catch {
        // Fall through to tenant-level check on any DB error.
      }
    }

    if (!tenantId || !this.tenantRepo) return true;
    try {
      const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'settings'] });
      const settings = tenant?.settings || {};
      // Master toggle
      if (settings.emailNotifications === false) return false;
      // Category-level toggle
      if (category && settings.notificationTypes && settings.notificationTypes[category] === false) return false;
      return true;
    } catch {
      return true; // Default to sending on error
    }
  }

  // ─── Unsubscribe helpers ──────────────────────────────────────────────────

  /** Mint a stateless HMAC token valid for 180 days. Returns empty string
   *  if JWT_SECRET isn't configured (send() will then omit the header). */
  private mintUnsubscribeToken(userId: string, tenantId: string | null): string {
    try {
      return signToken({ uid: userId, tid: tenantId }, UNSUBSCRIBE_PURPOSE, UNSUBSCRIBE_TOKEN_TTL_SECONDS);
    } catch (err: any) {
      this.logger.warn(`Failed to mint unsubscribe token: ${err?.message || err}`);
      return '';
    }
  }

  private buildUnsubscribeHeaders(token: string): Record<string, string> | undefined {
    if (!token) return undefined;
    const url = `${this.appUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
    // RFC 2369 + RFC 8058. Gmail uses `List-Unsubscribe-Post` for 1-click.
    return {
      'List-Unsubscribe': `<${url}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  /**
   * Wraps body with org branding (logo + name) fetched from tenant.
   *
   * If `userIdForUnsubscribe` is provided, a fresh HMAC token is minted and
   * passed into `wrap()` so the footer renders a public unsubscribe link.
   * Omit for broadcast emails (multiple recipients sharing one render) or
   * for transactional mails where unsubscribe doesn't apply.
   */
  private async wrapWithBranding(tenantId: string | undefined, opts: {
    body: string; preheader?: string; accentColor?: string;
    userIdForUnsubscribe?: string;
  }): Promise<string> {
    const branding = await this.getOrgBranding(tenantId);
    const unsubscribeToken = opts.userIdForUnsubscribe
      ? this.mintUnsubscribeToken(opts.userIdForUnsubscribe, tenantId ?? null)
      : '';
    const unsubscribeUrl = unsubscribeToken
      ? `${this.appUrl}/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`
      : undefined;
    return this.wrap({
      body: opts.body,
      preheader: opts.preheader,
      accentColor: opts.accentColor,
      orgLogoUrl: branding.logoUrl,
      orgName: branding.orgName,
      unsubscribeUrl,
    });
  }

  // ─── Core send ────────────────────────────────────────────────────────────

  /**
   * Send a branded HTML email.
   *
   * @param opts.userIdForUnsubscribe  When provided, an unsubscribe HMAC token
   *   is minted and the `List-Unsubscribe` / `List-Unsubscribe-Post` headers
   *   are added so Gmail/Outlook render a native opt-out button. Must be the
   *   id of the ONLY recipient — if the email is a broadcast to multiple users
   *   do NOT pass this (there is no valid single-user token for broadcasts).
   */
  async send(
    to: string | string[],
    subject: string,
    html: string,
    tenantId?: string,
    opts?: { userIdForUnsubscribe?: string },
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];
    const from = await this.getFromAddress(tenantId);
    const headers = opts?.userIdForUnsubscribe
      ? this.buildUnsubscribeHeaders(this.mintUnsubscribeToken(opts.userIdForUnsubscribe, tenantId ?? null))
      : undefined;

    if (!this.resend) {
      this.logger.log(`[EMAIL PREVIEW]\nFrom: ${from}\nTo: ${recipients.join(', ')}\nSubject: ${subject}${headers ? `\nList-Unsubscribe: ${headers['List-Unsubscribe']}` : ''}\n---`);
      return;
    }

    try {
      const payload: any = { from, to: recipients, subject, html };
      if (headers) payload.headers = headers;
      const result = await this.resend.emails.send(payload);
      this.logger.log(`✉️  Email sent: to=${recipients.join(', ')}, from=${from}, id=${result?.data?.id || 'ok'}`);
    } catch (err: any) {
      this.logger.error(`❌ Email FAILED: to=${recipients.join(', ')}, from=${from}, error=${err?.message}`);
      await this.auditService?.logFailure('notification.failed', {
        tenantId: tenantId ?? null,
        entityType: 'Email',
        error: err,
        metadata: { to: recipients, subject, channel: 'resend' },
      });
    }
  }

  /** Send email with file attachments (e.g., .ics calendar files) */
  async sendWithAttachments(
    to: string | string[],
    subject: string,
    html: string,
    attachments: Array<{ filename: string; content: string; contentType: string }>,
    tenantId?: string,
    opts?: { userIdForUnsubscribe?: string },
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];
    const from = await this.getFromAddress(tenantId);
    const headers = opts?.userIdForUnsubscribe
      ? this.buildUnsubscribeHeaders(this.mintUnsubscribeToken(opts.userIdForUnsubscribe, tenantId ?? null))
      : undefined;

    if (!this.resend) {
      this.logger.log(`[EMAIL PREVIEW+ATTACHMENT]\nFrom: ${from}\nTo: ${recipients.join(', ')}\nSubject: ${subject}\nAttachments: ${attachments.map(a => a.filename).join(', ')}${headers ? `\nList-Unsubscribe: ${headers['List-Unsubscribe']}` : ''}\n---`);
      return;
    }

    try {
      const payload: any = { from, to: recipients, subject, html, attachments };
      if (headers) payload.headers = headers;
      const result = await this.resend.emails.send(payload);
      this.logger.log(`✉️  Email+attachment sent: to=${recipients.join(', ')}, from=${from}, id=${result?.data?.id || 'ok'}`);
    } catch (err: any) {
      this.logger.error(`❌ Email+attachment FAILED: to=${recipients.join(', ')}, from=${from}, error=${err?.message}`);
      await this.auditService?.logFailure('notification.failed', {
        tenantId: tenantId ?? null,
        entityType: 'Email',
        error: err,
        metadata: { to: recipients, subject, channel: 'resend', hasAttachments: true },
      });
    }
  }

  // ─── Template: Cycle Launched ─────────────────────────────────────────────

  async sendCycleLaunched(
    email: string,
    data: { firstName: string; cycleName: string; cycleType: string; dueDate: string; cycleId: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'evaluations', data.userId))) return;
    const typeLabel: Record<string, string> = {
      '90': 'Evaluación 90°', '180': 'Evaluación 180°',
      '270': 'Evaluación 270°', '360': 'Evaluación 360°',
    };
    const label = typeLabel[data.cycleType] || 'Evaluación de desempeño';

    await this.send(
      email,
      `Nueva evaluación asignada: ${data.cycleName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes una nueva ${label} pendiente. Fecha límite: ${data.dueDate}`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading(`Hola, ${data.firstName} 👋`)}
          ${this.paragraph(`Se ha iniciado el ciclo de evaluación <strong>${data.cycleName}</strong> y tienes evaluaciones pendientes por completar.`)}
          ${this.infoBox([
            { label: 'Tipo', value: label },
            { label: 'Fecha límite', value: data.dueDate },
          ])}
          ${this.paragraph('Completa tus evaluaciones antes de la fecha límite para que tus respuestas sean consideradas en el proceso.')}
          ${this.cta('Ir a mis evaluaciones', `${this.appUrl}/dashboard/evaluaciones`)}
          ${this.divider()}
          ${this.smallText('Si no debes participar en este ciclo, contacta a tu administrador de RRHH.')}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Evaluation Reminder ───────────────────────────────────────

  async sendEvaluationReminder(
    email: string,
    data: { firstName: string; cycleName: string; pendingCount: number; daysLeft: number; cycleId: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'evaluations', data.userId))) return;
    const urgency = data.daysLeft <= 1 ? '🚨 Urgente' : data.daysLeft <= 3 ? '⚠️ Pronto vence' : '🔔 Recordatorio';

    await this.send(
      email,
      `${urgency}: ${data.pendingCount} evaluación${data.pendingCount > 1 ? 'es' : ''} pendiente${data.pendingCount > 1 ? 's' : ''} en ${data.cycleName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Te ${data.daysLeft === 1 ? 'queda 1 día' : `quedan ${data.daysLeft} días`} para completar tus evaluaciones.`,
        accentColor: data.daysLeft <= 1 ? '#ef4444' : data.daysLeft <= 3 ? '#f59e0b' : '#C9933A',
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading(`${urgency}: evaluaciones pendientes`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tienes <strong>${data.pendingCount} evaluación${data.pendingCount > 1 ? 'es' : ''} pendiente${data.pendingCount > 1 ? 's' : ''}</strong> en el ciclo <strong>${data.cycleName}</strong>.`)}
          ${this.alertBox(
            data.daysLeft <= 1
              ? `El ciclo vence mañana. Completa tus evaluaciones hoy.`
              : `Te ${data.daysLeft === 1 ? 'queda 1 día' : `quedan ${data.daysLeft} días`} para completar todas tus evaluaciones.`,
            data.daysLeft <= 1 ? 'danger' : data.daysLeft <= 3 ? 'warning' : 'info',
          )}
          ${this.cta('Completar ahora', `${this.appUrl}/dashboard/evaluaciones`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Cycle Closed / Results Available ───────────────────────────

  async sendCycleClosed(
    email: string,
    data: { firstName: string; cycleName: string; cycleId: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'evaluations', data.userId))) return;
    await this.send(
      email,
      `Resultados disponibles: ${data.cycleName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `El ciclo ${data.cycleName} ha finalizado. Tus resultados están disponibles.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Resultados de evaluación listos ✅')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, el ciclo de evaluación <strong>${data.cycleName}</strong> ha concluido y tus resultados están disponibles en la plataforma.`)}
          ${this.paragraph('Revisa tu desempeño, el feedback de tus evaluadores y las oportunidades de desarrollo identificadas.')}
          ${this.cta('Ver mis resultados', `${this.appUrl}/dashboard/mi-desempeno`)}
          ${this.divider()}
          ${this.smallText('Si tienes preguntas sobre tus resultados, consulta con tu jefatura directa o con el área de RRHH.')}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: User Invitation ────────────────────────────────────────────

  async sendInvitation(
    email: string,
    data: { firstName: string; orgName: string; tempPassword?: string; inviterName?: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `Te han invitado a Eva360 — ${data.orgName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.inviterName || data.orgName} te ha invitado a la plataforma de evaluación de desempeño.`,
        body: `
          ${this.heading('¡Bienvenido/a a Eva360! 🎉')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, ${data.inviterName ? `<strong>${data.inviterName}</strong> te ha` : `<strong>${data.orgName}</strong> te ha`} invitado a la plataforma de gestión del desempeño.`)}
          ${data.tempPassword ? `
            ${this.infoBox([
              { label: 'Tu email', value: email },
              { label: 'Contraseña temporal', value: `<code style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${data.tempPassword}</code>` },
            ])}
            ${this.alertBox('Por seguridad, cambia tu contraseña al iniciar sesión por primera vez.', 'warning')}
          ` : ''}
          ${this.cta('Ingresar a la plataforma', `${this.appUrl}/login`)}
          ${this.divider()}
          ${this.smallText('Si no esperabas esta invitación, puedes ignorar este correo.')}
        `,
      }),
    );
  }

  // ─── Template: Welcome Back (boomerang rehire) ──────────────────────────

  async sendWelcomeBack(
    email: string,
    data: { firstName: string; orgName: string; tempPassword: string; tenantId?: string; daysInactive?: number },
  ) {
    await this.send(
      email,
      `Te damos la bienvenida nuevamente a Eva360 — ${data.orgName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tu cuenta en ${data.orgName} ha sido reactivada.`,
        body: `
          ${this.heading('¡Bienvenido/a de vuelta! 👋')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tu cuenta en <strong>${data.orgName}</strong> ha sido reactivada${data.daysInactive ? ` (estuvo inactiva ${data.daysInactive} día${data.daysInactive === 1 ? '' : 's'})` : ''}.`)}
          ${this.paragraph('Por seguridad, tu contraseña anterior ya no es válida. Te asignamos una temporal:')}
          ${this.infoBox([
            { label: 'Tu email', value: email },
            { label: 'Contraseña temporal', value: `<code style="font-family:monospace;background:#f1f5f9;padding:2px 6px;border-radius:4px;">${data.tempPassword}</code>` },
          ])}
          ${this.alertBox('Por seguridad debes cambiar tu contraseña al iniciar sesión. Si tenías 2FA activo, deberás configurarlo nuevamente.', 'warning')}
          ${this.cta('Ingresar a la plataforma', `${this.appUrl}/login`)}
          ${this.divider()}
          ${this.smallText('Si no esperabas este correo, contacta a tu administrador inmediatamente.')}
        `,
      }),
    );
  }

  // ─── Template: Check-in Scheduled ────────────────────────────────────────

  async sendCheckinScheduled(
    email: string,
    data: { firstName: string; managerName: string; scheduledAt: string; topic?: string; checkinId: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback', data.userId))) return;
    await this.send(
      email,
      `Check-in 1:1 agendado con ${data.managerName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes un check-in programado para el ${data.scheduledAt}.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Check-in 1:1 agendado 📅')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se ha agendado una reunión 1:1 contigo.`)}
          ${this.infoBox([
            { label: 'Con', value: data.managerName },
            { label: 'Fecha y hora', value: data.scheduledAt },
            ...(data.topic ? [{ label: 'Tema', value: data.topic }] : []),
          ])}
          ${this.cta('Ver detalles', `${this.appUrl}/dashboard/feedback`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  /** Build the check-in HTML without sending — used by FeedbackService to attach .ics. Returns null if emails disabled. */
  async buildCheckinScheduledHtml(
    data: { firstName: string; managerName: string; scheduledAt: string; topic?: string; checkinId: string; tenantId?: string; userId?: string },
  ): Promise<string | null> {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback', data.userId))) return null;
    return this.wrapWithBranding(data.tenantId, {
      preheader: `Tienes un check-in programado para el ${data.scheduledAt}.`,
      userIdForUnsubscribe: data.userId,
      body: `
        ${this.heading('Check-in 1:1 agendado 📅')}
        ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se ha agendado una reunión 1:1 contigo.`)}
        ${this.infoBox([
          { label: 'Con', value: data.managerName },
          { label: 'Fecha y hora', value: data.scheduledAt },
          ...(data.topic ? [{ label: 'Tema', value: data.topic }] : []),
        ])}
        ${this.paragraph('Puedes aceptar o rechazar esta cita desde la plataforma.')}
        ${this.cta('Ver detalles', `${this.appUrl}/dashboard/feedback`)}
      `,
    });
  }

  // ─── Template: OKR At Risk ────────────────────────────────────────────────

  async sendOkrAtRisk(
    email: string,
    data: { firstName: string; objectives: Array<{ title: string; progress: number; daysLeft: number }>; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'objectives', data.userId))) return;
    const list = data.objectives
      .map((o) => `<li style="margin-bottom:0.5rem;"><strong>${o.title}</strong> — ${o.progress}% completado, vence en ${o.daysLeft} días</li>`)
      .join('');

    await this.send(
      email,
      `${data.objectives.length} objetivo${data.objectives.length > 1 ? 's' : ''} en riesgo de no cumplirse`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes objetivos que están en riesgo de no alcanzarse antes de su fecha límite.`,
        accentColor: '#f59e0b',
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('⚠️ Objetivos en riesgo')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, los siguientes objetivos están retrasados respecto a su progreso esperado:`)}
          <ul style="margin:0 0 1.5rem;padding-left:1.5rem;color:#374151;font-size:0.95rem;line-height:1.8;">
            ${list}
          </ul>
          ${this.paragraph('Actualiza el progreso o ajusta las fechas para mantener tus OKRs al día.')}
          ${this.cta('Revisar mis objetivos', `${this.appUrl}/dashboard/objetivos`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Subscription Expiring ─────────────────────────────────────

  async sendSubscriptionExpiring(
    email: string,
    data: { orgName: string; planName: string; daysLeft: number; expiresAt: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `⚠️ Tu suscripción vence en ${data.daysLeft} día${data.daysLeft > 1 ? 's' : ''}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `La suscripción ${data.planName} de ${data.orgName} vence el ${data.expiresAt}.`,
        accentColor: '#ef4444',
        body: `
          ${this.heading('Suscripción próxima a vencer')}
          ${this.paragraph(`La suscripción <strong>${data.planName}</strong> de <strong>${data.orgName}</strong> vence en <strong>${data.daysLeft} día${data.daysLeft > 1 ? 's' : ''}</strong>.`)}
          ${this.alertBox(`Fecha de vencimiento: ${data.expiresAt}. Renueva para mantener el acceso ininterrumpido a la plataforma.`, 'danger')}
          ${this.paragraph('Si necesitas renovar o tienes preguntas, contacta al equipo de Eva360.')}
          ${this.cta('Gestionar suscripción', `${this.appUrl}/dashboard/mi-suscripcion`)}
        `,
      }),
    );
  }

  // ─── Template: Initiative Assigned ───────────────────────────────────────

  async sendInitiativeAssigned(
    email: string,
    data: {
      firstName: string;
      initiativeTitle: string;
      planTitle: string;
      planYear: number;
      department: string | null;
      targetDate: string | null;
      responsibleName: string | null;
      tenantId?: string;
      userId?: string;
    },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'development', data.userId))) return;
    const deptLabel = data.department ?? 'Toda la empresa';
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Plan', value: `${data.planTitle} (${data.planYear})` },
      { label: 'Alcance', value: deptLabel },
    ];
    if (data.responsibleName) rows.push({ label: 'Responsable', value: data.responsibleName });
    if (data.targetDate) rows.push({ label: 'Fecha límite', value: data.targetDate });

    await this.send(
      email,
      `Nueva iniciativa de desarrollo asignada: ${data.initiativeTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Has sido incluido/a en la iniciativa "${data.initiativeTitle}" del plan ${data.planTitle}.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading(`Iniciativa de desarrollo asignada 🚀`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, has sido incluido/a en una nueva iniciativa de desarrollo organizacional.`)}
          ${this.infoBox([{ label: 'Iniciativa', value: data.initiativeTitle }, ...rows])}
          ${this.paragraph('Esta iniciativa forma parte del plan de desarrollo de tu organización. Puedes ver los detalles y las acciones asociadas en la plataforma.')}
          ${this.cta('Ver plan de desarrollo', `${this.appUrl}/dashboard/desarrollo-organizacional`)}
          ${this.divider()}
          ${this.smallText('Si tienes preguntas sobre esta iniciativa, consulta con el responsable o con el área de RRHH.')}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Template/Competency Review Pending ─────────────────────────

  async sendPendingReview(
    email: string,
    data: { adminName: string; itemType: 'plantilla' | 'competencia'; itemName: string; proposedBy: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'pending_reviews', data.userId))) return;
    await this.send(
      email,
      `Nueva ${data.itemType} pendiente de revisión: ${data.itemName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.proposedBy} ha propuesto una nueva ${data.itemType} que requiere tu aprobación.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading(`Nueva ${data.itemType} para revisar 📋`)}
          ${this.paragraph(`Hola <strong>${data.adminName}</strong>, <strong>${data.proposedBy}</strong> ha propuesto una nueva ${data.itemType} que requiere tu revisión y aprobación.`)}
          ${this.infoBox([
            { label: 'Tipo', value: data.itemType.charAt(0).toUpperCase() + data.itemType.slice(1) },
            { label: 'Nombre', value: data.itemName },
            { label: 'Propuesto por', value: data.proposedBy },
          ])}
          ${this.cta(
            `Revisar ${data.itemType}`,
            `${this.appUrl}/dashboard/${data.itemType === 'plantilla' ? 'plantillas' : 'competencias'}`,
          )}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Recognition Received ───────────────────────────────────────

  async sendRecognitionReceived(
    email: string,
    data: { firstName: string; fromName: string; message: string; valueName?: string; points: number; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'recognitions', data.userId))) return;
    const msgPreview = data.message.length > 120 ? data.message.substring(0, 120) + '...' : data.message;
    await this.send(
      email,
      `${data.fromName} te ha reconocido`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Has recibido un reconocimiento de ${data.fromName}. +${data.points} puntos.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading(`Has recibido un reconocimiento ⭐`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, <strong>${data.fromName}</strong> te ha enviado un reconocimiento:`)}
          ${this.alertBox(`"${msgPreview}"`, 'info')}
          ${this.infoBox([
            { label: 'De', value: data.fromName },
            ...(data.valueName ? [{ label: 'Valor corporativo', value: data.valueName }] : []),
            { label: 'Puntos otorgados', value: `+${data.points}` },
          ])}
          ${this.paragraph('Visita el muro de reconocimientos para ver el detalle y reaccionar.')}
          ${this.cta('Ver reconocimientos', `${this.appUrl}/dashboard/reconocimientos`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Signature OTP ──────────────────────────────────────────────

  async sendSignatureOtp(
    email: string,
    data: { firstName: string; documentType: string; documentName: string; code: string; expiryMinutes: number; tenantId?: string },
  ) {
    await this.send(
      email,
      `Código de firma digital — ${data.documentName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tu código de firma es ${data.code}. Válido por ${data.expiryMinutes} minutos.`,
        body: `
          ${this.heading('Firma Digital Solicitada ✍️')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se ha solicitado tu firma digital para el siguiente documento:`)}
          ${this.infoBox([
            { label: 'Tipo', value: data.documentType },
            { label: 'Documento', value: data.documentName },
          ])}
          ${this.paragraph('Ingresa el siguiente código para confirmar tu firma:')}
          <div style="background:#f8fafc;border-radius:12px;padding:20px;text-align:center;margin:0 0 1.5rem;">
            <span style="font-size:2.5rem;font-weight:800;letter-spacing:0.3em;color:#0f172a;">${data.code}</span>
          </div>
          ${this.alertBox(`Este código expira en <strong>${data.expiryMinutes} minutos</strong>. Si no solicitaste esta firma, ignora este correo.`, 'warning')}
          ${this.paragraph('La firma digital registra tu identidad, fecha/hora e IP como evidencia de aceptación del documento.')}
        `,
      }),
    );
  }

  async sendContractForSignature(
    email: string,
    firstName: string,
    contractTitle: string,
    contractType: string,
    tenantName: string,
  ) {
    const typeLabels: Record<string, string> = {
      service_agreement: 'Contrato de Prestación de Servicios',
      dpa: 'Acuerdo de Procesamiento de Datos',
      terms_conditions: 'Términos y Condiciones',
      privacy_policy: 'Política de Privacidad',
      sla: 'Acuerdo de Nivel de Servicio',
      nda: 'Acuerdo de Confidencialidad',
      amendment: 'Enmienda',
    };
    await this.send(
      email,
      `Contrato pendiente de firma — ${contractTitle}`,
      await this.wrapWithBranding(undefined, {
        preheader: `Tiene un contrato pendiente de revisión y firma en EvaPro.`,
        body: `
          ${this.heading('Contrato Pendiente de Firma 📄')}
          ${this.paragraph(`Hola <strong>${firstName}</strong>, se ha generado un nuevo contrato que requiere su revisión y firma electrónica:`)}
          ${this.infoBox([
            { label: 'Organización', value: tenantName },
            { label: 'Tipo', value: typeLabels[contractType] || contractType },
            { label: 'Documento', value: contractTitle },
          ])}
          ${this.paragraph('Para revisar y firmar el contrato, ingrese a <strong>EvaPro → Contratos</strong> en el menú lateral.')}
          ${this.paragraph('La firma electrónica se realiza mediante código OTP enviado a su correo, generando un registro con valor probatorio (hash SHA-256, IP, fecha/hora).')}
          ${this.alertBox('Revise el documento completo antes de firmar. Una vez firmado, el contrato queda vigente y no puede ser modificado.', 'warning')}
        `,
      }),
    );
  }

  async sendSurveyInvitation(
    email: string,
    data: { firstName: string; surveyTitle: string; dueDate: string; isAnonymous: boolean; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'surveys', data.userId))) return;
    const anonymousNote = data.isAnonymous
      ? 'Tus respuestas serán completamente <strong>anónimas</strong>. No se registrará tu identidad.'
      : 'Tus respuestas serán confidenciales y solo visibles para el equipo de RRHH.';

    await this.send(
      email,
      `Nueva encuesta de clima: ${data.surveyTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Se te ha asignado la encuesta "${data.surveyTitle}". Fecha límite: ${data.dueDate}.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Encuesta de Clima Organizacional')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se te ha invitado a participar en la siguiente encuesta:`)}
          ${this.infoBox([
            { label: 'Encuesta', value: data.surveyTitle },
            { label: 'Fecha límite', value: data.dueDate },
          ])}
          ${this.paragraph(anonymousNote)}
          ${this.paragraph('Tu opinión es muy importante para mejorar el ambiente laboral. Por favor responde antes de la fecha límite.')}
          ${this.cta('Responder Encuesta', `${this.appUrl}/dashboard/encuestas-clima`)}
          ${this.smallText('Si tienes problemas para acceder, ingresa a la plataforma y busca la sección "Encuestas de Clima".')}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Feedback Received ──────────────────────────────────────────

  async sendFeedbackReceived(
    email: string,
    data: {
      firstName: string;
      senderName: string;
      sentiment: string;
      message: string;
      competencyName?: string;
      tenantId?: string;
      userId?: string;
    },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback', data.userId))) return;
    const sentimentLabel = data.sentiment === 'positive' ? 'positivo' : data.sentiment === 'constructive' ? 'constructivo' : '';
    const sentimentIcon = data.sentiment === 'positive' ? '⭐' : data.sentiment === 'constructive' ? '💡' : '💬';

    await this.send(
      email,
      `${sentimentIcon} Nuevo feedback ${sentimentLabel} recibido`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.senderName} te ha enviado feedback${sentimentLabel ? ' ' + sentimentLabel : ''}.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading(`Feedback recibido ${sentimentIcon}`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, <strong>${data.senderName}</strong> te ha enviado feedback${sentimentLabel ? ' <strong>' + sentimentLabel + '</strong>' : ''}:`)}
          <div style="background:#f8fafc;border-left:4px solid ${data.sentiment === 'positive' ? '#10b981' : data.sentiment === 'constructive' ? '#f59e0b' : '#94a3b8'};border-radius:0 8px 8px 0;padding:1rem 1.25rem;margin:1rem 0;">
            <p style="margin:0;font-size:0.95rem;color:#374151;line-height:1.6;font-style:italic;">"${data.message}"</p>
          </div>
          ${data.competencyName ? this.infoBox([{ label: 'Competencia', value: data.competencyName }]) : ''}
          ${this.paragraph('Revisa tu historial de feedback completo en la plataforma.')}
          ${this.cta('Ver mi feedback', `${this.appUrl}/dashboard/mi-desempeno`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Objective Assigned ─────────────────────────────────────────

  async sendObjectiveAssigned(
    email: string,
    data: { firstName: string; objectiveTitle: string; objectiveType: string; targetDate?: string; assignedBy?: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'objectives', data.userId))) return;
    const typeLabels: Record<string, string> = { OKR: 'OKR', KPI: 'KPI', SMART: 'SMART', individual: 'Individual' };
    const typeLabel = typeLabels[data.objectiveType] || data.objectiveType;
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Objetivo', value: data.objectiveTitle },
      { label: 'Tipo', value: typeLabel },
    ];
    if (data.targetDate) rows.push({ label: 'Fecha meta', value: data.targetDate });
    if (data.assignedBy) rows.push({ label: 'Asignado por', value: data.assignedBy });

    await this.send(
      email,
      `Nuevo objetivo asignado: ${data.objectiveTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Se te ha asignado el objetivo "${data.objectiveTitle}".`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Nuevo objetivo asignado 🎯')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se te ha asignado un nuevo objetivo:`)}
          ${this.infoBox(rows)}
          ${this.paragraph('Revisa los detalles y comienza a trabajar en tu objetivo. Recuerda actualizar tu progreso regularmente.')}
          ${this.cta('Ver mis objetivos', `${this.appUrl}/dashboard/objetivos`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: PDI Assigned ─────────────────────────────────────────────

  async sendPdiAssigned(
    email: string,
    data: { firstName: string; planTitle: string; createdByName?: string; tenantId?: string; userId?: string },
  ) {
    // NOTE: PDI (Plan de Desarrollo Individual) belongs to the 'development'
    // category, NOT 'feedback'. Prior version used 'feedback' — fixed here.
    if (!(await this.isEmailEnabled(data.tenantId, 'development', data.userId))) return;
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Plan', value: data.planTitle },
    ];
    if (data.createdByName) rows.push({ label: 'Creado por', value: data.createdByName });

    await this.send(
      email,
      `Plan de desarrollo asignado: ${data.planTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Se te ha asignado el plan de desarrollo "${data.planTitle}".`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Plan de desarrollo asignado 📋')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se te ha creado un plan de desarrollo individual (PDI):`)}
          ${this.infoBox(rows)}
          ${this.paragraph('Revisa las acciones asignadas y comienza a trabajar en tu desarrollo profesional.')}
          ${this.cta('Ver mi plan', `${this.appUrl}/dashboard/mi-desempeno`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: PDI Action Overdue ───────────────────────────────────────

  async sendPdiActionOverdue(
    email: string,
    data: { firstName: string; actions: Array<{ description: string; dueDate: string; planTitle: string }>; tenantId?: string; userId?: string },
  ) {
    // PDI overdue actions → 'development' category (fixed from 'feedback').
    if (!(await this.isEmailEnabled(data.tenantId, 'development', data.userId))) return;
    const actionList = data.actions
      .map((a) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;">${a.description.substring(0, 80)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;color:#ef4444;white-space:nowrap;">${a.dueDate}</td></tr>`)
      .join('');

    await this.send(
      email,
      `${data.actions.length} acción(es) de desarrollo vencida(s)`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes ${data.actions.length} acción(es) de desarrollo vencida(s). Actualiza su estado.`,
        accentColor: '#ef4444',
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Acciones de desarrollo vencidas ⚠️')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tienes <strong>${data.actions.length}</strong> acción(es) de tu plan de desarrollo que han superado su fecha límite:`)}
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:1rem 0;">
            <thead><tr style="background:#f8fafc;"><th style="padding:8px 10px;text-align:left;font-size:0.75rem;color:#64748b;text-transform:uppercase;">Acción</th><th style="padding:8px 10px;text-align:left;font-size:0.75rem;color:#64748b;text-transform:uppercase;">Vencimiento</th></tr></thead>
            <tbody>${actionList}</tbody>
          </table>
          ${this.paragraph('Actualiza el estado de estas acciones o solicita una extensión a tu jefatura.')}
          ${this.cta('Ver mi plan de desarrollo', `${this.appUrl}/dashboard/mi-desempeno`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Manager Weekly Summary ──────────────────────────────────────

  async sendManagerWeeklySummary(
    email: string,
    data: { firstName: string; pendingEvals: number; overduePdi: number; atRiskObjectives: number; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'digests', data.userId))) return;
    const items: string[] = [];
    if (data.pendingEvals > 0) items.push(`📝 <strong>${data.pendingEvals}</strong> evaluación${data.pendingEvals > 1 ? 'es' : ''} pendiente${data.pendingEvals > 1 ? 's' : ''}`);
    if (data.overduePdi > 0) items.push(`📋 <strong>${data.overduePdi}</strong> acción${data.overduePdi > 1 ? 'es' : ''} PDI vencida${data.overduePdi > 1 ? 's' : ''} en tu equipo`);
    if (data.atRiskObjectives > 0) items.push(`🎯 <strong>${data.atRiskObjectives}</strong> objetivo${data.atRiskObjectives > 1 ? 's' : ''} en riesgo`);

    const listHtml = items.map((i) => `<li style="padding:6px 0;font-size:0.9rem;color:#334155;">${i}</li>`).join('');

    await this.send(
      email,
      `Resumen semanal — ${items.length} tema${items.length > 1 ? 's' : ''} pendiente${items.length > 1 ? 's' : ''}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Hola ${data.firstName}, tienes ${items.length} tema(s) pendiente(s) esta semana.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Resumen semanal de tu equipo')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, este es un resumen de lo que necesita tu atención esta semana:`)}
          <ul style="margin:1rem 0;padding-left:1.5rem;">${listHtml}</ul>
          ${this.paragraph('Revisa estos puntos para mantener a tu equipo al día.')}
          ${this.cta('Ir al Dashboard', `${this.appUrl}/dashboard`)}
          <p style="margin-top:1.5rem;font-size:0.72rem;color:#94a3b8;text-align:center;">Este es un resumen automático semanal. Se envía cada lunes.</p>
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  /**
   * Resumen semanal para EMPLOYEES regulares (no managers). Se envía cada
   * lunes 8am, distinto template y datos que el de managers. Solo se manda
   * si hay al menos UNA cosa que reportar (no spamear con emails vacíos).
   */
  async sendEmployeeWeeklySummary(
    email: string,
    data: {
      firstName: string;
      pendingEvals: number;
      overdueActions: number;
      upcomingCheckins: number;
      newRecognitions: number;
      tenantId?: string;
      userId?: string;
    },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'digests', data.userId))) return;
    const items: string[] = [];
    if (data.pendingEvals > 0) items.push(`📝 <strong>${data.pendingEvals}</strong> evaluación${data.pendingEvals > 1 ? 'es' : ''} pendiente${data.pendingEvals > 1 ? 's' : ''} de responder`);
    if (data.overdueActions > 0) items.push(`📚 <strong>${data.overdueActions}</strong> acción${data.overdueActions > 1 ? 'es' : ''} de tu PDI vencida${data.overdueActions > 1 ? 's' : ''}`);
    if (data.upcomingCheckins > 0) items.push(`🤝 <strong>${data.upcomingCheckins}</strong> check-in${data.upcomingCheckins > 1 ? 's' : ''} agendado${data.upcomingCheckins > 1 ? 's' : ''} esta semana`);
    if (data.newRecognitions > 0) items.push(`✨ <strong>${data.newRecognitions}</strong> reconocimiento${data.newRecognitions > 1 ? 's' : ''} nuevo${data.newRecognitions > 1 ? 's' : ''} para vos esta semana`);

    const listHtml = items.map((i) => `<li style="padding:6px 0;font-size:0.9rem;color:#334155;">${i}</li>`).join('');

    await this.send(
      email,
      `Tu semana en Eva360 — ${items.length} novedad${items.length !== 1 ? 'es' : ''}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Hola ${data.firstName}, esto es lo que tienes esta semana en Eva360.`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('☀️ Tu semana en Eva360')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, este es el resumen de lo que está pasando con tu desarrollo y evaluaciones esta semana:`)}
          <ul style="margin:1rem 0;padding-left:1.5rem;">${listHtml}</ul>
          ${data.newRecognitions > 0 ? this.paragraph('🎉 ¡Buen trabajo! Alguien valoró tu aporte. Pasá a leer el reconocimiento completo.') : this.paragraph('Mantené tus evaluaciones y acciones al día. Tu jefatura está pendiente de tu progreso.')}
          ${this.cta('Ir a Mi Desempeño', `${this.appUrl}/dashboard/mi-desempeno`)}
          <p style="margin-top:1.5rem;font-size:0.72rem;color:#94a3b8;text-align:center;">Este es un resumen automático semanal. Se envía cada lunes — si no quieres recibirlo, contacta a tu administrador.</p>
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Objective Completed ────────────────────────────────────────

  async sendObjectiveCompleted(
    email: string,
    data: { managerName: string; employeeName: string; objectiveTitle: string; objectiveType: string; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'objectives', data.userId))) return;
    await this.send(
      email,
      `Objetivo completado: ${data.objectiveTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.employeeName} ha completado el objetivo "${data.objectiveTitle}".`,
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Objetivo completado ✅')}
          ${this.paragraph(`Hola <strong>${data.managerName}</strong>, <strong>${data.employeeName}</strong> ha alcanzado el 100% de progreso en su objetivo:`)}
          ${this.infoBox([
            { label: 'Objetivo', value: data.objectiveTitle },
            { label: 'Tipo', value: data.objectiveType },
            { label: 'Estado', value: 'Completado' },
          ])}
          ${this.paragraph('Puedes revisar los detalles y las actualizaciones de progreso en la plataforma.')}
          ${this.cta('Ver objetivos del equipo', `${this.appUrl}/dashboard/objetivos`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Check-in Overdue (Manager Reminder) ──────────────────────

  async sendCheckinOverdue(
    email: string,
    data: { firstName: string; daysSince: number | null; tenantId?: string; userId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback', data.userId))) return;
    const daysMsg = data.daysSince
      ? `Han pasado <strong>${data.daysSince} días</strong> desde tu último check-in.`
      : 'No tienes check-ins registrados con tu equipo.';

    await this.send(
      email,
      `Recordatorio: agenda un check-in con tu equipo`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: data.daysSince ? `Han pasado ${data.daysSince} días sin check-ins.` : 'Agenda un check-in con tu equipo.',
        accentColor: '#f59e0b',
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Check-in pendiente 📅')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, ${daysMsg}`)}
          ${this.alertBox('Las reuniones 1:1 regulares mejoran el rendimiento y la retención del equipo. Te recomendamos agendar al menos un check-in cada 2 semanas.', 'warning')}
          ${this.cta('Agendar check-in', `${this.appUrl}/dashboard/feedback`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Check-in Rejected ──────────────────────────────────────────

  async sendCheckinRejected(
    email: string,
    data: {
      managerName: string;
      employeeName: string;
      topic: string;
      scheduledDate: string;
      scheduledTime?: string;
      reason: string;
      tenantId?: string;
      userId?: string;
    },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback', data.userId))) return;
    const timeLabel = data.scheduledTime ? ` a las ${data.scheduledTime}` : '';
    await this.send(
      email,
      `Check-in rechazado: ${data.topic}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.employeeName} ha rechazado el check-in "${data.topic}".`,
        accentColor: '#f59e0b',
        userIdForUnsubscribe: data.userId,
        body: `
          ${this.heading('Check-in rechazado')}
          ${this.paragraph(`Hola <strong>${data.managerName}</strong>, <strong>${data.employeeName}</strong> ha rechazado el check-in programado.`)}
          ${this.infoBox([
            { label: 'Tema', value: data.topic },
            { label: 'Fecha', value: `${data.scheduledDate}${timeLabel}` },
            { label: 'Motivo del rechazo', value: data.reason },
          ])}
          ${this.paragraph('Puedes reprogramar el check-in o contactar al colaborador para coordinar una nueva fecha.')}
          ${this.cta('Ver check-ins', `${this.appUrl}/dashboard/checkins`)}
        `,
      }),
      undefined,
      { userIdForUnsubscribe: data.userId },
    );
  }

  // ─── Template: Password Reset ────────────────────────────────────────────

  async sendPasswordReset(
    email: string,
    data: { firstName: string; code: string; expiryMinutes: number; tenantId?: string },
  ) {
    await this.send(
      email,
      'Código de recuperación — Eva360',
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Recibimos tu solicitud de recuperación de contraseña. El código expira en ${data.expiryMinutes} minutos.`,
        body: `
          ${this.heading('Recuperar contraseña 🔑')}
          ${this.paragraph(`Hola <strong>${data.firstName || ''}</strong>, recibimos una solicitud para restablecer tu contraseña. Usa el siguiente código:`)}
          <div style="background:#f1f5f9;border-radius:10px;padding:1.5rem;text-align:center;margin:1.5rem 0;">
            <span style="font-size:2.2rem;font-weight:800;letter-spacing:0.3em;color:#1e293b;">${data.code}</span>
          </div>
          ${this.alertBox(`Este código expira en <strong>${data.expiryMinutes} minutos</strong>. Si no solicitaste este cambio, puedes ignorar este correo.`, 'info')}
          ${this.divider()}
          ${this.smallText('Por seguridad, nunca compartas este código con nadie.')}
        `,
      }),
    );
  }

  // ─── Payment transactional emails (never respect unsubscribe) ────────────

  /** Confirmation after a successful online payment. Triggered from the
   *  Stripe/MercadoPago webhook flow. */
  async sendPaymentReceived(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      amount: number;
      currency: string;
      invoiceNumber: string;
      tenantId?: string;
    },
  ) {
    const formattedAmount = this.formatAmount(data.amount, data.currency);
    await this.send(
      email,
      `✓ Pago recibido — ${data.invoiceNumber}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Hemos recibido el pago de ${formattedAmount}. Gracias.`,
        body: `
          ${this.heading('Pago recibido ✓')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, confirmamos que recibimos el pago de tu factura.`)}
          ${this.infoBox([
            { label: 'Organización', value: data.orgName || '—' },
            { label: 'Factura', value: data.invoiceNumber },
            { label: 'Monto', value: formattedAmount },
          ])}
          ${this.paragraph('Tu acceso al servicio continúa sin interrupciones. Puedes descargar el comprobante desde la plataforma.')}
          ${this.cta('Ver mi suscripción', `${this.appUrl}/dashboard/mi-suscripcion`)}
          ${this.divider()}
          ${this.smallText('Si tienes dudas sobre este pago, responde a este correo y el equipo de soporte te contactará.')}
        `,
      }),
    );
  }

  /** Sent when a provider rejects a payment attempt. Includes the reason
   *  the provider gave (when available) to help the user fix it (e.g.
   *  "insufficient_funds", "expired_card"). */
  async sendPaymentFailed(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      amount: number;
      currency: string;
      invoiceNumber: string;
      failureReason: string;
      retryUrl: string;
      tenantId?: string;
    },
  ) {
    const formattedAmount = this.formatAmount(data.amount, data.currency);
    await this.send(
      email,
      `⚠️ No pudimos procesar tu pago — ${data.invoiceNumber}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: 'Tu pago no pudo procesarse. Puedes reintentar con otra tarjeta.',
        accentColor: '#ef4444',
        body: `
          ${this.heading('Pago no procesado')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, el pago de tu factura <strong>${data.invoiceNumber}</strong> no pudo completarse.`)}
          ${this.infoBox([
            { label: 'Organización', value: data.orgName || '—' },
            { label: 'Monto', value: formattedAmount },
            { label: 'Motivo', value: data.failureReason },
          ])}
          ${this.alertBox('Tu acceso al servicio puede verse afectado si el pago no se regulariza pronto. Reintentar con otra tarjeta suele resolverlo.', 'warning')}
          ${this.cta('Reintentar pago', data.retryUrl)}
          ${this.divider()}
          ${this.smallText('Si este problema persiste, contacta a tu banco o al equipo de soporte de Eva360.')}
        `,
      }),
    );
  }

  // ─── Impersonation emails (transactional) ──────────────────────────────

  /**
   * Sent when a super_admin starts impersonating a tenant user. The target
   * (usually a tenant_admin) learns about the access immediately, creating
   * an out-of-band audit trail independent of our audit_log table.
   */
  async sendImpersonationStarted(
    email: string,
    data: {
      firstName: string;
      superAdminName: string;
      reason: string;
      durationMinutes: number;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Soporte Eva360 ha accedido a tu cuenta`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.superAdminName} inició una sesión de soporte en tu cuenta.`,
        accentColor: '#f59e0b',
        body: `
          ${this.heading('Acceso de soporte iniciado 🔍')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, un agente de soporte de Eva360 ha iniciado una sesión en tu cuenta con fines de asistencia.`)}
          ${this.infoBox([
            { label: 'Agente', value: data.superAdminName },
            { label: 'Motivo', value: data.reason },
            { label: 'Duración máxima', value: `${data.durationMinutes} minutos` },
          ])}
          ${this.alertBox('Toda acción realizada durante esta sesión queda registrada en el log de auditoría con la identidad del agente. La sesión termina automáticamente al cerrar o al cumplirse la duración máxima.', 'info')}
          ${this.smallText('Si no solicitaste esta asistencia, responde a este correo inmediatamente para que investiguemos.')}
        `,
      }),
    );
  }

  /**
   * Follow-up sent when the impersonation session ends IF it lasted more
   * than 5 minutes. Short diagnostic sessions skip this to avoid noise.
   */
  async sendImpersonationEnded(
    email: string,
    data: {
      firstName: string;
      superAdminName: string;
      durationMinutes: number;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Sesión de soporte finalizada`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.superAdminName} terminó la sesión de soporte en tu cuenta.`,
        body: `
          ${this.heading('Sesión de soporte finalizada ✓')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, la sesión de soporte iniciada por <strong>${data.superAdminName}</strong> ha finalizado.`)}
          ${this.infoBox([
            { label: 'Duración', value: `${data.durationMinutes} minutos` },
          ])}
          ${this.smallText('Puedes revisar el detalle completo de las acciones realizadas en el log de auditoría de tu tenant.')}
        `,
      }),
    );
  }

  // ─── Password policy emails (transactional) ─────────────────────────────

  /**
   * Sent 7/3/1 days before `passwordChangedAt + expiryDays`. Dedupe keyed by
   * bucket in `user.notificationPreferences.__password_expiry_sent` so the
   * daily cron doesn't spam.
   */
  async sendPasswordExpiringSoon(
    email: string,
    data: { firstName: string; orgName: string; daysLeft: number; tenantId?: string },
  ) {
    const urgency = data.daysLeft <= 1 ? '🚨' : data.daysLeft <= 3 ? '⚠️' : '🔔';
    await this.send(
      email,
      `${urgency} Tu contraseña vence en ${data.daysLeft} día${data.daysLeft === 1 ? '' : 's'}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Cambia tu contraseña antes de que expire para evitar perder el acceso.`,
        accentColor: data.daysLeft <= 1 ? '#ef4444' : '#f59e0b',
        body: `
          ${this.heading(`Tu contraseña vence pronto ${urgency}`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, la política de contraseñas de <strong>${data.orgName || 'tu organización'}</strong> indica que tu contraseña vencerá en <strong>${data.daysLeft} día${data.daysLeft === 1 ? '' : 's'}</strong>.`)}
          ${this.alertBox('Si no cambias tu contraseña antes del vencimiento, deberás hacerlo la próxima vez que inicies sesión.', 'warning')}
          ${this.cta('Cambiar contraseña ahora', `${this.appUrl}/dashboard/perfil`)}
          ${this.smallText('Si no recuerdas tu contraseña actual, usa el flujo de recuperación desde la pantalla de login.')}
        `,
      }),
    );
  }

  // ─── Trial nurture emails (transactional, onboarding sequence) ───────────
  //
  // These 6 emails kick off on trial creation and walk the admin through
  // the 14-day trial + 3-day post-expiry window. They are transactional in
  // spirit — no per-category opt-out — but if a user cancels the trial
  // subscription the cron simply stops emailing because status changes.

  async sendTrialWelcome(
    email: string,
    data: { firstName: string; orgName: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `Bienvenido/a a Eva360 — tu trial comienza hoy 🎉`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `En 3 pasos lanzas tu primer ciclo de evaluación.`,
        body: `
          ${this.heading(`Bienvenido/a a Eva360 👋`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tu cuenta de <strong>${data.orgName}</strong> está activa con un trial de <strong>14 días</strong>. Tienes acceso completo para que puedas explorar la plataforma.`)}
          ${this.infoBox([
            { label: 'Paso 1', value: 'Invita a tu equipo (usuarios + jefaturas)' },
            { label: 'Paso 2', value: 'Define competencias y cargos' },
            { label: 'Paso 3', value: 'Lanza tu primer ciclo de evaluación' },
          ])}
          ${this.paragraph('Cualquier duda, responde a este correo — un especialista te ayudará a arrancar.')}
          ${this.cta('Ir a mi dashboard', `${this.appUrl}/dashboard`)}
        `,
      }),
    );
  }

  async sendTrialDay3CheckIn(
    email: string,
    data: { firstName: string; orgName: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `¿Cómo vas con Eva360?`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Un video corto para sacar el máximo a tu trial.`,
        body: `
          ${this.heading(`¿Cómo vas? 🤔`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, ya llevas 3 días probando Eva360 en <strong>${data.orgName}</strong>. Te dejamos un check-list de lo esencial:`)}
          <ul style="padding-left:1.5rem;margin:0 0 1rem;color:#334155;font-size:0.92rem;line-height:1.7;">
            <li>Cargar al equipo (mínimo 3 personas para probar 360°).</li>
            <li>Crear o adaptar una plantilla de evaluación.</li>
            <li>Definir las competencias que mides hoy.</li>
          </ul>
          ${this.paragraph('Si algún paso te bloquea, respondemos en menos de 2 horas hábiles.')}
          ${this.cta('Continuar en mi dashboard', `${this.appUrl}/dashboard`)}
        `,
      }),
    );
  }

  async sendTrialDay7Value(
    email: string,
    data: { firstName: string; orgName: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `Descubre OKRs y calibración en Eva360`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Dos funciones que hacen la diferencia en equipos de 20+.`,
        body: `
          ${this.heading(`Ya conoces lo básico — pasemos a lo grande 🚀`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, a 7 días del trial, estas dos funciones suelen ser las que deciden compras:`)}
          ${this.infoBox([
            { label: 'OKRs', value: 'Objetivos y Key Results conectados a evaluaciones.' },
            { label: 'Calibración', value: 'Comparador de desempeño entre jefaturas para evitar sesgos.' },
          ])}
          ${this.paragraph('Puedes activarlos desde el menú lateral. Si tienes dudas, agendemos 20 minutos.')}
          ${this.cta('Explorar funcionalidades', `${this.appUrl}/dashboard`)}
        `,
      }),
    );
  }

  async sendTrialDay11Urgency(
    email: string,
    data: { firstName: string; orgName: string; daysLeft: number; tenantId?: string },
  ) {
    await this.send(
      email,
      `Tu trial termina en ${data.daysLeft} día${data.daysLeft === 1 ? '' : 's'}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Elige un plan para no perder el acceso.`,
        accentColor: '#f59e0b',
        body: `
          ${this.heading(`Tu trial termina en ${data.daysLeft} día${data.daysLeft === 1 ? '' : 's'} ⏰`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, el trial de <strong>${data.orgName}</strong> está por vencer. Elige un plan para mantener el acceso a evaluaciones, OKRs, PDI y el resto.`)}
          ${this.alertBox('Tus datos quedan intactos si no eliges plan a tiempo — simplemente el acceso queda bloqueado hasta regularizar.', 'info')}
          ${this.cta('Ver planes y precios', `${this.appUrl}/dashboard/mi-suscripcion`)}
          ${this.smallText('Si necesitas asesoría para elegir, responde este correo y te contactamos.')}
        `,
      }),
    );
  }

  async sendTrialExpired(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      planName: string;
      planPrice: string;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Tu trial terminó — reactiva en un click`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tus datos están a salvo. Elige un plan para continuar.`,
        body: `
          ${this.heading(`Tu trial terminó`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, el trial de <strong>${data.orgName}</strong> ha finalizado. Tus datos (usuarios, evaluaciones, competencias) están guardados y listos para continuar cuando actives un plan.`)}
          ${data.planName ? this.infoBox([
            { label: 'Plan sugerido', value: data.planName },
            ...(data.planPrice ? [{ label: 'Valor', value: data.planPrice }] : []),
          ]) : ''}
          ${this.cta('Activar mi plan', `${this.appUrl}/dashboard/mi-suscripcion`)}
          ${this.smallText('Si prefieres hablar con un asesor antes de decidir, estamos a un correo de distancia.')}
        `,
      }),
    );
  }

  async sendTrialRecovery(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      discountPercentage: number;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Te extrañamos — ${data.discountPercentage}% off para volver`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Cupón VUELVE20 — válido esta semana.`,
        body: `
          ${this.heading(`Te extrañamos 👋`)}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, sabemos que evaluar al equipo toma tiempo. Te ofrecemos un <strong>${data.discountPercentage}% de descuento</strong> sobre tu primer mes si activas tu suscripción esta semana.`)}
          ${this.infoBox([
            { label: 'Cupón', value: 'VUELVE20' },
            { label: 'Válido por', value: '7 días' },
            { label: 'Aplica a', value: 'Primer mes de cualquier plan' },
          ])}
          ${this.cta('Activar con descuento', `${this.appUrl}/dashboard/mi-suscripcion`)}
          ${this.smallText('Al confirmar tu plan, responde este correo mencionando el cupón y lo aplicamos a tu factura.')}
        `,
      }),
    );
  }

  // ─── Dunning emails (transactional — billing is core) ────────────────────

  /** Day +3 overdue — friendly reminder. */
  async sendInvoiceOverdueFriendly(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      invoiceNumber: string;
      amount: number;
      currency: string;
      daysOverdue: number;
      payUrl: string;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Recordatorio: factura ${data.invoiceNumber} vencida`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tu factura venció hace ${data.daysOverdue} días. Regulariza el pago para mantener tu acceso.`,
        body: `
          ${this.heading('Recordatorio de pago 📅')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tu factura <strong>${data.invoiceNumber}</strong> de <strong>${data.orgName}</strong> venció hace ${data.daysOverdue} días.`)}
          ${this.infoBox([
            { label: 'Factura', value: data.invoiceNumber },
            { label: 'Monto', value: this.formatAmount(data.amount, data.currency) },
            { label: 'Días vencida', value: String(data.daysOverdue) },
          ])}
          ${this.paragraph('Puedes pagar online con tarjeta o transferencia desde tu panel. Si ya realizaste el pago, puedes ignorar este mensaje.')}
          ${this.cta('Pagar ahora', data.payUrl)}
        `,
      }),
    );
  }

  /** Day +7 overdue — urgent, mentions upcoming suspension. */
  async sendInvoiceOverdueUrgent(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      invoiceNumber: string;
      amount: number;
      currency: string;
      daysOverdue: number;
      suspendsInDays: number;
      payUrl: string;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `⚠️ Urgente: tu cuenta será suspendida en ${data.suspendsInDays} días`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Regulariza tu factura ${data.invoiceNumber} antes de que tu cuenta sea suspendida.`,
        accentColor: '#f59e0b',
        body: `
          ${this.heading('⚠️ Pago urgente pendiente')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, la factura <strong>${data.invoiceNumber}</strong> de <strong>${data.orgName}</strong> lleva ${data.daysOverdue} días vencida.`)}
          ${this.alertBox(`Tu acceso a Eva360 será <strong>suspendido en ${data.suspendsInDays} días</strong> si el pago no se regulariza. Los datos no se pierden, pero no podrás acceder a evaluaciones, objetivos ni reportes.`, 'warning')}
          ${this.infoBox([
            { label: 'Factura', value: data.invoiceNumber },
            { label: 'Monto', value: this.formatAmount(data.amount, data.currency) },
          ])}
          ${this.cta('Pagar ahora', data.payUrl)}
          ${this.smallText('Si tienes dificultades para pagar, contacta a soporte y podemos ofrecer alternativas.')}
        `,
      }),
    );
  }

  /** Day +14 — the actual suspension event. */
  async sendAccountSuspended(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      invoiceNumber: string;
      payUrl: string;
      cancelsInDays: number;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Tu cuenta ha sido suspendida — ${data.orgName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: 'Tu acceso a Eva360 está suspendido. Regulariza el pago para reactivar.',
        accentColor: '#ef4444',
        body: `
          ${this.heading('Cuenta suspendida 🚫')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tu suscripción de <strong>${data.orgName}</strong> ha sido suspendida por impago de la factura <strong>${data.invoiceNumber}</strong>.`)}
          ${this.alertBox(`Tus datos están intactos y tu cuenta se <strong>reactivará automáticamente</strong> tras procesar el pago. Si no regulas en <strong>${data.cancelsInDays} días</strong>, la cuenta quedará cancelada definitivamente.`, 'danger')}
          ${this.cta('Pagar y reactivar', data.payUrl)}
          ${this.divider()}
          ${this.smallText('Si consideras que esto es un error o necesitas coordinar el pago, responde a este correo y el equipo de soporte te ayudará.')}
        `,
      }),
    );
  }

  /** Day +30 — final warning before cancellation. */
  async sendAccountCancellationWarning(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      payUrl: string;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Último aviso: cancelación en 7 días — ${data.orgName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: 'Tu cuenta será cancelada definitivamente en 7 días si no se regulariza el pago.',
        accentColor: '#ef4444',
        body: `
          ${this.heading('Último aviso antes de cancelación')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tu cuenta de <strong>${data.orgName}</strong> lleva 30 días suspendida. En <strong>7 días</strong> será <strong>cancelada definitivamente</strong>.`)}
          ${this.alertBox('Si se cancela, conservarás acceso a tus datos solo a través de una solicitud GDPR de export. No podrás retomar el servicio sin crear una suscripción nueva.', 'danger')}
          ${this.cta('Regularizar pago ahora', data.payUrl)}
          ${this.smallText('Responde a este correo si necesitas ayuda para cerrar este proceso.')}
        `,
      }),
    );
  }

  /** Day +37 — terminal cancellation. */
  async sendAccountCancelled(
    email: string,
    data: {
      firstName: string;
      orgName: string;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      `Cuenta cancelada — ${data.orgName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: 'Tu cuenta ha sido cancelada por falta de pago.',
        accentColor: '#ef4444',
        body: `
          ${this.heading('Cuenta cancelada')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, tu cuenta de <strong>${data.orgName}</strong> en Eva360 ha sido cancelada por falta de pago prolongada.`)}
          ${this.paragraph('Si deseas retomar el servicio, contáctanos — podemos ayudarte a restablecer la suscripción con los datos preservados por un período limitado.')}
          ${this.divider()}
          ${this.smallText('Gracias por haber usado Eva360.')}
        `,
      }),
    );
  }

  /** Helper — format an amount with the correct style per currency. */
  private formatAmount(amount: number, currency: string): string {
    const c = (currency || '').toUpperCase();
    if (c === 'CLP') {
      // No decimals, dot as thousands separator.
      return `$${Math.round(amount).toLocaleString('es-CL')} CLP`;
    }
    if (c === 'USD') {
      return `US$${amount.toFixed(2)}`;
    }
    if (c === 'UF') {
      return `${amount.toFixed(2)} UF`;
    }
    return `${amount} ${currency}`;
  }

  // ─── GDPR transactional emails (never respect unsubscribe) ────────────────

  /**
   * Delivered when a data-export request has finished generating. The link
   * is time-boxed; after `expiresAt` the backend stops serving it.
   */
  async sendGdprExportReady(
    email: string,
    data: {
      firstName: string;
      downloadUrl: string;
      expiresAt: string;
      scope: 'user' | 'tenant';
      orgName?: string;
      tenantId?: string;
    },
  ) {
    const scopeLabel = data.scope === 'tenant' ? 'la organización' : 'tu cuenta';
    await this.send(
      email,
      'Tu export de datos está listo',
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Descarga el archivo antes del ${data.expiresAt}.`,
        body: `
          ${this.heading('Tu export de datos está listo 📦')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, hemos terminado de procesar tu solicitud de exportación de datos de ${scopeLabel}${data.orgName ? ` <strong>${data.orgName}</strong>` : ''}.`)}
          ${this.cta('Descargar archivo', data.downloadUrl)}
          ${this.infoBox([
            { label: 'Formato', value: 'ZIP (JSON + PDF resumen)' },
            { label: 'Válido hasta', value: data.expiresAt },
          ])}
          ${this.alertBox('El enlace expira en 7 días por seguridad. Descárgalo lo antes posible y guárdalo en un lugar seguro.', 'info')}
          ${this.smallText('Si no solicitaste este export, contacta al administrador de tu organización o al equipo de soporte inmediatamente.')}
        `,
      }),
    );
  }

  /**
   * Delivered when a user initiates account deletion. Contains a 6-digit code
   * they must type back into the UI to confirm. The confirmation is a
   * security control — we do NOT allow one-step deletions.
   */
  async sendGdprDeleteConfirmationCode(
    email: string,
    data: {
      firstName: string;
      code: string;
      expiryMinutes: number;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      'Código para confirmar eliminación de tu cuenta',
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Código de confirmación: ${data.code}. Expira en ${data.expiryMinutes} minutos.`,
        accentColor: '#ef4444',
        body: `
          ${this.heading('Confirmación de eliminación de cuenta ⚠️')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, hemos recibido una solicitud para <strong>eliminar permanentemente</strong> tu cuenta en Eva360.`)}
          ${this.paragraph('Ingresa el siguiente código en la pantalla de confirmación para continuar:')}
          <div style="background:rgba(239,68,68,0.08);border:2px solid #ef4444;border-radius:12px;padding:20px;text-align:center;margin:0 0 1.5rem;">
            <span style="font-size:2.2rem;font-weight:800;letter-spacing:0.3em;color:#991b1b;">${data.code}</span>
          </div>
          ${this.alertBox(`<strong>Esta acción es irreversible.</strong> Al confirmar, tu cuenta será desactivada y tus datos personales anonimizados. Tus evaluaciones históricas, firmas y auditoría se conservarán por obligación legal, pero sin datos identificables asociados a tu persona.`, 'danger')}
          ${this.alertBox(`El código expira en <strong>${data.expiryMinutes} minutos</strong>. Si no solicitaste esta eliminación, <strong>ignora este correo</strong> — tu cuenta queda intacta.`, 'warning')}
          ${this.divider()}
          ${this.smallText('Por seguridad, nunca compartas este código con nadie. Eva360 nunca te pedirá este código por teléfono o chat.')}
        `,
      }),
    );
  }

  /**
   * Sent to the user's old email address right after the anonymization
   * transaction commits. Serves as a receipt and final audit of the deletion.
   * (The email lands before we anonymize, because we call send() before the
   * transaction — see anonymizer.service.ts for order.)
   */
  async sendGdprDeleteConfirmed(
    email: string,
    data: {
      firstName: string;
      orgName?: string;
      tenantId?: string;
    },
  ) {
    await this.send(
      email,
      'Tu cuenta ha sido eliminada',
      await this.wrapWithBranding(data.tenantId, {
        preheader: 'Confirmamos que tu cuenta ha sido eliminada.',
        body: `
          ${this.heading('Cuenta eliminada ✓')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, confirmamos que tu cuenta en Eva360${data.orgName ? ` (<strong>${data.orgName}</strong>)` : ''} ha sido eliminada.`)}
          ${this.paragraph('Tus datos personales identificables han sido anonimizados. Los registros de evaluaciones históricas y auditoría se conservan conforme a obligaciones legales, pero sin datos que te identifiquen.')}
          ${this.infoBox([
            { label: 'Cuenta', value: email },
            { label: 'Fecha de eliminación', value: new Date().toLocaleDateString('es-CL') },
          ])}
          ${this.paragraph('Si consideras que esto fue un error o tienes dudas, responde a este correo y el equipo de soporte te contactará. Gracias por haber usado Eva360.')}
          ${this.divider()}
          ${this.smallText('Este es el último correo que recibirás desde Eva360 asociado a esta cuenta.')}
        `,
      }),
    );
  }

  // ─── HTML Builder Helpers ──────────────────────────────────────────────────

  private wrap({ body, preheader = '', accentColor = '#C9933A', orgLogoUrl, orgName, unsubscribeUrl }: {
    body: string;
    preheader?: string;
    accentColor?: string;
    orgLogoUrl?: string | null;
    orgName?: string;
    /** If set, renders a "Darse de baja" link in the footer. Leave
     *  undefined for broadcasts or transactional emails. */
    unsubscribeUrl?: string;
  }): string {
    // Build the org logo row: if an org logo is provided, show it above the Eva360 header
    const orgLogoHtml = orgLogoUrl ? `
        <tr>
          <td style="background:linear-gradient(135deg,#0a0b0e 0%,#1a1208 100%);border-radius:16px 16px 0 0;padding:24px 36px 0;text-align:center;">
            <img src="${orgLogoUrl}" alt="${orgName || 'Logo'}" width="120" height="auto" style="max-width:120px;max-height:60px;object-fit:contain;" />
            ${orgName ? `<p style="margin:8px 0 0;font-size:0.85rem;color:rgba(255,255,255,0.7);font-weight:500;">${orgName}</p>` : ''}
          </td>
        </tr>` : '';

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eva360</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;color:#f8fafc;font-size:1px;">${preheader}</div>` : ''}

  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Org Logo (if configured) -->${orgLogoHtml}

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a0b0e 0%,#1a1208 100%);${orgLogoUrl ? 'padding:12px 36px 28px;' : 'border-radius:16px 16px 0 0;padding:28px 36px;'}text-align:center;">
            <div style="display:inline-flex;align-items:center;gap:10px;">
              <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="40" height="40" rx="10" fill="${accentColor}" fill-opacity="0.15"/>
                <path d="M20 8L32 14V26L20 32L8 26V14L20 8Z" stroke="${accentColor}" stroke-width="2" fill="none"/>
                <circle cx="20" cy="20" r="4" fill="${accentColor}"/>
              </svg>
              <span style="color:#E8C97A;font-size:1.2rem;font-weight:700;letter-spacing:-0.02em;">Eva<span style="color:#ffffff;font-weight:400;">360</span></span>
            </div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:36px 40px;">
            ${body}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f1f5f9;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center;">
            <p style="margin:0;font-size:0.75rem;color:#94a3b8;line-height:1.6;">
              © ${new Date().getFullYear()} Eva360. Todos los derechos reservados.<br>
              <a href="${this.appUrl}" style="color:#C9933A;text-decoration:none;">ascenda.cl</a>
              &nbsp;·&nbsp;
              <a href="${this.appUrl}/dashboard/ajustes" style="color:#94a3b8;text-decoration:none;">Preferencias</a>
              ${unsubscribeUrl ? `&nbsp;·&nbsp;<a href="${unsubscribeUrl}" style="color:#94a3b8;text-decoration:none;">Darse de baja</a>` : ''}
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private heading(text: string): string {
    return `<h1 style="margin:0 0 1rem;font-size:1.5rem;font-weight:700;color:#0f172a;letter-spacing:-0.02em;line-height:1.3;">${text}</h1>`;
  }

  private paragraph(text: string): string {
    return `<p style="margin:0 0 1.25rem;font-size:0.95rem;color:#374151;line-height:1.7;">${text}</p>`;
  }

  private cta(label: string, href: string): string {
    return `
      <div style="text-align:center;margin:2rem 0;">
        <a href="${href}" style="display:inline-block;background:#C9933A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:0.95rem;font-weight:600;letter-spacing:0.01em;box-shadow:0 4px 12px rgba(201,147,58,0.35);">
          ${label} →
        </a>
      </div>`;
  }

  private infoBox(rows: Array<{ label: string; value: string }>): string {
    const rowsHtml = rows
      .map((r) => `
        <tr>
          <td style="padding:8px 16px;font-size:0.82rem;color:#64748b;font-weight:600;width:40%;border-bottom:1px solid #f1f5f9;">${r.label}</td>
          <td style="padding:8px 16px;font-size:0.88rem;color:#0f172a;border-bottom:1px solid #f1f5f9;">${r.value}</td>
        </tr>`)
      .join('');
    return `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:10px;margin:0 0 1.5rem;overflow:hidden;border:1px solid #e2e8f0;">
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  private alertBox(message: string, type: 'info' | 'warning' | 'danger'): string {
    const colors = {
      info: { bg: 'rgba(201,147,58,0.08)', border: '#C9933A', text: '#92400e' },
      warning: { bg: 'rgba(245,158,11,0.08)', border: '#f59e0b', text: '#92400e' },
      danger: { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: '#991b1b' },
    };
    const c = colors[type];
    return `
      <div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 1.5rem;font-size:0.88rem;color:${c.text};line-height:1.6;">
        ${message}
      </div>`;
  }

  private divider(): string {
    return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:1.5rem 0;">`;
  }

  private smallText(text: string): string {
    return `<p style="margin:0;font-size:0.8rem;color:#94a3b8;line-height:1.6;">${text}</p>`;
  }

  // ─── Template: Lead captured (auto-responder al prospect) ───────────────

  /**
   * Email automático que recibe el LEAD al enviar el form de la landing.
   * "Gracias, te contactamos en 24h" con el branding corporativo Ascenda
   * (dorado + cream), distinto del branding Eva360 (negro + dorado) para
   * que quede claro que es Ascenda quien le escribirá.
   */
  async sendLeadAutoresponder(
    email: string,
    data: { firstName: string; company: string },
  ): Promise<void> {
    const subject = 'Gracias por contactarnos — Ascenda';
    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#FDFAF4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1614;">
        <div style="max-width:560px;margin:2rem auto;background:#FFFFFF;border:1px solid #E5D4A8;border-radius:14px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#08090B 0%,#1F1914 100%);padding:2rem;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:1.8rem;font-weight:700;color:#F5E4A8;letter-spacing:0.12em;">ASCENDA</div>
            <div style="font-size:0.72rem;color:rgba(245,228,168,0.7);letter-spacing:0.2em;margin-top:0.3rem;">SOCIOS EN CRECIMIENTO COMERCIAL</div>
          </div>
          <div style="padding:2.5rem 2rem;">
            <h2 style="font-family:Georgia,serif;font-size:1.5rem;font-weight:500;margin:0 0 1rem;color:#1A1614;">
              Hola ${this.escapeHtml(data.firstName)}, gracias por escribirnos.
            </h2>
            <p style="font-size:1rem;line-height:1.65;color:#45403C;margin:0 0 1.25rem;">
              Recibimos tu solicitud de contacto desde <strong>${this.escapeHtml(data.company)}</strong>
              y ya está en la bandeja de nuestro equipo comercial.
            </p>
            <p style="font-size:1rem;line-height:1.65;color:#45403C;margin:0 0 1.5rem;">
              Un consultor senior de Ascenda te contactará <strong>en menos de 24 horas hábiles</strong>
              con una propuesta inicial adaptada a tu caso y, si aplica, coordinaremos una demo
              personalizada de Eva360.
            </p>
            <div style="padding:1rem 1.2rem;background:#FCF7EB;border-left:3px solid #C9933A;border-radius:0 8px 8px 0;margin:0 0 1.5rem;">
              <p style="margin:0;font-size:0.9rem;color:#6B4A18;line-height:1.55;">
                Mientras tanto, si surgen preguntas urgentes puedes escribirnos directo a
                <a href="mailto:contacto@ascenda.cl" style="color:#8A6318;font-weight:500;">contacto@ascenda.cl</a>
                o responder este mismo correo.
              </p>
            </div>
            <p style="font-size:0.95rem;color:#45403C;margin:0;">
              Saludos,<br/>
              <strong>Equipo Ascenda</strong>
            </p>
          </div>
          <div style="background:#F4EFE4;padding:1.2rem 2rem;border-top:1px solid #E5D4A8;text-align:center;">
            <p style="margin:0;font-size:0.78rem;color:#7A746C;">
              Ascenda SpA · Santiago · Chile
            </p>
          </div>
        </div>
      </body></html>`;
    // Sin tenantId — el lead aún no pertenece a ningún tenant.
    await this.send(email, subject, html);
  }

  // ─── Template: Lead received (notificación interna) ─────────────────────

  /**
   * Notificación interna al equipo comercial cuando un nuevo lead llega.
   * Se envía a contacto@ascenda.cl con todos los detalles del form.
   */
  async sendLeadReceivedInternal(data: {
    leadId: string;
    name: string;
    company: string;
    role: string | null;
    email: string;
    phone: string;
    companySize: string | null;
    industry: string | null;
    region: string | null;
    source: string | null;
    message: string;
    origin: string;
    ipAddress: string | null;
    captchaVerdict: string;
  }): Promise<void> {
    const to = process.env.LEADS_NOTIFY_TO || 'contacto@ascenda.cl';
    const subject = `🌟 Nuevo lead: ${data.company} (${data.name})`;
    const escape = (v: string | null | undefined) => (v ? this.escapeHtml(v) : '<span style="color:#9ca3af;">—</span>');

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
        <div style="max-width:640px;margin:2rem auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
          <div style="background:#08090B;padding:1.25rem 2rem;border-bottom:3px solid #C9933A;">
            <div style="font-family:Georgia,serif;color:#F5E4A8;font-size:1.2rem;font-weight:700;letter-spacing:0.1em;">ASCENDA · LEADS</div>
          </div>
          <div style="padding:1.75rem 2rem;">
            <h2 style="margin:0 0 0.25rem;font-size:1.3rem;font-weight:700;color:#0f172a;">
              ${this.escapeHtml(data.company)}
            </h2>
            <p style="margin:0 0 1.5rem;font-size:0.9rem;color:#64748b;">
              ${this.escapeHtml(data.name)}${data.role ? ' · ' + this.escapeHtml(data.role) : ''}
            </p>

            <table style="width:100%;border-collapse:collapse;font-size:0.9rem;margin:0 0 1.5rem;">
              <tr>
                <td style="padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;width:35%;">Email</td>
                <td style="padding:0.5rem 0.75rem;border:1px solid #e2e8f0;">
                  <a href="mailto:${this.escapeHtml(data.email)}" style="color:#8A6318;font-weight:500;">${this.escapeHtml(data.email)}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Teléfono</td>
                <td style="padding:0.5rem 0.75rem;border:1px solid #e2e8f0;">
                  <a href="tel:${this.escapeHtml(data.phone)}" style="color:#8A6318;font-weight:500;">${this.escapeHtml(data.phone)}</a>
                </td>
              </tr>
              <tr>
                <td style="padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Tamaño</td>
                <td style="padding:0.5rem 0.75rem;border:1px solid #e2e8f0;">${escape(data.companySize)}</td>
              </tr>
              <tr>
                <td style="padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Industria</td>
                <td style="padding:0.5rem 0.75rem;border:1px solid #e2e8f0;">${escape(data.industry)}</td>
              </tr>
              <tr>
                <td style="padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Región</td>
                <td style="padding:0.5rem 0.75rem;border:1px solid #e2e8f0;">${escape(data.region)}</td>
              </tr>
              <tr>
                <td style="padding:0.5rem 0.75rem;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;">Fuente</td>
                <td style="padding:0.5rem 0.75rem;border:1px solid #e2e8f0;">${escape(data.source)}</td>
              </tr>
            </table>

            <h3 style="margin:0 0 0.5rem;font-size:0.85rem;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Mensaje</h3>
            <div style="padding:1rem 1.2rem;background:#FCF7EB;border-left:3px solid #C9933A;border-radius:0 8px 8px 0;font-size:0.95rem;line-height:1.6;color:#1A1614;white-space:pre-wrap;margin:0 0 1.5rem;">
${this.escapeHtml(data.message)}
            </div>

            <div style="background:#f8fafc;padding:0.8rem 1rem;border-radius:8px;font-size:0.78rem;color:#64748b;line-height:1.6;">
              <strong>Lead ID:</strong> ${this.escapeHtml(data.leadId)}<br/>
              <strong>Origen:</strong> ${this.escapeHtml(data.origin)} ·
              <strong>CAPTCHA:</strong> ${this.escapeHtml(data.captchaVerdict)} ·
              <strong>IP:</strong> ${escape(data.ipAddress)}
            </div>

            <div style="margin-top:1.5rem;text-align:center;">
              <a href="${this.appUrl}/dashboard/leads/${encodeURIComponent(data.leadId)}"
                 style="display:inline-block;padding:0.7rem 1.4rem;background:#C9933A;color:#08090B;text-decoration:none;font-weight:600;border-radius:999px;font-size:0.9rem;">
                Abrir en el dashboard →
              </a>
            </div>
          </div>
        </div>
      </body></html>`;
    await this.send(to, subject, html);
  }

  /** Pequeño helper para escapar HTML en campos que vienen del usuario. */
  private escapeHtml(s: string | null | undefined): string {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
