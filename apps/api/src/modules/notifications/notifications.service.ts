import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private resend: any = null;

  constructor() {
    this.initResend();
  }

  private async initResend() {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn('RESEND_API_KEY not set — emails will be logged to console');
      return;
    }
    try {
      // Dynamic import to avoid build error if not installed
      const resendModule = await import('resend' as string);
      this.resend = new resendModule.Resend(apiKey);
      this.logger.log('Resend email service initialized');
    } catch {
      this.logger.warn('resend package not installed — emails will be logged to console');
    }
  }

  private async send(to: string, subject: string, html: string) {
    if (!this.resend) {
      this.logger.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
      return;
    }
    try {
      await this.resend.emails.send({
        from: 'EvaPro <noreply@evapro.app>',
        to,
        subject,
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${error}`);
    }
  }

  async sendCycleLaunched(email: string, cycleName: string, dueDate: string) {
    await this.send(
      email,
      `Nueva evaluación: ${cycleName}`,
      `<h2>Has sido asignado a una evaluación</h2>
       <p>El ciclo <strong>${cycleName}</strong> ha sido lanzado.</p>
       <p>Fecha límite: <strong>${dueDate}</strong></p>
       <p>Ingresa a EvaPro para completar tus evaluaciones pendientes.</p>`,
    );
  }

  async sendReminder(email: string, cycleName: string, pendingCount: number) {
    await this.send(
      email,
      `Recordatorio: ${pendingCount} evaluaciones pendientes`,
      `<h2>Evaluaciones pendientes</h2>
       <p>Tienes <strong>${pendingCount}</strong> evaluaciones pendientes en el ciclo <strong>${cycleName}</strong>.</p>
       <p>Ingresa a EvaPro para completarlas.</p>`,
    );
  }

  async sendCycleClosed(email: string, cycleName: string) {
    await this.send(
      email,
      `Resultados disponibles: ${cycleName}`,
      `<h2>Resultados de evaluación disponibles</h2>
       <p>El ciclo <strong>${cycleName}</strong> ha sido cerrado.</p>
       <p>Ingresa a EvaPro para ver tus resultados.</p>`,
    );
  }

  async sendInvitation(email: string, tenantName: string) {
    await this.send(
      email,
      `Invitación a EvaPro — ${tenantName}`,
      `<h2>Has sido invitado a EvaPro</h2>
       <p>Tu organización <strong>${tenantName}</strong> te ha invitado a la plataforma de evaluación de desempeño.</p>
       <p>Ingresa con tu email y contraseña temporal para comenzar.</p>`,
    );
  }
}
