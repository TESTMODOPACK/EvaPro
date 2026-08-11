/**
 * development.service.bulk-all.spec.ts
 *
 * Cubre `bulkAssignAllPositions`: el botón "Completar los N cargos" de
 * Mantenedores → Competencias por Cargo.
 *
 * Lo importante que se verifica acá:
 *  - La fuente de cargos es el catálogo JSONB del tenant (lo que ve el
 *    usuario), no la tabla `positions`, que puede estar desalineada.
 *  - Es idempotente: no vuelve a crear lo que ya existe.
 *  - No genera filas duplicadas dentro del mismo INSERT (violarían
 *    uq_role_comp y abortarían la transacción de la request).
 */
import { BadRequestException } from '@nestjs/common';
import { DevelopmentService } from './development.service';
import { CompetencyStatus } from './entities/competency.entity';
import { fakeUuid } from '../../../test/test-utils';

const TID = fakeUuid(100);
const COMP_A = fakeUuid(1);
const COMP_B = fakeUuid(2);
const POS_ROW_1 = fakeUuid(11);
const POS_ROW_2 = fakeUuid(12);

type Ctx = {
  service: DevelopmentService;
  inserted: any[][];
  competencyRepo: any;
  roleCompetencyRepo: any;
  positionRepo: any;
  tenantRepo: any;
};

function build(opts: {
  positionRows?: any[];
  tenantSettings?: any;
  competencies?: any[];
  existing?: any[];
  /** Cuántas filas "sobreviven" al ON CONFLICT por lote. Default: todas. */
  insertedPerChunk?: (values: any[]) => number;
}): Ctx {
  const inserted: any[][] = [];

  const competencyRepo: any = {
    find: jest.fn().mockResolvedValue(opts.competencies ?? []),
  };

  const roleCompetencyRepo: any = {
    find: jest.fn().mockResolvedValue(opts.existing ?? []),
    createQueryBuilder: jest.fn().mockImplementation(() => {
      let captured: any[] = [];
      const qb: any = {
        insert: () => qb,
        into: () => qb,
        values: (v: any[]) => {
          captured = v;
          inserted.push(v);
          return qb;
        },
        orIgnore: () => qb,
        returning: () => qb,
        execute: async () => {
          const n = opts.insertedPerChunk ? opts.insertedPerChunk(captured) : captured.length;
          return { raw: Array.from({ length: n }, (_, i) => ({ id: `ins-${i}` })) };
        },
      };
      return qb;
    }),
  };

  const tenantRepo: any = {
    findOne: jest.fn().mockResolvedValue(
      opts.tenantSettings === undefined ? { id: TID, settings: {} } : { id: TID, settings: opts.tenantSettings },
    ),
  };

  const positionRepo: any = {
    find: jest.fn().mockResolvedValue(opts.positionRows ?? []),
    manager: { getRepository: jest.fn().mockReturnValue(tenantRepo) },
  };

  const noop: any = {};
  const service = new DevelopmentService(
    competencyRepo,
    roleCompetencyRepo,
    noop, // planRepo
    noop, // actionRepo
    noop, // commentRepo
    noop, // userRepo
    noop, // assessmentRepo
    positionRepo,
    noop, // auditService
    noop, // emailService
    noop, // notificationsService
    noop, // recognitionService
    noop, // cacheManager
  );

  return { service, inserted, competencyRepo, roleCompetencyRepo, positionRepo, tenantRepo };
}

const comps = [
  { id: COMP_A, name: 'Comunicación', isActive: true, status: CompetencyStatus.APPROVED },
  { id: COMP_B, name: 'Liderazgo', isActive: true, status: CompetencyStatus.APPROVED },
];

describe('DevelopmentService.bulkAssignAllPositions', () => {
  it('usa el catálogo JSONB del tenant como fuente y resuelve la FK desde la tabla', async () => {
    const { service, inserted } = build({
      positionRows: [{ id: POS_ROW_1, name: 'Gerente General', level: 1 }],
      tenantSettings: {
        positions: [
          { name: 'Gerente General', level: 1 },
          { name: 'Analista', level: 5 },
        ],
      },
      competencies: comps,
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.positionsProcessed).toBe(2);
    expect(res.created).toBe(4); // 2 cargos × 2 competencias
    const rows = inserted.flat();
    // El cargo que existe en la tabla queda con FK; el que no, con null.
    expect(rows.filter((r) => r.position === 'Gerente General').every((r) => r.positionId === POS_ROW_1)).toBe(true);
    expect(rows.filter((r) => r.position === 'Analista').every((r) => r.positionId === null)).toBe(true);
  });

  it('cae a la tabla `positions` cuando el tenant no tiene catálogo JSONB', async () => {
    const { service, inserted } = build({
      positionRows: [{ id: POS_ROW_1, name: 'Jefe de Área', level: 3 }],
      tenantSettings: {},
      competencies: comps,
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.positionsProcessed).toBe(1);
    expect(inserted.flat().map((r) => r.position)).toEqual(['Jefe de Área', 'Jefe de Área']);
  });

  it('es idempotente: no vuelve a crear las asignaciones que ya existen', async () => {
    const { service, inserted } = build({
      positionRows: [],
      tenantSettings: { positions: [{ name: 'Analista', level: 5 }] },
      competencies: comps,
      existing: [{ position: 'Analista', competencyId: COMP_A }],
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.created).toBe(1);
    expect(inserted.flat()).toHaveLength(1);
    expect(inserted.flat()[0].competencyId).toBe(COMP_B);
  });

  it('completa cargos con perfil parcial (lo que el botón por cargo no hacía)', async () => {
    const { service } = build({
      positionRows: [],
      tenantSettings: {
        positions: [
          { name: 'Analista', level: 5 },
          { name: 'Gerente', level: 1 },
        ],
      },
      competencies: comps,
      existing: [
        { position: 'Analista', competencyId: COMP_A },
        { position: 'Gerente', competencyId: COMP_A },
        { position: 'Gerente', competencyId: COMP_B },
      ],
    });

    const res = await service.bulkAssignAllPositions(TID);

    // Solo falta Analista×COMP_B. Gerente ya estaba completo.
    expect(res.created).toBe(1);
    expect(res.positionsProcessed).toBe(2);
  });

  it('no emite filas duplicadas cuando el catálogo repite un cargo (distinto casing)', async () => {
    const { service, inserted } = build({
      positionRows: [{ id: POS_ROW_1, name: 'Analista', level: 5 }],
      tenantSettings: {
        positions: [
          { name: 'Analista', level: 5 },
          { name: 'ANALISTA', level: 5 },
          { name: '  analista  ', level: 5 },
        ],
      },
      competencies: comps,
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.positionsProcessed).toBe(1);
    const rows = inserted.flat();
    expect(rows).toHaveLength(2);
    // Todas bajo el nombre canónico de la tabla.
    expect(rows.every((r) => r.position === 'Analista')).toBe(true);
    const keys = rows.map((r) => `${r.position}::${r.competencyId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('omite cargos con nombre > 100 chars en vez de reventar el INSERT', async () => {
    const largo = 'X'.repeat(101);
    const { service, inserted } = build({
      positionRows: [],
      tenantSettings: { positions: [{ name: largo, level: 2 }, { name: 'Analista', level: 5 }] },
      competencies: comps,
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.skipped).toEqual([largo]);
    expect(res.positionsProcessed).toBe(1);
    expect(inserted.flat().every((r) => r.position === 'Analista')).toBe(true);
  });

  it('deriva el nivel esperado de la jerarquía del cargo', async () => {
    const { service, inserted } = build({
      positionRows: [],
      tenantSettings: {
        positions: [
          { name: 'CEO', level: 1 },
          { name: 'Analista', level: 5 },
          { name: 'Operario', level: 99 },
        ],
      },
      competencies: [comps[0]],
    });

    await service.bulkAssignAllPositions(TID);

    const byPos = Object.fromEntries(inserted.flat().map((r) => [r.position, r.expectedLevel]));
    expect(byPos).toEqual({ CEO: 9, Analista: 5, Operario: 2 });
  });

  it('respeta un defaultLevel explícito para todos los cargos', async () => {
    const { service, inserted } = build({
      positionRows: [],
      tenantSettings: { positions: [{ name: 'CEO', level: 1 }, { name: 'Analista', level: 5 }] },
      competencies: [comps[0]],
    });

    await service.bulkAssignAllPositions(TID, 7);

    expect(inserted.flat().every((r) => r.expectedLevel === 7)).toBe(true);
  });

  it('rechaza defaultLevel fuera de rango o no entero', async () => {
    const { service } = build({ tenantSettings: { positions: [{ name: 'CEO', level: 1 }] }, competencies: comps });

    await expect(service.bulkAssignAllPositions(TID, 0)).rejects.toThrow(BadRequestException);
    await expect(service.bulkAssignAllPositions(TID, 11)).rejects.toThrow(BadRequestException);
    // 5.5 pasaría el rango pero rompería la columna int en Postgres.
    await expect(service.bulkAssignAllPositions(TID, 5.5)).rejects.toThrow(BadRequestException);
  });

  it('no inserta nada si no hay competencias aprobadas y lo informa', async () => {
    const { service, inserted } = build({
      tenantSettings: { positions: [{ name: 'CEO', level: 1 }] },
      competencies: [],
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.competencies).toBe(0);
    expect(res.created).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it('solo consulta competencias activas y aprobadas', async () => {
    const { service, competencyRepo } = build({
      tenantSettings: { positions: [{ name: 'CEO', level: 1 }] },
      competencies: comps,
    });

    await service.bulkAssignAllPositions(TID);

    expect(competencyRepo.find).toHaveBeenCalledWith({
      where: { tenantId: TID, isActive: true, status: CompetencyStatus.APPROVED },
    });
  });

  it('cuenta como creadas solo las filas que sobrevivieron al ON CONFLICT', async () => {
    const { service } = build({
      positionRows: [],
      tenantSettings: { positions: [{ name: 'Analista', level: 5 }] },
      competencies: comps,
      // Simula que otro admin insertó una de las dos en paralelo.
      insertedPerChunk: () => 1,
    });

    const res = await service.bulkAssignAllPositions(TID);

    expect(res.created).toBe(1);
  });

  it('acota todas las lecturas al tenant', async () => {
    const { service, positionRepo, roleCompetencyRepo, tenantRepo } = build({
      tenantSettings: { positions: [{ name: 'CEO', level: 1 }] },
      competencies: comps,
    });

    await service.bulkAssignAllPositions(TID);

    expect(positionRepo.find).toHaveBeenCalledWith({ where: { tenantId: TID, isActive: true } });
    expect(roleCompetencyRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TID } }),
    );
    expect(tenantRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TID } }),
    );
  });
});
