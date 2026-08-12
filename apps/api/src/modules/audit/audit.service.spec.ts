/**
 * audit.service.spec.ts — Saneo de columnas uuid en el audit log.
 *
 * Incidente 2026-08 (suscripciones vencidas-pero-activas): tres flujos de
 * auditoría estuvieron muertos desde su creación porque los callers pasaban
 * strings no-uuid a columnas uuid y el `.catch(() => {})` de cada caller se
 * tragaba el rechazo de Postgres:
 *
 *   - userId  = 'system'            → todo el billing automático sin rastro
 *   - entityId = 'processAutoRenewals' / 'GET /ruta' → cron.failed y
 *     access.denied jamás escritos
 *   - tenantId = 'system'           → invoice.reminders_sent jamás escrito
 *
 * El saneo vive en AuditService.log (único punto por el que pasa todo,
 * incluido logFailure): el valor no-uuid se preserva en metadata y la columna
 * queda NULL, que sí es válido.
 */
import { AuditService } from './audit.service';
import { fakeUuid } from '../../../test/test-utils';

const TID = fakeUuid(1);
const UID = fakeUuid(2);
const EID = fakeUuid(3);

describe('AuditService.log — saneo de columnas uuid', () => {
  let service: AuditService;
  let saved: any[];

  beforeEach(() => {
    saved = [];
    const auditRepo: any = {
      create: jest.fn((d: any) => d),
      save: jest.fn(async (e: any) => {
        saved.push(e);
        return e;
      }),
    };
    service = new AuditService(auditRepo, {} as any);
  });

  it('deja pasar uuids válidos sin tocarlos', async () => {
    await service.log(TID, UID, 'x.accion', 'invoice', EID, { a: 1 });
    expect(saved[0]).toMatchObject({
      tenantId: TID,
      userId: UID,
      entityId: EID,
      metadata: { a: 1 },
    });
  });

  it("mueve userId 'system' a metadata.actor y deja user_id NULL", async () => {
    await service.log(TID, 'system', 'subscription.auto_renewals_run');
    expect(saved[0].userId).toBeUndefined();
    expect(saved[0].metadata).toMatchObject({ actor: 'system' });
  });

  it('mueve entityId no-uuid (nombre de cron) a metadata.entityRef', async () => {
    await service.log(TID, UID, 'cron.failed', 'Cron', 'processAutoRenewals');
    expect(saved[0].entityId).toBeUndefined();
    expect(saved[0].metadata).toMatchObject({ entityRef: 'processAutoRenewals' });
  });

  it('mueve entityId tipo ruta (access.denied) a metadata.entityRef', async () => {
    await service.log(TID, UID, 'access.denied', 'Route', 'GET /subscriptions');
    expect(saved[0].entityId).toBeUndefined();
    expect(saved[0].metadata).toMatchObject({ entityRef: 'GET /subscriptions' });
  });

  it("mueve tenantId 'system' a metadata.tenantRef y deja tenant_id NULL", async () => {
    await service.log('system', UID, 'invoice.reminders_sent');
    expect(saved[0].tenantId).toBeUndefined();
    expect(saved[0].metadata).toMatchObject({ tenantRef: 'system' });
  });

  it('sanea las tres columnas a la vez preservando la metadata original', async () => {
    await service.log('system', 'system', 'x', 'Cron', 'unJob', { count: 5 });
    expect(saved[0].tenantId).toBeUndefined();
    expect(saved[0].userId).toBeUndefined();
    expect(saved[0].entityId).toBeUndefined();
    expect(saved[0].metadata).toMatchObject({
      count: 5,
      actor: 'system',
      entityRef: 'unJob',
      tenantRef: 'system',
    });
  });

  it('null/undefined siguen siendo NULL sin inventar metadata', async () => {
    await service.log(null, null, 'x');
    expect(saved[0].tenantId).toBeUndefined();
    expect(saved[0].userId).toBeUndefined();
    expect(saved[0].metadata).toBeUndefined();
  });

  it('logFailure hereda el saneo (cron.failed con nombre de job llega a la BD)', async () => {
    await service.logFailure('cron.failed', {
      entityType: 'Cron',
      entityId: 'processAutoRenewals',
      error: new Error('boom'),
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].entityId).toBeUndefined();
    expect(saved[0].metadata).toMatchObject({
      entityRef: 'processAutoRenewals',
      errorMessage: 'boom',
    });
  });

  it('es case-insensitive con uuids en mayúsculas', async () => {
    await service.log(TID.toUpperCase(), UID.toUpperCase(), 'x');
    expect(saved[0].tenantId).toBe(TID.toUpperCase());
    expect(saved[0].userId).toBe(UID.toUpperCase());
  });
});
