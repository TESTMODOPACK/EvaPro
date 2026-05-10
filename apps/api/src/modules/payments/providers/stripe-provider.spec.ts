/**
 * stripe-provider.spec.ts — Tests del adapter Stripe.
 *
 * Cubre:
 * - Fase 0 / Tarea 0.3: bug de metadata key en
 *   `payment_intent.payment_failed`. Antes leiamos
 *   `pi.metadata.stripe_checkout_session_id` (clave inexistente) ->
 *   sessionId siempre '' -> isIgnorable=true -> los rechazos asincronos
 *   nunca se procesaban. Fix: leer `pi.metadata.payment_session_id`,
 *   que es la key con la que payments.service envia metadata
 *   (payments.service.ts:147).
 */
import { StripeProvider } from './stripe-provider';

describe('StripeProvider — verifyWebhook (Fase 0 / Tarea 0.3)', () => {
  let provider: StripeProvider;

  beforeAll(() => {
    // Setear env vars antes de instanciar para que el constructor inicialice
    // el client Stripe (en isEnabled=true mode).
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_for_tests';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy';
  });

  beforeEach(() => {
    provider = new StripeProvider();
  });

  afterEach(() => {
    // Stripe SDK retiene conexion HTTP keep-alive interna; sin esto Jest
    // reporta "worker process failed to exit gracefully".
    const client = (provider as any)?.client;
    if (client?.httpAgent?.destroy) {
      client.httpAgent.destroy();
    }
  });

  function mockConstructEvent(eventOverride: any) {
    // Override del SDK Stripe para devolver el evento mockeado en vez de
    // ejecutar verificacion HMAC real.
    (provider as any).client.webhooks.constructEvent = jest
      .fn()
      .mockReturnValue(eventOverride);
  }

  it('payment_intent.payment_failed: maps payment_session_id metadata correctly (NOT stripe_checkout_session_id)', async () => {
    // Caso bug pre-fix: el evento llega con metadata.payment_session_id (la
    // key que payments.service envia). Pre-fix lo ignoraba; post-fix lo
    // toma como externalId valido para que el handler aplique la falla.
    mockConstructEvent({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          metadata: {
            payment_session_id: 'cs_test_123abc',
            invoice_id: 'inv-uuid',
          },
          last_payment_error: { message: 'Your card was declined.' },
        },
      },
    });

    const result = await provider.verifyWebhook(
      Buffer.from('{}'),
      'sig-irrelevant',
    );

    expect(result).not.toBeNull();
    expect(result!.type).toBe('payment.failed');
    expect(result!.externalId).toBe('cs_test_123abc');
    expect(result!.isIgnorable).toBe(false);
    expect(result!.failureReason).toContain('declined');
  });

  it('payment_intent.payment_failed: ignorable if metadata is missing payment_session_id', async () => {
    // Edge case: si por algun motivo el evento llega sin la key esperada
    // (e.g. PaymentIntent creado fuera de nuestro flujo), debe quedar
    // marcado isIgnorable para que el controller responda 200 sin efecto.
    mockConstructEvent({
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          metadata: {},
          last_payment_error: { message: 'card_declined' },
        },
      },
    });

    const result = await provider.verifyWebhook(
      Buffer.from('{}'),
      'sig-irrelevant',
    );

    expect(result).not.toBeNull();
    expect(result!.externalId).toBe('');
    expect(result!.isIgnorable).toBe(true);
  });

  it('returns null on signature verification failure', async () => {
    // Si constructEvent throws (HMAC invalida), devolvemos null y el
    // controller responde 400 al supuesto atacante.
    (provider as any).client.webhooks.constructEvent = jest
      .fn()
      .mockImplementation(() => {
        throw new Error('Invalid signature');
      });

    const result = await provider.verifyWebhook(
      Buffer.from('{}'),
      'sig-bad',
    );
    expect(result).toBeNull();
  });
});
