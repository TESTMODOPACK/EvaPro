import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import { SubscriptionsService } from '../../modules/subscriptions/subscriptions.service';

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
    if (!subscription || !subscription.plan) {
      throw new ForbiddenException(
        `Esta funcionalidad requiere una suscripción activa con la característica "${requiredFeature}"`,
      );
    }

    const features: string[] = subscription.plan.features || [];
    if (!features.includes(requiredFeature)) {
      throw new ForbiddenException(
        `Su plan "${subscription.plan.name}" no incluye la funcionalidad "${requiredFeature}". Actualice a un plan superior.`,
      );
    }

    return true;
  }
}
