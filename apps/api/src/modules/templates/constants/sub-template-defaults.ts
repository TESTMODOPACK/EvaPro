/**
 * sub-template-defaults.ts — Defaults de Fase 3 (Opción A).
 *
 * Define qué subplantillas se auto-crean por cada cycle type, con
 * qué peso por defecto y en qué orden de visualización.
 *
 * Estos defaults se usan cuando:
 *   - Se crea un FormTemplate con defaultCycleType set
 *   - Se ejecuta la migración inline desde sections legacy con applicableTo
 *   - Se sugiere una distribución inicial al admin
 *
 * Los pesos suman exactamente 1.0 (verificado en spec). El admin puede
 * modificarlos después en el editor.
 */
import { RelationType } from '../../evaluations/entities/evaluation-assignment.entity';

/**
 * Pesos por defecto por cycle type. Suma siempre = 1.000.
 *
 * Convención estándar de 360° feedback (decisión de producto mayo 2026 —
 * alineamiento con la literatura de Bracken & Rose):
 *   - 90°  : Manager (1.00) — top-down puro, sin autoevaluación.
 *   - 180° : Manager (0.70) + Self (0.30) — agrega autoevaluación.
 *   - 270° : Manager (0.50) + Self (0.20) + Peer (0.30) — agrega pares.
 *   - 360° : Manager (0.35) + Self (0.15) + Peer (0.25) + Direct Report
 *            (0.25) — agrega reportes directos. Además incluye una etapa
 *            adicional de Calibración (ver generateStagesForCycle).
 *
 * Los pesos previos a este commit asumían una taxonomía corrida una
 * posición (90° incluía self, 180° incluía peer, etc.). El admin puede
 * sobrescribir los defaults en el editor de subplantillas.
 */
export const DEFAULT_WEIGHTS_BY_CYCLE_TYPE: Record<string, Partial<Record<RelationType, number>>> = {
  '90': {
    [RelationType.MANAGER]: 1.000,
  },
  '180': {
    [RelationType.MANAGER]: 0.700,
    [RelationType.SELF]: 0.300,
  },
  '270': {
    [RelationType.MANAGER]: 0.500,
    [RelationType.SELF]: 0.200,
    [RelationType.PEER]: 0.300,
  },
  '360': {
    [RelationType.MANAGER]: 0.350,
    [RelationType.SELF]: 0.150,
    [RelationType.PEER]: 0.250,
    [RelationType.DIRECT_REPORT]: 0.250,
  },
};

/**
 * Orden de visualización estable de las subplantillas en el editor.
 * Self primero (autorreflexión es lo que el evaluado completa primero
 * en la lógica del flujo), luego manager, peer, direct_report, external.
 */
export const SUB_TEMPLATE_DISPLAY_ORDER: Record<RelationType, number> = {
  [RelationType.SELF]: 1,
  [RelationType.MANAGER]: 2,
  [RelationType.PEER]: 3,
  [RelationType.DIRECT_REPORT]: 4,
  [RelationType.EXTERNAL]: 5,
};

/**
 * Tolerancia para validar que los pesos suman 1.0 (evita errores por
 * float arithmetic — ej. 0.1 + 0.2 = 0.30000000000000004).
 */
export const WEIGHT_SUM_TOLERANCE = 0.001;

/**
 * Devuelve los relationTypes default para un cycle type, en su orden
 * de visualización.
 */
export function getRelationsForCycleType(cycleType: string): RelationType[] {
  const weights = DEFAULT_WEIGHTS_BY_CYCLE_TYPE[cycleType];
  if (!weights) return [];
  return (Object.keys(weights) as RelationType[]).sort(
    (a, b) => SUB_TEMPLATE_DISPLAY_ORDER[a] - SUB_TEMPLATE_DISPLAY_ORDER[b],
  );
}
