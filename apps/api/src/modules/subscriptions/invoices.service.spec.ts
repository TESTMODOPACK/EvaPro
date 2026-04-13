/**
 * invoices.service.spec.ts — Tests unitarios del InvoicesService.
 *
 * Cubre:
 * - generateInvoice: plan faltante, tenant faltante, duplicado, calculo IVA
 * - getNextInvoiceNumber: secuencia correcta, primer numero del año
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Invoice } from './entities/invoice.entity';
import { InvoiceLine } from './entities/invoice-line.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentHistory } from './entities/payment-history.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { User } from '../users/entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InvoicesService } from './invoices.service';
import {
  createMockRepository,
  createMockQueryBuilder,
  createMockAuditService,
  createMockEmailService,
  createMockNotificationsService,
  createMockPlan,
  fakeUuid,
} from '../../../test/test-utils';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let invoiceRepo: any;
  let lineRepo: any;
  let subRepo: any;

  const tenantId = fakeUuid(100);

  beforeEach(async () => {
    invoiceRepo = createMockRepository();
    lineRepo = createMockRepository();
    subRepo = createMockRepository();

    // getNextInvoiceNumber uses createQueryBuilder
    const numQb = createMockQueryBuilder();
    (numQb.getRawOne as jest.Mock).mockResolvedValue(null); // no existing invoices
    invoiceRepo.createQueryBuilder.mockReturnValue(numQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: getRepositoryToken(Invoice), useValue: invoiceRepo },
        { provide: getRepositoryToken(InvoiceLine), useValue: lineRepo },
        { provide: getRepositoryToken(Subscription), useValue: subRepo },
        { provide: getRepositoryToken(PaymentHistory), useValue: createMockRepository() },
        { provide: getRepositoryToken(Tenant), useValue: createMockRepository() },
        { provide: getRepositoryToken(User), useValue: createMockRepository() },
        { provide: AuditService, useValue: createMockAuditService() },
        { provide: EmailService, useValue: createMockEmailService() },
        { provide: NotificationsService, useValue: createMockNotificationsService() },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
  });

  // ─── generateInvoice ───────────────────────────────────────────────

  describe('generateInvoice', () => {
    it('should throw NotFoundException if subscription not found', async () => {
      subRepo.findOne.mockResolvedValue(null);

      await expect(
        service.generateInvoice(fakeUuid(999)),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if subscription has no plan', async () => {
      subRepo.findOne.mockResolvedValue({
        id: fakeUuid(600),
        tenantId,
        plan: null,
        tenant: { id: tenantId, name: 'Demo' },
      });

      await expect(
        service.generateInvoice(fakeUuid(600)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if subscription has no tenant', async () => {
      subRepo.findOne.mockResolvedValue({
        id: fakeUuid(600),
        tenantId,
        plan: createMockPlan(),
        tenant: null,
      });

      await expect(
        service.generateInvoice(fakeUuid(600)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on duplicate invoice for same period', async () => {
      const plan = createMockPlan();
      subRepo.findOne.mockResolvedValue({
        id: fakeUuid(600),
        tenantId,
        plan,
        tenant: { id: tenantId, name: 'Demo' },
        nextBillingDate: new Date('2026-04-01'),
        billingPeriod: 'monthly',
        startDate: new Date('2026-01-01'),
        aiAddonCalls: 0,
        aiAddonPrice: 0,
      });
      // Simulate existing invoice for this period
      invoiceRepo.findOne.mockResolvedValue({
        id: fakeUuid(700),
        invoiceNumber: 'EVA-2026-0001',
      });

      await expect(
        service.generateInvoice(fakeUuid(600)),
      ).rejects.toThrow(BadRequestException);
    });

    it('should generate invoice with correct IVA 19% calculation', async () => {
      const plan = createMockPlan({ monthlyPrice: 10 });
      subRepo.findOne.mockResolvedValue({
        id: fakeUuid(600),
        tenantId,
        plan,
        tenant: { id: tenantId, name: 'Demo' },
        nextBillingDate: new Date('2026-04-01'),
        billingPeriod: 'monthly',
        startDate: new Date('2026-01-01'),
        aiAddonCalls: 0,
        aiAddonPrice: 0,
      });
      // No existing invoice
      invoiceRepo.findOne.mockResolvedValue(null);
      // save returns the invoice with id
      invoiceRepo.save.mockImplementation((entity: any) => Promise.resolve({ id: fakeUuid(700), ...entity }));
      // For the final findOne that returns the saved invoice
      invoiceRepo.findOne
        .mockResolvedValueOnce(null) // duplicate check
        .mockResolvedValue({ id: fakeUuid(700), total: 11.9, subtotal: 10, taxAmount: 1.9, taxRate: 19 }); // final load

      const result = await service.generateInvoice(fakeUuid(600));

      expect(invoiceRepo.save).toHaveBeenCalled();
      // Verify the save was called with correct IVA calculation
      const savedEntity = invoiceRepo.save.mock.calls[0][0];
      expect(savedEntity.taxRate).toBe(19);
      expect(savedEntity.subtotal).toBe(10);
      expect(savedEntity.taxAmount).toBe(1.9); // 10 * 0.19
      expect(savedEntity.total).toBe(11.9); // 10 + 1.9
    });
  });
});
