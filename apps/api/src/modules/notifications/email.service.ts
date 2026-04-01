import { Injectable, Logger } from '@nestjs/common';

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
  private readonly from = process.env.EMAIL_FROM || 'Ascenda Performance <noreply@ascenda.cl>';
  private readonly appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaluacion-desempeno.netlify.app';

  constructor() {
    this.init();
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

  // ─── Core send ────────────────────────────────────────────────────────────

  async send(to: string | string[], subject: string, html: string): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];

    if (!this.resend) {
      this.logger.log(`[EMAIL PREVIEW]\nTo: ${recipients.join(', ')}\nSubject: ${subject}\n---`);
      return;
    }

    try {
      await this.resend.emails.send({ from: this.from, to: recipients, subject, html });
    } catch (err: any) {
      this.logger.error(`Failed to send email to ${recipients.join(', ')}: ${err?.message}`);
    }
  }

  // ─── Template: Cycle Launched ─────────────────────────────────────────────

  async sendCycleLaunched(
    email: string,
    data: { firstName: string; cycleName: string; cycleType: string; dueDate: string; cycleId: string },
  ) {
    const typeLabel: Record<string, string> = {
      '90': 'Evaluación 90°', '180': 'Evaluación 180°',
      '270': 'Evaluación 270°', '360': 'Evaluación 360°',
    };
    const label = typeLabel[data.cycleType] || 'Evaluación de desempeño';

    await this.send(
      email,
      `Nueva evaluación asignada: ${data.cycleName}`,
      this.wrap({
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
    data: { firstName: string; cycleName: string; pendingCount: number; daysLeft: number; cycleId: string },
  ) {
    const urgency = data.daysLeft <= 1 ? '🚨 Urgente' : data.daysLeft <= 3 ? '⚠️ Pronto vence' : '🔔 Recordatorio';

    await this.send(
      email,
      `${urgency}: ${data.pendingCount} evaluación${data.pendingCount > 1 ? 'es' : ''} pendiente${data.pendingCount > 1 ? 's' : ''} en ${data.cycleName}`,
      this.wrap({
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
    data: { firstName: string; cycleName: string; cycleId: string },
  ) {
    await this.send(
      email,
      `Resultados disponibles: ${data.cycleName}`,
      this.wrap({
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
    data: { firstName: string; orgName: string; tempPassword?: string; inviterName?: string },
  ) {
    await this.send(
      email,
      `Te han invitado a Ascenda Performance — ${data.orgName}`,
      this.wrap({
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
    data: { firstName: string; managerName: string; scheduledAt: string; topic?: string; checkinId: string },
  ) {
    await this.send(
      email,
      `Check-in 1:1 agendado con ${data.managerName}`,
      this.wrap({
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

  // ─── Template: OKR At Risk ────────────────────────────────────────────────

  async sendOkrAtRisk(
    email: string,
    data: { firstName: string; objectives: Array<{ title: string; progress: number; daysLeft: number }> },
  ) {
    const list = data.objectives
      .map((o) => `<li style="margin-bottom:0.5rem;"><strong>${o.title}</strong> — ${o.progress}% completado, vence en ${o.daysLeft} días</li>`)
      .join('');

    await this.send(
      email,
      `${data.objectives.length} objetivo${data.objectives.length > 1 ? 's' : ''} en riesgo de no cumplirse`,
      this.wrap({
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
    data: { orgName: string; planName: string; daysLeft: number; expiresAt: string },
  ) {
    await this.send(
      email,
      `⚠️ Tu suscripción vence en ${data.daysLeft} día${data.daysLeft > 1 ? 's' : ''}`,
      this.wrap({
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
      this.wrap({
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
    data: { adminName: string; itemType: 'plantilla' | 'competencia'; itemName: string; proposedBy: string },
  ) {
    await this.send(
      email,
      `Nueva ${data.itemType} pendiente de revisión: ${data.itemName}`,
      this.wrap({
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
    data: { firstName: string; fromName: string; message: string; valueName?: string; points: number },
  ) {
    const msgPreview = data.message.length > 120 ? data.message.substring(0, 120) + '...' : data.message;
    await this.send(
      email,
      `${data.fromName} te ha reconocido`,
      this.wrap({
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
    data: { firstName: string; documentType: string; documentName: string; code: string; expiryMinutes: number },
  ) {
    await this.send(
      email,
      `Código de firma digital — ${data.documentName}`,
      this.wrap({
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

  async sendSurveyInvitation(
    email: string,
    data: { firstName: string; surveyTitle: string; dueDate: string; isAnonymous: boolean },
  ) {
    const anonymousNote = data.isAnonymous
      ? 'Tus respuestas serán completamente <strong>anónimas</strong>. No se registrará tu identidad.'
      : 'Tus respuestas serán confidenciales y solo visibles para el equipo de RRHH.';

    await this.send(
      email,
      `Nueva encuesta de clima: ${data.surveyTitle}`,
      this.wrap({
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

  // ─── HTML Builder Helpers ──────────────────────────────────────────────────

  private wrap({ body, preheader = '', accentColor = '#C9933A' }: {
    body: string;
    preheader?: string;
    accentColor?: string;
  }): string {
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

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a0b0e 0%,#1a1208 100%);border-radius:16px 16px 0 0;padding:28px 36px;text-align:center;">
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
