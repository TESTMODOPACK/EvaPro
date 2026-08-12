/**
 * billing-metrics.service.spec.ts — Fase C (auditoría facturación).
 *
 * El MRR debe reflejar el precio EFECTIVO de cada sub (con su price
 * override activo), no el precio de lista del plan.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillingMetricsService } from './billing-metrics.service';
import { PriceOverridesService } from './price-overrides.service';
import { Subscription } from './entities/subscription.entity';
import { Invoice } from './entities/invoice.entity';
import { createMockRepository, fakeUuid } from '../../../test/test-utils';

describe('BillingMetricsService — getMRR (Fase C)', () => {
  let service: BillingMetricsService;
  let subRepo: any;
  let overrides: any;

  beforeEach(async () => {
    subRepo = createMockRepository();
    overrides = { getActiveOverride: jest.fn().mockResolvedValue(null) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingMetricsService,
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        { provide: getRepositoryToken(Invoice), useValue: createMockRepository() },
        { provide: PriceOverridesService, useValue: overrides },
      ],
    }).compile();

    service = module.get(BillingMetricsService);
  });

  const monthlySub = (id: string, monthlyPrice: number) => ({
    id,
    status: 'active',
    billingPeriod: 'monthly',
    plan: { monthlyPrice, currency: 'UF' },
  });

  it('sin override usa el precio de lista', async () => {
    subRepo.find.mockResolvedValue([monthlySub(fakeUuid(1), 3.5)]);

    const { mrr } = await service.getMRR();

    expect(mrr).toBe(3.5);
  });

  it('con override activo usa el precio negociado, no el de lista', async () => {
    subRepo.find.mockResolvedValue([
      monthlySub(fakeUuid(1), 3.5),
      monthlySub(fakeUuid(2), 3.5),
    ]);
    // Solo la primera sub tiene descuento (2.0 en vez de 3.5).
    overrides.getActiveOverride.mockImplementation(async (subId: string) =>
      subId === fakeUuid(1) ? { monthlyPrice: 2.0 } : null,
    );

    const { mrr } = await service.getMRR();

    expect(mrr).toBe(5.5); // 2.0 + 3.5 — antes reportaba 7.0
  });

  it('un fallo del lookup de override no rompe la métrica (cae a lista)', async () => {
    subRepo.find.mockResolvedValue([monthlySub(fakeUuid(1), 3.5)]);
    overrides.getActiveOverride.mockRejectedValue(new Error('db hiccup'));

    const { mrr } = await service.getMRR();

    expect(mrr).toBe(3.5);
  });
});
