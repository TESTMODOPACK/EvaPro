/**
 * promotions.controller.spec.ts — Redacción del breakdown sensible que
 * ve manager/admin en /promotions/candidates/:userId/explain
 * (B4-25 mood individual, B4-26 360/peer de baja N). Grupo 1 Fase 6.
 */
import { PromotionsController } from './promotions.controller';

describe('PromotionsController.redactSensitiveDimensions', () => {
  // Solo se ejercita el método puro de redacción; las deps no se usan.
  const ctrl = new PromotionsController(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
  const redact = (rec: any) =>
    (ctrl as any).redactSensitiveDimensions(rec);

  it('B4-25: elimina dimensions.engagement.moodAvg, conserva zScore/weight', () => {
    const rec = {
      userId: 'u1',
      dimensions: {
        engagement: { raw: 4.2, zScore: 0.8, weight: 0.1, moodAvg: 4.7 },
        behavioral: { raw: 3.9, zScore: 0.5, weight: 0.2, evaluatorCount: 6 },
      },
    };
    const out = redact(rec);
    expect(out.dimensions.engagement.moodAvg).toBeUndefined();
    expect(out.dimensions.engagement.zScore).toBe(0.8);
    expect(out.dimensions.engagement.weight).toBe(0.1);
    // behavioral con evaluatorCount alto: raw se conserva.
    expect(out.dimensions.behavioral.raw).toBe(3.9);
    expect(out.dimensions.behavioral.suppressed).toBeUndefined();
  });

  it('B4-26: suprime behavioral.raw cuando evaluatorCount < 3', () => {
    const rec = {
      dimensions: {
        engagement: { raw: 1, zScore: 0, weight: 0.1, moodAvg: 2 },
        behavioral: { raw: 4.8, zScore: 1.2, weight: 0.2, evaluatorCount: 1 },
      },
    };
    const out = redact(rec);
    expect(out.dimensions.behavioral.raw).toBeUndefined();
    expect(out.dimensions.behavioral.suppressed).toBe(true);
    expect(out.dimensions.behavioral.zScore).toBe(1.2);
    expect(out.dimensions.engagement.moodAvg).toBeUndefined();
  });

  it('no muta el rec/dimensions original (devuelve copia)', () => {
    const rec = {
      dimensions: {
        engagement: { moodAvg: 4.7, zScore: 0.8 },
        behavioral: { raw: 4.8, evaluatorCount: 1 },
      },
    };
    redact(rec);
    expect(rec.dimensions.engagement.moodAvg).toBe(4.7);
    expect(rec.dimensions.behavioral.raw).toBe(4.8);
  });

  it('rec sin dimensions → devuelve tal cual', () => {
    const rec = { userId: 'x' };
    expect(redact(rec)).toEqual(rec);
  });
});
