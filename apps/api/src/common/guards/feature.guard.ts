import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';

/** Human-readable feature names for error messages */
const FEATURE_LABELS: Record<string, string> = {
  EVAL_90_180: 'Evaluaciones 90°/180°',
  EVAL_270: 'Evaluaciones 270°',
  EVAL_360: 'Evaluaciones 360°',
  BASIC_REPORTS: 'Reportes básicos',
  ADVANCED_REPORTS: 'Reportes avanzados',
  OKR: 'Objetivos y OKRs',
  FEEDBACK: 'Feedback continuo',
  CHECKINS: 'Check-ins 1:1',
  TEMPLATES_CUSTOM: 'Plantillas personalizadas',
  PDI: 'Planes de Desarrollo Individual (PDI)',
  NINE_BOX: 'Nine Box / Talent Assessment',
  CALIBRATION: 'Calibración',
  POSTULANTS: 'Evaluación de Postulantes',
  AI_INSIGHTS: 'Análisis con Inteligencia Artificial',
  PUBLIC_API: 'API pública',
};

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private subscriptionsService: SubscriptionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No feature required — allow
    if (!requiredFeature) return true;

    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId;
    if (!tenantId) {
      throw new ForbiddenException('No se pudo determinar la organización');
    }

    const subscription = await this.subscriptionsService.findByTenantId(tenantId);
    const featureLabel = FEATURE_LABELS[requiredFeature] || requiredFeature;

    if (!subscription || !subscription.plan) {
      throw new ForbiddenException(
        `Esta funcionalidad requiere una suscripción activa que incluya "${featureLabel}"`,
      );
    }

    const features: string[] = subscription.plan.features || [];
    if (!features.includes(requiredFeature)) {
      throw new ForbiddenException(
        `Su plan "${subscription.plan.name}" no incluye la funcionalidad "${featureLabel}". Actualice a un plan superior.`,
      );
    }

    return true;
  }
}
