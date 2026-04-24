/**
 * test-utils.ts — Factories de mocks reutilizables para tests unitarios.
 *
 * Cada servicio de EvaPro depende de repos TypeORM + servicios auxiliares
 * (Audit, Notifications, Email, Cache). En vez de mockear todo a mano en
 * cada spec, estos factories generan mocks con la interfaz correcta y
 * valores por defecto razonables.
 *
 * Uso:
 *   const mockRepo = createMockRepository<User>();
 *   const mockAudit = createMockAuditService();
 *   const module = await Test.createTestingModule({
 *     providers: [
 *       MyService,
 *       { provide: getRepositoryToken(User), useValue: mockRepo },
 *       { provide: AuditService, useValue: mockAudit },
 *     ],
 *   }).compile();
 */

import { Repository, SelectQueryBuilder, DataSource, ObjectLiteral } from 'typeorm';

// ─── Mock Repository ─────────────────────────────────────────────────

type MockRepository<T extends ObjectLiteral> = Partial<Record<keyof Repository<T>, jest.Mock>>;

/**
 * Crea un mock de Repository<T> con todos los metodos comunes como
 * jest.fn(). Los metodos devuelven undefined por default; en cada test
 * se puede hacer `mockRepo.findOne.mockResolvedValue(entity)` para
 * personalizar.
 */
export function createMockRepository<T extends ObjectLiteral = any>(): MockRepository<T> & {
  createQueryBuilder: jest.Mock;
} {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'mock-uuid', ...entity })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    remove: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue(createMockQueryBuilder()),
    manager: {
      save: jest.fn().mockImplementation((_, entity) => Promise.resolve(entity)),
      getRepository: jest.fn().mockReturnValue({
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((dto: any) => dto),
        save: jest.fn().mockImplementation((entity: any) => Promise.resolve(entity)),
        count: jest.fn().mockResolvedValue(0),
        createQueryBuilder: jest.fn().mockReturnValue(createMockQueryBuilder()),
      }),
    } as any,
  };
}

// ─── Mock QueryBuilder ───────────────────────────────────────────────

/**
 * Mock de SelectQueryBuilder con metodos encadenables (fluent API).
 * Cada metodo retorna `this` para permitir chaining.
 */
export function createMockQueryBuilder<T extends ObjectLiteral = any>(): Partial<SelectQueryBuilder<T>> & Record<string, jest.Mock> {
  const qb: any = {};
  const chainMethods = [
    'select', 'addSelect', 'where', 'andWhere', 'orWhere',
    'innerJoin', 'leftJoin', 'innerJoinAndSelect', 'leftJoinAndSelect',
    'orderBy', 'addOrderBy', 'groupBy', 'addGroupBy',
    'skip', 'take', 'offset', 'limit',
    'having', 'setParameter', 'setParameters',
  ];
  for (const method of chainMethods) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  // Terminal methods
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn().mockResolvedValue(null);
  qb.getCount = jest.fn().mockResolvedValue(0);
  qb.execute = jest.fn().mockResolvedValue({ affected: 0 });
  // Alias
  qb.alias = 'entity';
  return qb;
}

// ─── Mock DataSource ─────────────────────────────────────────────────

export function createMockDataSource(): Partial<DataSource> {
  return {
    query: jest.fn().mockResolvedValue([]),
    createQueryRunner: jest.fn().mockReturnValue({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        save: jest.fn().mockImplementation((_: any, entity: any) => Promise.resolve(entity)),
        getRepository: jest.fn().mockReturnValue(createMockRepository()),
      },
    }),
    transaction: jest.fn().mockImplementation(async (cb: any) => {
      const mockManager = {
        save: jest.fn().mockImplementation((_: any, entity: any) => Promise.resolve(entity)),
        getRepository: jest.fn().mockReturnValue(createMockRepository()),
      };
      return cb(mockManager);
    }),
  };
}

// ─── Mock Services ───────────────────────────────────────────────────

export function createMockAuditService() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockNotificationsService() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'notif-mock' }),
    createBulk: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockEmailService() {
  return {
    send: jest.fn().mockResolvedValue(undefined),
    sendWithAttachments: jest.fn().mockResolvedValue(undefined),
    sendCycleLaunched: jest.fn().mockResolvedValue(undefined),
    sendCycleClosed: jest.fn().mockResolvedValue(undefined),
    sendEvaluationReminder: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
  };
}

export function createMockCacheManager() {
  const store = new Map<string, any>();
  return {
    get: jest.fn().mockImplementation((key: string) => Promise.resolve(store.get(key))),
    set: jest.fn().mockImplementation((key: string, value: any) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: jest.fn().mockImplementation((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    reset: jest.fn().mockImplementation(() => {
      store.clear();
      return Promise.resolve();
    }),
    // Expose internal store for assertions
    _store: store,
  };
}

export function createMockSubscriptionsService() {
  return {
    checkFeature: jest.fn().mockResolvedValue(true),
    getActiveSubscription: jest.fn().mockResolvedValue({ id: 'sub-mock', planId: 'plan-mock', status: 'active' }),
    findPlanById: jest.fn().mockResolvedValue({ id: 'plan-mock', name: 'Pro', features: ['*'] }),
  };
}

export function createMockPasswordPolicyService() {
  return {
    resolvePolicy: jest.fn().mockResolvedValue({
      minLength: 8,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: false,
      expiryDays: null,
      historyCount: 0,
      lockoutThreshold: 5,
      lockoutDurationMinutes: 15,
    }),
    validate: jest.fn().mockReturnValue(null),
    matchesHistory: jest.fn().mockResolvedValue(false),
    recordChange: jest.fn().mockResolvedValue(undefined),
    isExpired: jest.fn().mockReturnValue(false),
    recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
    clearFailedAttempts: jest.fn().mockResolvedValue(undefined),
    minutesUntilUnlocked: jest.fn().mockReturnValue(null),
    bcryptRounds: 12,
  };
}

// ─── Entity Factories ────────────────────────────────────────────────

/** Genera un UUID v4 fake determinístico basado en un seed. */
export function fakeUuid(seed = 0): string {
  const hex = seed.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}

/** Factory de User entity mock. Override any field. */
export function createMockUser(overrides: Record<string, any> = {}) {
  return {
    id: fakeUuid(1),
    tenantId: fakeUuid(100),
    email: 'test@evapro.demo',
    firstName: 'Test',
    lastName: 'User',
    role: 'employee',
    isActive: true,
    department: 'Tecnología',
    position: 'Analista',
    hierarchyLevel: 5,
    managerId: null,
    passwordHash: '$2b$12$mock',
    ...overrides,
  };
}

/** Factory de Tenant entity mock. */
export function createMockTenant(overrides: Record<string, any> = {}) {
  return {
    id: fakeUuid(100),
    name: 'Demo Company',
    slug: 'demo',
    isActive: true,
    settings: {},
    ...overrides,
  };
}

/** Factory de EvaluationCycle mock. */
export function createMockCycle(overrides: Record<string, any> = {}) {
  return {
    id: fakeUuid(200),
    tenantId: fakeUuid(100),
    name: 'Test Cycle 2026',
    type: '360',
    status: 'draft',
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-06-30'),
    templateId: fakeUuid(300),
    totalEvaluated: 0,
    settings: {},
    ...overrides,
  };
}

/** Factory de SubscriptionPlan mock. */
export function createMockPlan(overrides: Record<string, any> = {}) {
  return {
    id: fakeUuid(400),
    name: 'Pro',
    code: 'pro',
    maxEmployees: 200,
    monthlyPrice: 3.5,
    currency: 'UF',
    features: ['EVALUATIONS', 'OBJECTIVES', 'DEVELOPMENT', 'RECOGNITION', 'SURVEYS', 'TALENT', 'AI_INSIGHTS'],
    maxAiCallsPerMonth: 200,
    isActive: true,
    ...overrides,
  };
}
