/**
 * mirror-sub-template.spec.ts — Tests de la orquestación de
 * `TemplatesService.mirrorSubTemplate`.
 *
 * Foco: las garantías de negocio que protegen datos del admin.
 *   1. NUNCA se sobrescribe una perspectiva que ya tiene preguntas.
 *   2. Si la IA falla o no hay cuota, se cae a reglas SIN romper.
 *   3. Las subplantillas creadas nacen con weight 0 (el admin rebalancea).
 *
 * La clase se instancia con mocks mínimos (sin TestingModule de Nest) —
 * mismo patrón que los specs de interceptors/guards del proyecto.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { RelationType } from '../evaluations/entities/evaluation-assignment.entity';

const { MANAGER, SELF, PEER } = RelationType;

/** Sección de ejemplo con N preguntas en tercera persona (jefatura). */
const managerSections = [
  {
    id: 'sec-1',
    title: 'Liderazgo',
    questions: [
      { id: 'q1', text: 'Demuestra liderazgo de forma consistente', type: 'scale', required: true },
      { id: 'q2', text: 'Mantiene sus compromisos con su equipo', type: 'scale', required: true },
    ],
  },
];

describe('TemplatesService.mirrorSubTemplate', () => {
  let service: TemplatesService;
  let subTemplateRepo: any;
  let aiInsightsService: any;
  /** Subs persistidas durante la transacción mock. */
  let saved: any[];

  const makeSub = (relationType: string, sections: any[] = [], id = `sub-${relationType}`) => ({
    id,
    parentTemplateId: 'tpl-1',
    relationType,
    sections,
    weight: 0,
    displayOrder: 1,
    isActive: true,
  });

  beforeEach(() => {
    saved = [];

    subTemplateRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    aiInsightsService = {
      // Por defecto: sin cuota IA → fuerza el camino de reglas.
      assertAiQuota: jest.fn().mockRejectedValue(new BadRequestException('Sin cuota IA')),
      trackAddonUsage: jest.fn().mockResolvedValue(undefined),
    };

    const txRepo = {
      save: jest.fn(async (entity: any) => {
        saved.push(entity);
        return entity;
      }),
      create: jest.fn((data: any) => ({ ...data })),
      // El service re-lee la sub destino DENTRO de la tx (protección contra
      // carrera). El mock resuelve contra el mismo set que `find`.
      findOne: jest.fn(async ({ where }: any) => {
        const all = await subTemplateRepo.find();
        return (all || []).find((s: any) => s.relationType === where.relationType) ?? null;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (cb: any) => cb({ getRepository: () => txRepo })),
    };

    service = new TemplatesService(
      {} as any,               // templateRepo (findById se mockea con spyOn)
      subTemplateRepo as any,  // subTemplateRepo
      {} as any,               // competencyRepo
      {} as any,               // cycleRepo
      { save: jest.fn(), create: jest.fn((d: any) => d) } as any, // aiCallLogRepo
      {} as any,               // aiInsightRepo
      aiInsightsService as any,
      dataSource as any,
    );

    // findById valida ownership del tenant — lo damos por válido.
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue({ id: 'tpl-1', tenantId: 'tenant-1' } as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('replica a una perspectiva vacía y adapta la redacción (fallback reglas)', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    expect(result.mode).toBe('rules');
    expect(result.created).toEqual([{ relationType: SELF, questionCount: 2 }]);
    expect(result.skipped).toHaveLength(0);

    // La sub creada trae los textos transformados a primera persona.
    const createdSub = saved.find((s) => s.relationType === SELF);
    expect(createdSub).toBeDefined();
    const texts = createdSub.sections[0].questions.map((q: any) => q.text);
    expect(texts).toEqual([
      'Demuestro liderazgo de forma consistente',
      'Mantengo mis compromisos con mi equipo',
    ]);
  });

  it('NUNCA sobrescribe una perspectiva que ya tiene preguntas', async () => {
    const selfWithContent = makeSub(SELF, [
      { id: 's', title: 'Ya existe', questions: [{ id: 'x', text: 'Pregunta previa' }] },
    ]);
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([
      makeSub(MANAGER, managerSections),
      selfWithContent,
    ]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual([
      { relationType: SELF, reason: 'Ya tiene 1 pregunta(s)' },
    ]);
    // Nada se persistió — el contenido previo quedó intacto.
    expect(saved).toHaveLength(0);
  });

  it('rellena una perspectiva que existe pero está vacía', async () => {
    const emptySelf = makeSub(SELF, []);
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections), emptySelf]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    expect(result.created).toEqual([{ relationType: SELF, questionCount: 2 }]);
    // Se guardó la MISMA entidad (update), no una nueva.
    expect(saved[0].id).toBe(emptySelf.id);
    expect(saved[0].sections[0].questions).toHaveLength(2);
  });

  it('las subplantillas nuevas nacen con weight 0 para rebalanceo manual', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF, PEER],
    } as any);

    for (const sub of saved) {
      expect(sub.weight).toBe(0);
      expect(sub.isActive).toBe(true);
    }
  });

  it('genera ids únicos por perspectiva (sin choques entre subplantillas)', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF, PEER],
    } as any);

    const selfIds = saved
      .find((s) => s.relationType === SELF)
      .sections[0].questions.map((q: any) => q.id);
    const peerIds = saved
      .find((s) => s.relationType === PEER)
      .sections[0].questions.map((q: any) => q.id);

    expect(selfIds).toEqual(['q1__self', 'q2__self']);
    expect(peerIds).toEqual(['q1__peer', 'q2__peer']);
    // Sin intersección entre perspectivas.
    expect(selfIds.filter((id: string) => peerIds.includes(id))).toHaveLength(0);
  });

  it('remapea la lógica condicional a los ids nuevos (pregunta y sección)', async () => {
    // Sección condicionada a q1, y q2 condicionada a q1. Al replicar, los
    // ids pasan a q1__self / q2__self → las condiciones deben apuntar allí.
    // Si no se remapean, la condición referencia un id inexistente y la
    // pregunta nunca se muestra (fallo silencioso).
    const withConditions = [
      {
        id: 'sec-1',
        title: 'Liderazgo',
        condition: { questionId: 'q1', operator: 'greater_than', value: '3' },
        questions: [
          { id: 'q1', text: 'Demuestra liderazgo', type: 'scale', required: true },
          {
            id: 'q2',
            text: 'Mantiene sus compromisos',
            type: 'scale',
            required: true,
            condition: { questionId: 'q1', operator: 'equals', value: '5' },
          },
        ],
      },
    ];
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, withConditions));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, withConditions)]);

    await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    const created = saved.find((s) => s.relationType === SELF);
    // Condición de la sección remapeada
    expect(created.sections[0].condition.questionId).toBe('q1__self');
    // Condición de la pregunta remapeada
    expect(created.sections[0].questions[1].condition.questionId).toBe('q1__self');
    // El id destino existe realmente entre las preguntas replicadas
    const ids = created.sections[0].questions.map((q: any) => q.id);
    expect(ids).toContain('q1__self');
    // El resto de la condición se preserva intacto
    expect(created.sections[0].questions[1].condition.operator).toBe('equals');
    expect(created.sections[0].questions[1].condition.value).toBe('5');
  });

  it('no inventa condiciones donde no las había', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    const created = saved.find((s) => s.relationType === SELF);
    expect(created.sections[0]).not.toHaveProperty('condition');
    for (const q of created.sections[0].questions) {
      expect(q).not.toHaveProperty('condition');
    }
  });

  it('omite la perspectiva de origen aunque venga en los destinos', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [MANAGER, SELF],
    } as any);

    expect(result.skipped).toContainEqual({
      relationType: MANAGER,
      reason: 'Es la perspectiva de origen',
    });
    expect(result.created).toEqual([{ relationType: SELF, questionCount: 2 }]);
  });

  it('falla si la subplantilla de origen no existe', async () => {
    subTemplateRepo.findOne.mockResolvedValue(null);

    await expect(
      service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF],
      } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('falla si el origen no tiene preguntas que replicar', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, []));

    await expect(
      service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('no persiste nada si no queda ningún destino válido', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [MANAGER],
    } as any);

    expect(result.created).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });

  it('no pisa la perspectiva si se llenó DESPUÉS de la lectura inicial (carrera)', async () => {
    const emptySelf = makeSub(SELF, []);
    const filledSelf = makeSub(SELF, [
      { id: 's', title: 'Llenada por otro admin', questions: [{ id: 'x', text: 'Previa' }] },
    ]);
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    // 1ª lectura (fuera de la tx): la perspectiva está vacía → se acepta.
    subTemplateRepo.find.mockResolvedValueOnce([makeSub(MANAGER, managerSections), emptySelf]);
    // 2ª lectura (dentro de la tx, vía txRepo.findOne): ya tiene contenido.
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections), filledSelf]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    expect(result.created).toHaveLength(0);
    expect(result.skipped).toContainEqual({
      relationType: SELF,
      reason: 'Ya tiene 1 pregunta(s)',
    });
    expect(saved).toHaveLength(0); // no se sobrescribió nada
  });

  it('rechaza perspectivas destino fuera del enum (relation_type es varchar)', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    await expect(
      service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: ['hacker'],
      } as any),
    ).rejects.toThrow(BadRequestException);

    // Nada se persistió: sin subplantillas fantasma en BD.
    expect(saved).toHaveLength(0);
  });

  it('rechaza replicar sobre plantillas globales (tenantId null)', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue({ id: 'tpl-1', tenantId: null } as any);

    await expect(
      service.mirrorSubTemplate('tpl-1', undefined, 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF],
      } as any),
    ).rejects.toThrow(BadRequestException);
  });

  it('useAi=false ni siquiera consulta la cuota de IA', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
      useAi: false,
    } as any);

    expect(aiInsightsService.assertAiQuota).not.toHaveBeenCalled();
    expect(result.mode).toBe('rules');
    expect(result.aiError).toBeUndefined();
  });

  it('sin cuota IA reporta aiError pero completa la replicación', async () => {
    subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
    subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

    const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
      sourceRelationType: MANAGER,
      targetRelationTypes: [SELF],
    } as any);

    expect(aiInsightsService.assertAiQuota).toHaveBeenCalled();
    expect(result.mode).toBe('rules');
    expect(result.aiError).toBe('Sin cuota IA');
    expect(result.created).toHaveLength(1); // la replicación NO se cae
  });

  /**
   * Regresiones de la auditoría previa al deploy.
   *
   * `mode` se reportaba global ('ai' en cuanto la llamada no lanzara), pero el
   * merge de textos es POR PREGUNTA: si el modelo omitía alguna, esa caía a
   * reglas mientras la UI decía "adaptado con IA" y ocultaba el aviso de
   * revisión. Y el marcador `needsReview` estaba documentado pero nunca se
   * escribía.
   */
  describe('regresiones: modo reportado y marcado de revisión', () => {
    const allQuestions = (subs: any[]) =>
      subs.flatMap((s: any) => (s.sections || []).flatMap((sec: any) => sec.questions || []));

    it('marca needsReview en las preguntas resueltas por reglas', async () => {
      subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
      subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);

      const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF],
      } as any);

      expect(result.mode).toBe('rules');
      expect(result.needsReviewCount).toBe(2);
      expect(allQuestions(saved).every((q: any) => q.needsReview === true)).toBe(true);
    });

    it('reporta mixed cuando la IA resuelve solo parte de las preguntas', async () => {
      subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
      subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);
      // La IA devuelve q1 pero omite q2 → q2 debe caer a reglas.
      jest
        .spyOn(service as any, 'rewriteQuestionsWithAi')
        .mockResolvedValue({ [SELF]: { q1: 'Demuestro liderazgo siempre' } });

      const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF],
      } as any);

      expect(result.mode).toBe('mixed');
      expect(result.needsReviewCount).toBe(1);
      const qs = allQuestions(saved);
      expect(qs.find((q: any) => q.id === `q1__${SELF}`).needsReview).toBeUndefined();
      expect(qs.find((q: any) => q.id === `q2__${SELF}`).needsReview).toBe(true);
    });

    it('reporta ai puro solo si la IA resolvió TODAS las preguntas', async () => {
      subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
      subTemplateRepo.find.mockResolvedValue([makeSub(MANAGER, managerSections)]);
      jest.spyOn(service as any, 'rewriteQuestionsWithAi').mockResolvedValue({
        [SELF]: { q1: 'Demuestro liderazgo', q2: 'Mantengo mis compromisos' },
      });

      const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF],
      } as any);

      expect(result.mode).toBe('ai');
      expect(result.needsReviewCount).toBe(0);
      expect(allQuestions(saved).some((q: any) => q.needsReview)).toBe(false);
    });

    it('las perspectivas omitidas no contaminan el modo reportado', async () => {
      // PEER ya tiene contenido → se omite; SELF se crea con IA completa.
      subTemplateRepo.findOne.mockResolvedValue(makeSub(MANAGER, managerSections));
      subTemplateRepo.find.mockResolvedValue([
        makeSub(MANAGER, managerSections),
        makeSub(PEER, managerSections),
      ]);
      jest.spyOn(service as any, 'rewriteQuestionsWithAi').mockResolvedValue({
        [SELF]: { q1: 'Demuestro liderazgo', q2: 'Mantengo mis compromisos' },
      });

      const result = await service.mirrorSubTemplate('tpl-1', 'tenant-1', 'user-1', {
        sourceRelationType: MANAGER,
        targetRelationTypes: [SELF, PEER],
      } as any);

      expect(result.mode).toBe('ai');
      expect(result.needsReviewCount).toBe(0);
    });
  });

});
