import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { SavedPaymentMethod, SavedPaymentMethodStatus } from './entities/saved-payment-method.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { StripeProvider } from './providers/stripe-provider';
import { AuditService } from '../audit/audit.service';

/**
 * Fase 3 / Tarea 3.4 — Gestion de medios de pago guardados.
 *
 * Reglas de negocio:
 *   - Solo Stripe en Fase 3 (MP defer Fase 5).
 *   - Cada tenant tiene UN customerId Stripe (creado on-demand).
 *   - Maximo 5 metodos activos por tenant (defense-in-depth contra
 *     abuse).
 *   - Exactamente UN metodo isDefault=true por tenant (enforce service).
 *   - El metodo default se usa en retries automaticos y renovaciones
 *     off-session.
 *   - Borrar un metodo: marca status='revoked' + detach del provider.
 *     NO se purga la fila (retencion contable de transacciones pasadas).
 *   - PCI compliance: NUNCA tocar PAN/CVV. Solo metadata + opaque tokens.
 */
@Injectable()
export class PaymentMethodsService {
  private readonly logger = new Logger(PaymentMethodsService.name);

  /** Limite duro de metodos ACTIVE por tenant. */
  private static readonly MAX_ACTIVE_METHODS = 5;

  constructor(
    @InjectRepository(SavedPaymentMethod)
    private readonly methodRepo: Repository<SavedPaymentMethod>,
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly stripe: StripeProvider,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Inicia el flow para agregar una nueva tarjeta. Retorna el
   * `clientSecret` que la UI usa con Stripe Elements para capturar la
   * tarjeta. El payment_method se persiste localmente solo despues que
   * el webhook `setup_intent.succeeded` lo confirme.
   *
   * Idempotente respecto a tenant: si el tenant ya tiene un customerId,
   * lo reusa; si no, crea uno nuevo.
   */
  /**
   * Retorna URL hosted de Stripe Checkout en mode='setup'. La UI
   * redirige al cliente alli; Stripe captura la card; al volver,
   * el webhook `payment_method.attached` confirma + persiste el metodo.
   */
  async startAddMethod(
    tenantId: string,
    userId: string,
  ): Promise<{ checkoutUrl: string; setupIntentId: string }> {
    if (!this.stripe.isEnabled) {
      throw new BadRequestException(
        'El provider de pagos no esta configurado. Contacte al soporte.',
      );
    }

    // Limite duro: max 5 metodos activos.
    const activeCount = await this.methodRepo.count({
      where: { tenantId, status: 'active' as SavedPaymentMethodStatus },
    });
    if (activeCount >= PaymentMethodsService.MAX_ACTIVE_METHODS) {
      throw new BadRequestException(
        `Limite de ${PaymentMethodsService.MAX_ACTIVE_METHODS} metodos de pago activos alcanzado. ` +
          'Elimine uno antes de agregar otro.',
      );
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado.');

    // Email para el customer Stripe. Preferimos billingEmail si esta;
    // fallback al user que invoca.
    let email = tenant.billingEmail;
    if (!email) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      email = user?.email || `billing+${tenantId}@evapro.cl`;
    }

    const { customerId } = await this.stripe.ensureCustomer!({
      tenantId,
      tenantName: tenant.name,
      email,
      existingCustomerId: tenant.stripeCustomerId,
    });

    // Persistir customerId si es nuevo.
    if (!tenant.stripeCustomerId || tenant.stripeCustomerId !== customerId) {
      await this.tenantRepo.update(tenant.id, { stripeCustomerId: customerId });
    }

    // URLs de retorno: la UI las usa para mostrar success/fallido al
    // cliente. Stripe Checkout las recibe tal cual.
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://evaascenda.netlify.app';
    const { setupIntentId, checkoutUrl } = await this.stripe.createSetupIntent!({
      customerId,
      successUrl: `${appUrl}/dashboard/mi-suscripcion?setup=success`,
      cancelUrl: `${appUrl}/dashboard/mi-suscripcion?setup=cancelled`,
    });

    // Persistir registro DRAFT vinculado al setupIntent. El webhook lo
    // promovera a ACTIVE con metadata real cuando el cliente confirme.
    await this.methodRepo.save(
      this.methodRepo.create({
        tenantId,
        provider: 'stripe',
        providerCustomerId: customerId,
        providerPaymentMethodId: setupIntentId, // placeholder; webhook lo
        // sobreescribe con pm_... final. Permite buscar por
        // setupIntentId en el webhook.
        setupIntentId,
        status: 'draft',
        createdBy: userId,
      }),
    );

    await this.auditService
      .log(tenantId, userId, 'payment_method.setup_started', 'tenant', tenantId, {
        setupIntentId,
        customerId,
      })
      .catch(() => undefined);

    return { checkoutUrl, setupIntentId };
  }

  /**
   * Llamado desde el webhook handler cuando llega `setup_intent.succeeded`
   * (o `payment_method.attached`). Promueve el DRAFT a ACTIVE con
   * metadata real (brand, last4, expiry) y el paymentMethodId opaco.
   *
   * Idempotente: si ya fue procesado, noop.
   */
  async confirmFromWebhook(input: {
    setupIntentId?: string;
    paymentMethodId: string;
    customerId: string;
    cardBrand?: string;
    cardLast4?: string;
    cardExpMonth?: number;
    cardExpYear?: number;
  }): Promise<void> {
    // Buscar el draft por setupIntentId (primer evento) o si ya fue
    // movido, por providerPaymentMethodId (eventos subsiguientes
    // payment_method.attached).
    let draft: SavedPaymentMethod | null = null;
    if (input.setupIntentId) {
      draft = await this.methodRepo.findOne({
        where: { setupIntentId: input.setupIntentId },
      });
    }
    if (!draft) {
      // Fallback: buscar por paymentMethodId.
      draft = await this.methodRepo.findOne({
        where: {
          provider: 'stripe',
          providerPaymentMethodId: input.paymentMethodId,
        },
      });
    }
    if (!draft) {
      // Aceptable: caller envio metodo via API pero el DRAFT no existe
      // (test mode? raza extrema?). Logueamos y salimos sin crear nada.
      this.logger.warn(
        `[PaymentMethods] webhook recibio paymentMethod=${input.paymentMethodId} sin DRAFT correspondiente. Skip.`,
      );
      return;
    }

    // Idempotente: si ya esta active con el mismo pmId, nada que hacer.
    if (
      draft.status === 'active' &&
      draft.providerPaymentMethodId === input.paymentMethodId
    ) {
      return;
    }

    // Si es la PRIMERA card del tenant (no hay otras ACTIVE), marcarla
    // como default automaticamente.
    const otherActive = await this.methodRepo.count({
      where: {
        tenantId: draft.tenantId,
        status: 'active' as SavedPaymentMethodStatus,
      },
    });
    const shouldBeDefault = otherActive === 0;

    draft.providerPaymentMethodId = input.paymentMethodId;
    draft.providerCustomerId = input.customerId;
    draft.status = 'active';
    draft.brand = input.cardBrand ?? draft.brand;
    draft.last4 = input.cardLast4 ?? draft.last4;
    draft.expMonth = input.cardExpMonth ?? draft.expMonth;
    draft.expYear = input.cardExpYear ?? draft.expYear;
    draft.isDefault = shouldBeDefault;

    await this.methodRepo.save(draft);

    await this.auditService
      .log(draft.tenantId, draft.createdBy, 'payment_method.added', 'saved_payment_method', draft.id, {
        provider: 'stripe',
        brand: draft.brand,
        last4: draft.last4,
        isDefault: shouldBeDefault,
      })
      .catch(() => undefined);

    this.logger.log(
      `[PaymentMethods] tenant=${draft.tenantId} added ${draft.brand} ****${draft.last4} (default=${shouldBeDefault})`,
    );
  }

  /**
   * Webhook payment_method.detached: el provider notifica que ya no
   * tenemos acceso a la card (cliente la borro desde Stripe, o el banco
   * la marco como perdida/robada). Marcamos REVOKED y si era default,
   * promovemos a otro metodo si existe.
   */
  async handleDetachedFromWebhook(paymentMethodId: string): Promise<void> {
    const method = await this.methodRepo.findOne({
      where: {
        provider: 'stripe',
        providerPaymentMethodId: paymentMethodId,
      },
    });
    if (!method || method.status === 'revoked') return;

    method.status = 'revoked';
    method.isDefault = false;
    await this.methodRepo.save(method);

    // Si era default, promover el primer ACTIVE restante.
    if (method.isDefault) {
      const next = await this.methodRepo.findOne({
        where: {
          tenantId: method.tenantId,
          status: 'active' as SavedPaymentMethodStatus,
        },
        order: { createdAt: 'ASC' },
      });
      if (next) {
        next.isDefault = true;
        await this.methodRepo.save(next);
      }
    }

    await this.auditService
      .log(method.tenantId, null, 'payment_method.detached_by_provider', 'saved_payment_method', method.id, {
        provider: 'stripe',
        brand: method.brand,
        last4: method.last4,
      })
      .catch(() => undefined);
  }

  /**
   * Lista metodos activos del tenant. Solo expone fields safe para UI;
   * NUNCA expone el `providerPaymentMethodId` opaco (no es PCI sensitive
   * pero no aporta a la UI y abre superficie de ataque si se leakea).
   */
  async listForTenant(tenantId: string): Promise<
    Array<{
      id: string;
      brand: string | null;
      last4: string | null;
      expMonth: number | null;
      expYear: number | null;
      isDefault: boolean;
      provider: string;
      createdAt: Date;
    }>
  > {
    const methods = await this.methodRepo.find({
      where: { tenantId, status: 'active' as SavedPaymentMethodStatus },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
    return methods.map((m) => ({
      id: m.id,
      brand: m.brand,
      last4: m.last4,
      expMonth: m.expMonth,
      expYear: m.expYear,
      isDefault: m.isDefault,
      provider: m.provider,
      createdAt: m.createdAt,
    }));
  }

  /**
   * Marca un metodo como default. Atomico: dentro de la misma
   * transaction, baja el flag del default actual y sube el del nuevo.
   * Si el method no esta ACTIVE, rechaza.
   */
  async setDefault(tenantId: string, methodId: string, userId: string): Promise<void> {
    const target = await this.methodRepo.findOne({
      where: { id: methodId },
    });
    if (!target) throw new NotFoundException('Metodo de pago no encontrado.');
    if (target.tenantId !== tenantId) {
      throw new ForbiddenException('El metodo de pago no pertenece a tu organizacion.');
    }
    if (target.status !== 'active') {
      throw new BadRequestException(
        `Solo metodos activos pueden ser default (estado actual: ${target.status}).`,
      );
    }
    if (target.isDefault) return; // noop idempotente

    await this.dataSource.transaction(async (tx) => {
      // Baja flag del default actual (si existe).
      await tx.update(
        SavedPaymentMethod,
        { tenantId, isDefault: true },
        { isDefault: false },
      );
      // Sube flag al nuevo target.
      await tx.update(
        SavedPaymentMethod,
        { id: methodId },
        { isDefault: true },
      );
    });

    await this.auditService
      .log(tenantId, userId, 'payment_method.set_default', 'saved_payment_method', methodId, {
        brand: target.brand,
        last4: target.last4,
      })
      .catch(() => undefined);
  }

  /**
   * Borra un metodo. Detach del provider + marca status='revoked'
   * localmente. Si era default, promueve al siguiente ACTIVE.
   *
   * NO se purga la fila — la retencion permite auditar que metodo
   * cobro X transaccion pasada incluso despues de borrar.
   */
  async delete(tenantId: string, methodId: string, userId: string): Promise<void> {
    const method = await this.methodRepo.findOne({ where: { id: methodId } });
    if (!method) throw new NotFoundException('Metodo de pago no encontrado.');
    if (method.tenantId !== tenantId) {
      throw new ForbiddenException('El metodo de pago no pertenece a tu organizacion.');
    }
    if (method.status === 'revoked') return; // ya borrado, noop.

    // Detach del provider primero. Si falla, NO marcamos local como
    // revoked — el caller debe reintentar para mantener consistencia.
    if (this.stripe.isEnabled && method.provider === 'stripe') {
      await this.stripe.detachPaymentMethod!(method.providerPaymentMethodId);
    }

    const wasDefault = method.isDefault;
    method.status = 'revoked';
    method.isDefault = false;
    await this.methodRepo.save(method);

    // Promover el siguiente ACTIVE a default.
    if (wasDefault) {
      const next = await this.methodRepo.findOne({
        where: {
          tenantId,
          status: 'active' as SavedPaymentMethodStatus,
        },
        order: { createdAt: 'ASC' },
      });
      if (next) {
        next.isDefault = true;
        await this.methodRepo.save(next);
      }
    }

    await this.auditService
      .log(tenantId, userId, 'payment_method.deleted', 'saved_payment_method', methodId, {
        brand: method.brand,
        last4: method.last4,
        wasDefault,
      })
      .catch(() => undefined);
  }

  /**
   * Fase 3 / Tarea 1.3 (reincorporada) — Cobra usando el metodo default
   * del tenant. Llamado por el cron de auto-renewal y de dunning retry.
   *
   * Devuelve null si el tenant no tiene metodo activo (cliente sin
   * tarjeta guardada — el cron debe degradar a flow manual: email).
   */
  async chargeWithDefault(input: {
    tenantId: string;
    amount: number;
    currency: 'CLP' | 'USD';
    description: string;
    metadata: Record<string, string>;
    idempotencyKey: string;
  }): Promise<
    | {
        chargeId: string;
        status: 'succeeded' | 'requires_action' | 'failed';
        failureReason?: string;
        paymentMethodId: string;
      }
    | null
  > {
    const method = await this.methodRepo.findOne({
      where: {
        tenantId: input.tenantId,
        status: 'active' as SavedPaymentMethodStatus,
        isDefault: true,
      },
    });
    if (!method) return null;
    if (!method.providerCustomerId) {
      this.logger.error(
        `[PaymentMethods] tenant=${input.tenantId} default method ${method.id} sin providerCustomerId — data corruption.`,
      );
      return null;
    }
    if (method.provider !== 'stripe' || !this.stripe.isEnabled) {
      return null;
    }
    const result = await this.stripe.chargeStoredMethod!({
      customerId: method.providerCustomerId,
      paymentMethodId: method.providerPaymentMethodId,
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      metadata: input.metadata,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      ...result,
      paymentMethodId: method.providerPaymentMethodId,
    };
  }
}
