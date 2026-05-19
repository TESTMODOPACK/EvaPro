/**
 * surveys.service.spec.ts — k-anonymity en resultados de encuestas
 * (B4-16, Grupo 1 Fase 6). Antes getResults/getENPS exponían texto
 * libre verbatim y desgloses sin umbral en encuestas anónimas con
 * 1-2 respuestas → de-anonimización para el admin.
 */
import { SurveysService } from './surveys.service';

describe('SurveysService — k-anonymity (B4-16)', () => {
  let responseRepo: any;
  let assignmentRepo: any;
  let service: SurveysService;

  const Q_LIKERT = { id: 'q1', questionType: 'likert_5', category: 'clima', questionText: '¿Clima?' };
  const Q_OPEN = { id: 'q2', questionType: 'open_text', category: 'clima', questionText: 'Comentario' };

  const makeSurvey = (over: any = {}) => ({
    id: 's1', title: 'Clima Q1', status: 'closed',
    isAnonymous: true,
    settings: {},
    questions: [Q_LIKERT, Q_OPEN],
    ...over,
  });

  const resp = (likert: number, text: string) => ({
    answers: [
      { questionId: 'q1', value: likert },
      { questionId: 'q2', value: text },
    ],
  });

  beforeEach(() => {
    responseRepo = { find: jest.fn() };
    assignmentRepo = { count: jest.fn().mockResolvedValue(20) };
    service = new SurveysService(
      {} as any, {} as any, responseRepo as any, assignmentRepo as any,
      {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, {} as any, {} as any,
    );
  });

  describe('getResults', () => {
    it('anónima con N < k (default 5) → resultado SUPRIMIDO (sin texto libre ni promedios)', async () => {
      jest.spyOn(service as any, 'findById').mockResolvedValue(makeSurvey());
      responseRepo.find.mockResolvedValue([resp(4, 'jefe tóxico'), resp(2, 'me quiero ir')]);

      const res = await service.getResults('t1', 's1');

      expect(res.kAnonymity).toEqual({ threshold: 5, applied: true, suppressed: true });
      expect(res.openResponses).toEqual([]);
      expect(res.averageByQuestion).toEqual([]);
      expect(res.likertDistribution).toEqual([]);
      expect(res.overallAverage).toBeNull();
      expect(res.totalResponses).toBe(2);
    });

    it('anónima con N >= k → resultados completos (openResponses presentes)', async () => {
      jest.spyOn(service as any, 'findById').mockResolvedValue(makeSurvey());
      responseRepo.find.mockResolvedValue([
        resp(5, 'a'), resp(4, 'b'), resp(3, 'c'), resp(5, 'd'), resp(2, 'e'),
      ]);

      const res = await service.getResults('t1', 's1');

      expect(res.kAnonymity.suppressed).toBe(false);
      expect(res.openResponses.length).toBe(5);
      expect(res.averageByQuestion.length).toBe(1);
    });

    it('NO anónima → k=0, sin supresión aunque N=1', async () => {
      jest.spyOn(service as any, 'findById').mockResolvedValue(makeSurvey({ isAnonymous: false }));
      responseRepo.find.mockResolvedValue([resp(5, 'todo bien')]);

      const res = await service.getResults('t1', 's1');

      expect(res.kAnonymity).toEqual({ threshold: 0, applied: false, suppressed: false });
      expect(res.openResponses.length).toBe(1);
    });

    it('respeta kAnonymityThreshold configurado por encuesta', async () => {
      jest.spyOn(service as any, 'findById').mockResolvedValue(
        makeSurvey({ settings: { kAnonymityThreshold: 3 } }),
      );
      responseRepo.find.mockResolvedValue([resp(5, 'a'), resp(4, 'b'), resp(3, 'c')]);

      const res = await service.getResults('t1', 's1');
      expect(res.kAnonymity.threshold).toBe(3);
      expect(res.kAnonymity.suppressed).toBe(false);
    });
  });

  describe('getENPS', () => {
    it('anónima con total < k → enps null + kAnonymity.suppressed', async () => {
      jest.spyOn(service as any, 'findById').mockResolvedValue(
        makeSurvey({ questions: [{ id: 'q1', questionType: 'nps' }] }),
      );
      responseRepo.find.mockResolvedValue([
        { answers: [{ questionId: 'q1', value: 9 }] },
        { answers: [{ questionId: 'q1', value: 2 }] },
      ]);

      const res = await service.getENPS('t1', 's1');
      expect(res.enps).toBeNull();
      expect(res.kAnonymity).toEqual({ threshold: 5, applied: true, suppressed: true });
    });
  });
});
