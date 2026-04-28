/**
 * sub-template-defaults.spec.ts — Tests del baseline de Fase 3 (Opción A).
 *
 * Estos pesos son industria-estándar y los usa la auto-creación de
 * subplantillas. Si un dev cambia los defaults, este test obliga a
 * confirmar que la nueva configuración sigue sumando 1.0.
 */
import { RelationType } from '../../evaluations/entities/evaluation-assignment.entity';
import {
  DEFAULT_WEIGHTS_BY_CYCLE_TYPE,
  SUB_TEMPLATE_DISPLAY_ORDER,
  WEIGHT_SUM_TOLERANCE,
  getRelationsForCycleType,
} from './sub-template-defaults';

describe('DEFAULT_WEIGHTS_BY_CYCLE_TYPE', () => {
  const cycleTypes = ['90', '180', '270', '360'];

  cycleTypes.forEach((type) => {
    it(`pesos del cycle type ${type} suman 1.0 ± tolerancia`, () => {
      const weights = DEFAULT_WEIGHTS_BY_CYCLE_TYPE[type];
      expect(weights).toBeDefined();
      const sum = Object.values(weights).reduce((s, w) => s + (w ?? 0), 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(WEIGHT_SUM_TOLERANCE);
    });

    it(`cada peso del cycle type ${type} esta en [0,1]`, () => {
      const weights = DEFAULT_WEIGHTS_BY_CYCLE_TYPE[type];
      for (const [, w] of Object.entries(weights)) {
        if (w === undefined) continue;
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(1);
      }
    });
  });

  it('90° tiene exactamente 2 roles (manager + self)', () => {
    const w = DEFAULT_WEIGHTS_BY_CYCLE_TYPE['90'];
    const roles = Object.keys(w);
    expect(roles).toEqual(expect.arrayContaining([RelationType.MANAGER, RelationType.SELF]));
    expect(roles).not.toContain(RelationType.PEER);
    expect(roles).not.toContain(RelationType.DIRECT_REPORT);
  });

  it('180° tiene 3 roles (manager + self + peer)', () => {
    const w = DEFAULT_WEIGHTS_BY_CYCLE_TYPE['180'];
    const roles = Object.keys(w);
    expect(roles).toEqual(
      expect.arrayContaining([RelationType.MANAGER, RelationType.SELF, RelationType.PEER]),
    );
    expect(roles).not.toContain(RelationType.DIRECT_REPORT);
  });

  it('270° tiene 4 roles (manager + self + peer + direct_report)', () => {
    const w = DEFAULT_WEIGHTS_BY_CYCLE_TYPE['270'];
    const roles = Object.keys(w);
    expect(roles).toEqual(
      expect.arrayContaining([
        RelationType.MANAGER,
        RelationType.SELF,
        RelationType.PEER,
        RelationType.DIRECT_REPORT,
      ]),
    );
  });

  it('360° tiene 4 roles (mismo que 270 + etapa de calibracion)', () => {
    const w = DEFAULT_WEIGHTS_BY_CYCLE_TYPE['360'];
    const roles = Object.keys(w);
    expect(roles).toEqual(
      expect.arrayContaining([
        RelationType.MANAGER,
        RelationType.SELF,
        RelationType.PEER,
        RelationType.DIRECT_REPORT,
      ]),
    );
  });

  it('manager tiene mas peso en 90 que en 360 (industria)', () => {
    expect(DEFAULT_WEIGHTS_BY_CYCLE_TYPE['90'][RelationType.MANAGER]!).toBeGreaterThan(
      DEFAULT_WEIGHTS_BY_CYCLE_TYPE['360'][RelationType.MANAGER]!,
    );
  });
});

describe('SUB_TEMPLATE_DISPLAY_ORDER', () => {
  it('self viene primero, external al final', () => {
    expect(SUB_TEMPLATE_DISPLAY_ORDER[RelationType.SELF]).toBeLessThan(
      SUB_TEMPLATE_DISPLAY_ORDER[RelationType.MANAGER],
    );
    expect(SUB_TEMPLATE_DISPLAY_ORDER[RelationType.EXTERNAL]).toBeGreaterThan(
      SUB_TEMPLATE_DISPLAY_ORDER[RelationType.DIRECT_REPORT],
    );
  });

  it('todos los relationTypes tienen display order asignado', () => {
    for (const rel of Object.values(RelationType)) {
      expect(SUB_TEMPLATE_DISPLAY_ORDER[rel]).toBeGreaterThan(0);
    }
  });

  it('display orders son unicos (no hay tabs duplicados)', () => {
    const orders = Object.values(SUB_TEMPLATE_DISPLAY_ORDER);
    const set = new Set(orders);
    expect(set.size).toBe(orders.length);
  });
});

describe('getRelationsForCycleType', () => {
  it('90 retorna [self, manager] en ese orden', () => {
    expect(getRelationsForCycleType('90')).toEqual([
      RelationType.SELF,
      RelationType.MANAGER,
    ]);
  });

  it('180 retorna [self, manager, peer] en ese orden', () => {
    expect(getRelationsForCycleType('180')).toEqual([
      RelationType.SELF,
      RelationType.MANAGER,
      RelationType.PEER,
    ]);
  });

  it('270 retorna [self, manager, peer, direct_report]', () => {
    expect(getRelationsForCycleType('270')).toEqual([
      RelationType.SELF,
      RelationType.MANAGER,
      RelationType.PEER,
      RelationType.DIRECT_REPORT,
    ]);
  });

  it('360 retorna los mismos 4 que 270', () => {
    expect(getRelationsForCycleType('360')).toEqual(getRelationsForCycleType('270'));
  });

  it('cycle type invalido retorna []', () => {
    expect(getRelationsForCycleType('999')).toEqual([]);
    expect(getRelationsForCycleType('')).toEqual([]);
  });
});

describe('WEIGHT_SUM_TOLERANCE', () => {
  it('es razonable (≤ 0.01)', () => {
    expect(WEIGHT_SUM_TOLERANCE).toBeGreaterThan(0);
    expect(WEIGHT_SUM_TOLERANCE).toBeLessThanOrEqual(0.01);
  });
});
