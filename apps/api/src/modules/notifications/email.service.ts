import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../tenants/entities/tenant.entity';

/**
 * EmailService — Beautiful branded transactional emails for Ascenda Performance.
 *
 * Uses Resend (https://resend.com) when RESEND_API_KEY is set.
 * Falls back to console logging in development.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private resend: any = null;
  private readonly from = process.env.EMAIL_FROM || 'Ascenda Performance <onboarding@resend.dev>';
  private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';

  constructor(
    @Optional() @InjectRepository(Tenant)
    private readonly tenantRepo?: Repository<Tenant>,
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
   * Check if email notifications are enabled for a tenant + category.
   * Categories: 'evaluations', 'feedback', 'objectives', 'recognitions'
   * Returns true if no tenantId (system emails always sent) or if enabled.
   */
  async isEmailEnabled(tenantId?: string, category?: string): Promise<boolean> {
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

  /** Wraps body with org branding (logo + name) fetched from tenant */
  private async wrapWithBranding(tenantId: string | undefined, opts: {
    body: string; preheader?: string; accentColor?: string;
  }): Promise<string> {
    const branding = await this.getOrgBranding(tenantId);
    return this.wrap({ ...opts, orgLogoUrl: branding.logoUrl, orgName: branding.orgName });
  }

  // ─── Core send ────────────────────────────────────────────────────────────

  async send(to: string | string[], subject: string, html: string, tenantId?: string): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];
    const from = await this.getFromAddress(tenantId);

    if (!this.resend) {
      this.logger.log(`[EMAIL PREVIEW]\nFrom: ${from}\nTo: ${recipients.join(', ')}\nSubject: ${subject}\n---`);
      return;
    }

    try {
      const result = await this.resend.emails.send({ from, to: recipients, subject, html });
      this.logger.log(`✉️  Email sent: to=${recipients.join(', ')}, from=${from}, id=${result?.data?.id || 'ok'}`);
    } catch (err: any) {
      this.logger.error(`❌ Email FAILED: to=${recipients.join(', ')}, from=${from}, error=${err?.message}`);
    }
  }

  /** Send email with file attachments (e.g., .ics calendar files) */
  async sendWithAttachments(
    to: string | string[],
    subject: string,
    html: string,
    attachments: Array<{ filename: string; content: string; contentType: string }>,
    tenantId?: string,
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];
    const from = await this.getFromAddress(tenantId);

    if (!this.resend) {
      this.logger.log(`[EMAIL PREVIEW+ATTACHMENT]\nFrom: ${from}\nTo: ${recipients.join(', ')}\nSubject: ${subject}\nAttachments: ${attachments.map(a => a.filename).join(', ')}\n---`);
      return;
    }

    try {
      const result = await this.resend.emails.send({ from, to: recipients, subject, html, attachments });
      this.logger.log(`✉️  Email+attachment sent: to=${recipients.join(', ')}, from=${from}, id=${result?.data?.id || 'ok'}`);
    } catch (err: any) {
      this.logger.error(`❌ Email+attachment FAILED: to=${recipients.join(', ')}, from=${from}, error=${err?.message}`);
    }
  }

  // ─── Template: Cycle Launched ─────────────────────────────────────────────

  async sendCycleLaunched(
    email: string,
    data: { firstName: string; cycleName: string; cycleType: string; dueDate: string; cycleId: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'evaluations'))) return;
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
    );
  }

  // ─── Template: Evaluation Reminder ───────────────────────────────────────

  async sendEvaluationReminder(
    email: string,
    data: { firstName: string; cycleName: string; pendingCount: number; daysLeft: number; cycleId: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'evaluations'))) return;
    const urgency = data.daysLeft <= 1 ? '🚨 Urgente' : data.daysLeft <= 3 ? '⚠️ Pronto vence' : '🔔 Recordatorio';

    await this.send(
      email,
      `${urgency}: ${data.pendingCount} evaluación${data.pendingCount > 1 ? 'es' : ''} pendiente${data.pendingCount > 1 ? 's' : ''} en ${data.cycleName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Te ${data.daysLeft === 1 ? 'queda 1 día' : `quedan ${data.daysLeft} días`} para completar tus evaluaciones.`,
        accentColor: data.daysLeft <= 1 ? '#ef4444' : data.daysLeft <= 3 ? '#f59e0b' : '#C9933A',
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
    );
  }

  // ─── Template: Cycle Closed / Results Available ───────────────────────────

  async sendCycleClosed(
    email: string,
    data: { firstName: string; cycleName: string; cycleId: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'evaluations'))) return;
    await this.send(
      email,
      `Resultados disponibles: ${data.cycleName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `El ciclo ${data.cycleName} ha finalizado. Tus resultados están disponibles.`,
        body: `
          ${this.heading('Resultados de evaluación listos ✅')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, el ciclo de evaluación <strong>${data.cycleName}</strong> ha concluido y tus resultados están disponibles en la plataforma.`)}
          ${this.paragraph('Revisa tu desempeño, el feedback de tus evaluadores y las oportunidades de desarrollo identificadas.')}
          ${this.cta('Ver mis resultados', `${this.appUrl}/dashboard/mi-desempeno`)}
          ${this.divider()}
          ${this.smallText('Si tienes preguntas sobre tus resultados, consulta con tu jefatura directa o con el área de RRHH.')}
        `,
      }),
    );
  }

  // ─── Template: User Invitation ────────────────────────────────────────────

  async sendInvitation(
    email: string,
    data: { firstName: string; orgName: string; tempPassword?: string; inviterName?: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `Te han invitado a Ascenda Performance — ${data.orgName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.inviterName || data.orgName} te ha invitado a la plataforma de evaluación de desempeño.`,
        body: `
          ${this.heading('¡Bienvenido/a a Ascenda Performance! 🎉')}
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

  // ─── Template: Check-in Scheduled ────────────────────────────────────────

  async sendCheckinScheduled(
    email: string,
    data: { firstName: string; managerName: string; scheduledAt: string; topic?: string; checkinId: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return;
    await this.send(
      email,
      `Check-in 1:1 agendado con ${data.managerName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes un check-in programado para el ${data.scheduledAt}.`,
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
    );
  }

  /** Build the check-in HTML without sending — used by FeedbackService to attach .ics. Returns null if emails disabled. */
  async buildCheckinScheduledHtml(
    data: { firstName: string; managerName: string; scheduledAt: string; topic?: string; checkinId: string; tenantId?: string },
  ): Promise<string | null> {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return null;
    return this.wrapWithBranding(data.tenantId, {
      preheader: `Tienes un check-in programado para el ${data.scheduledAt}.`,
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
    data: { firstName: string; objectives: Array<{ title: string; progress: number; daysLeft: number }>; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'objectives'))) return;
    const list = data.objectives
      .map((o) => `<li style="margin-bottom:0.5rem;"><strong>${o.title}</strong> — ${o.progress}% completado, vence en ${o.daysLeft} días</li>`)
      .join('');

    await this.send(
      email,
      `${data.objectives.length} objetivo${data.objectives.length > 1 ? 's' : ''} en riesgo de no cumplirse`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes objetivos que están en riesgo de no alcanzarse antes de su fecha límite.`,
        accentColor: '#f59e0b',
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
          ${this.paragraph('Si necesitas renovar o tienes preguntas, contacta al equipo de Ascenda.')}
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
    },
  ) {
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
    );
  }

  // ─── Template: Template/Competency Review Pending ─────────────────────────

  async sendPendingReview(
    email: string,
    data: { adminName: string; itemType: 'plantilla' | 'competencia'; itemName: string; proposedBy: string; tenantId?: string },
  ) {
    await this.send(
      email,
      `Nueva ${data.itemType} pendiente de revisión: ${data.itemName}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.proposedBy} ha propuesto una nueva ${data.itemType} que requiere tu aprobación.`,
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
    );
  }

  // ─── Template: Recognition Received ───────────────────────────────────────

  async sendRecognitionReceived(
    email: string,
    data: { firstName: string; fromName: string; message: string; valueName?: string; points: number; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'recognitions'))) return;
    const msgPreview = data.message.length > 120 ? data.message.substring(0, 120) + '...' : data.message;
    await this.send(
      email,
      `${data.fromName} te ha reconocido`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Has recibido un reconocimiento de ${data.fromName}. +${data.points} puntos.`,
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
    data: { firstName: string; surveyTitle: string; dueDate: string; isAnonymous: boolean; tenantId?: string },
  ) {
    const anonymousNote = data.isAnonymous
      ? 'Tus respuestas serán completamente <strong>anónimas</strong>. No se registrará tu identidad.'
      : 'Tus respuestas serán confidenciales y solo visibles para el equipo de RRHH.';

    await this.send(
      email,
      `Nueva encuesta de clima: ${data.surveyTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Se te ha asignado la encuesta "${data.surveyTitle}". Fecha límite: ${data.dueDate}.`,
        body: `
          ${this.heading('Encuesta de Clima Organizacional')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se te ha invitado a participar en la siguiente encuesta:`)}
          ${this.infoBox([
            { label: 'Encuesta', value: data.surveyTitle },
            { label: 'Fecha límite', value: data.dueDate },
          ])}
          ${this.paragraph(anonymousNote)}
          ${this.paragraph('Tu opinión es muy importante para mejorar el ambiente laboral. Por favor responde antes de la fecha límite.')}
          ${this.cta('Responder Encuesta', `${process.env.FRONTEND_URL || 'https://app.ascendaperformance.com'}/dashboard/encuestas-clima`)}
          ${this.smallText('Si tienes problemas para acceder, ingresa a la plataforma y busca la sección "Encuestas de Clima".')}
        `,
      }),
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
    },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return;
    const sentimentLabel = data.sentiment === 'positive' ? 'positivo' : data.sentiment === 'constructive' ? 'constructivo' : '';
    const sentimentIcon = data.sentiment === 'positive' ? '⭐' : data.sentiment === 'constructive' ? '💡' : '💬';

    await this.send(
      email,
      `${sentimentIcon} Nuevo feedback ${sentimentLabel} recibido`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.senderName} te ha enviado feedback${sentimentLabel ? ' ' + sentimentLabel : ''}.`,
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
    );
  }

  // ─── Template: Objective Assigned ─────────────────────────────────────────

  async sendObjectiveAssigned(
    email: string,
    data: { firstName: string; objectiveTitle: string; objectiveType: string; targetDate?: string; assignedBy?: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'objectives'))) return;
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
        body: `
          ${this.heading('Nuevo objetivo asignado 🎯')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se te ha asignado un nuevo objetivo:`)}
          ${this.infoBox(rows)}
          ${this.paragraph('Revisa los detalles y comienza a trabajar en tu objetivo. Recuerda actualizar tu progreso regularmente.')}
          ${this.cta('Ver mis objetivos', `${this.appUrl}/dashboard/objetivos`)}
        `,
      }),
    );
  }

  // ─── Template: PDI Assigned ─────────────────────────────────────────────

  async sendPdiAssigned(
    email: string,
    data: { firstName: string; planTitle: string; createdByName?: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return;
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Plan', value: data.planTitle },
    ];
    if (data.createdByName) rows.push({ label: 'Creado por', value: data.createdByName });

    await this.send(
      email,
      `Plan de desarrollo asignado: ${data.planTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Se te ha asignado el plan de desarrollo "${data.planTitle}".`,
        body: `
          ${this.heading('Plan de desarrollo asignado 📋')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, se te ha creado un plan de desarrollo individual (PDI):`)}
          ${this.infoBox(rows)}
          ${this.paragraph('Revisa las acciones asignadas y comienza a trabajar en tu desarrollo profesional.')}
          ${this.cta('Ver mi plan', `${this.appUrl}/dashboard/mi-desempeno`)}
        `,
      }),
    );
  }

  // ─── Template: PDI Action Overdue ───────────────────────────────────────

  async sendPdiActionOverdue(
    email: string,
    data: { firstName: string; actions: Array<{ description: string; dueDate: string; planTitle: string }>; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return;
    const actionList = data.actions
      .map((a) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;">${a.description.substring(0, 80)}</td><td style="padding:6px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;color:#ef4444;white-space:nowrap;">${a.dueDate}</td></tr>`)
      .join('');

    await this.send(
      email,
      `${data.actions.length} acción(es) de desarrollo vencida(s)`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `Tienes ${data.actions.length} acción(es) de desarrollo vencida(s). Actualiza su estado.`,
        accentColor: '#ef4444',
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
    );
  }

  // ─── Template: Objective Completed ────────────────────────────────────────

  async sendObjectiveCompleted(
    email: string,
    data: { managerName: string; employeeName: string; objectiveTitle: string; objectiveType: string; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'objectives'))) return;
    await this.send(
      email,
      `Objetivo completado: ${data.objectiveTitle}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.employeeName} ha completado el objetivo "${data.objectiveTitle}".`,
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
    );
  }

  // ─── Template: Check-in Overdue (Manager Reminder) ──────────────────────

  async sendCheckinOverdue(
    email: string,
    data: { firstName: string; daysSince: number | null; tenantId?: string },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return;
    const daysMsg = data.daysSince
      ? `Han pasado <strong>${data.daysSince} días</strong> desde tu último check-in.`
      : 'No tienes check-ins registrados con tu equipo.';

    await this.send(
      email,
      `Recordatorio: agenda un check-in con tu equipo`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: data.daysSince ? `Han pasado ${data.daysSince} días sin check-ins.` : 'Agenda un check-in con tu equipo.',
        accentColor: '#f59e0b',
        body: `
          ${this.heading('Check-in pendiente 📅')}
          ${this.paragraph(`Hola <strong>${data.firstName}</strong>, ${daysMsg}`)}
          ${this.alertBox('Las reuniones 1:1 regulares mejoran el rendimiento y la retención del equipo. Te recomendamos agendar al menos un check-in cada 2 semanas.', 'warning')}
          ${this.cta('Agendar check-in', `${this.appUrl}/dashboard/feedback`)}
        `,
      }),
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
    },
  ) {
    if (!(await this.isEmailEnabled(data.tenantId, 'feedback'))) return;
    const timeLabel = data.scheduledTime ? ` a las ${data.scheduledTime}` : '';
    await this.send(
      email,
      `Check-in rechazado: ${data.topic}`,
      await this.wrapWithBranding(data.tenantId, {
        preheader: `${data.employeeName} ha rechazado el check-in "${data.topic}".`,
        accentColor: '#f59e0b',
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
    );
  }

  // ─── Template: Password Reset ────────────────────────────────────────────

  async sendPasswordReset(
    email: string,
    data: { firstName: string; code: string; expiryMinutes: number; tenantId?: string },
  ) {
    await this.send(
      email,
      'Código de recuperación — Ascenda Performance',
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

  // ─── HTML Builder Helpers ──────────────────────────────────────────────────

  private wrap({ body, preheader = '', accentColor = '#C9933A', orgLogoUrl, orgName }: {
    body: string;
    preheader?: string;
    accentColor?: string;
    orgLogoUrl?: string | null;
    orgName?: string;
  }): string {
    // Build the org logo row: if an org logo is provided, show it above the Ascenda header
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
  <title>Ascenda Performance</title>
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
              <span style="color:#E8C97A;font-size:1.2rem;font-weight:700;letter-spacing:-0.02em;">Ascenda <span style="color:#ffffff;font-weight:400;">Performance</span></span>
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
              © ${new Date().getFullYear()} Ascenda Performance. Todos los derechos reservados.<br>
              <a href="${this.appUrl}" style="color:#C9933A;text-decoration:none;">ascenda.cl</a>
              &nbsp;·&nbsp;
              <a href="${this.appUrl}/dashboard/ajustes" style="color:#94a3b8;text-decoration:none;">Preferencias de notificación</a>
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
}
