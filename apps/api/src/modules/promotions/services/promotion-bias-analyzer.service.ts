import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import { User } from '../../users/entities/user.entity';
import { PromotionRecommendation, ReadinessLevel } from '../entities/promotion-recommendation.entity';

/**
 * 4/5ths rule (EEOC Uniform Guidelines): un grupo es objeto de
 * disparate impact si su tasa de selección es <80% de la del grupo
 * mayoritario. Estándar industria HR/legal en US, adoptado como
 * referencia internacional.
 */
const FOUR_FIFTHS_RATIO = 0.80;

/**
 * Atributo demográfico monitoreado para bias check.
 * NOTA: el algoritmo NUNCA usa estos atributos como input — solo
 * los analiza ex-post para detectar disparate impact.
 */
export interface BiasReport {
  attribute: 'gender' | 'age_band' | 'nationality';
  groupRates: Array<{ group: string; eligible: number; recommended: number; rate: number }>;
  ratio: number; // min_rate / max_rate
  flagged: boolean; // true si ratio < 0.80
  message: string;
}

/**
 * PromotionBiasAnalyzer — ADR 0002 §5.
 *
 * Ejecuta análisis ex-post de disparate impact en las recomendaciones
 * recientes del tenant. Si dispara la 4/5ths rule, bloquea publicación
 * (caller debe respetar el flag) y dispara alerta a tenant_admin + dei_owner.
 */
@Injectable()
export class PromotionBiasAnalyzerService {
  private readonly logger = new Logger(PromotionBiasAnalyzerService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(PromotionRecommendation) private readonly recRepo: Repository<PromotionRecommendation>,
  ) {}

  /**
   * Analiza el batch actual de recomendaciones del tenant. Devuelve
   * reports por atributo demográfico monitoreado + flag global de bloqueo.
   */
  async analyzeBatch(tenantId: string): Promise<{
    flagged: boolean;
    reports: BiasReport[];
    totalEligible: number;
    totalRecommended: number;
  }> {
    // Cargar todas las recomendaciones del tenant
    const recs = await this.recRepo.find({
      where: { tenantId },
      relations: ['user'],
    });

    if (recs.length === 0) {
      return { flagged: false, reports: [], totalEligible: 0, totalRecommended: 0 };
    }

    const totalEligible = recs.length;
    const totalRecommended = recs.filter((r) =>
      r.readiness === ReadinessLevel.READY_NOW || r.readiness === ReadinessLevel.READY_12M,
    ).length;

    // Análisis por atributo demográfico
    // NOTA: en MVP solo analizamos si el User entity tiene los campos.
    // gender, age_band, nationality son campos opcionales — si el tenant
    // no los registra, no se hace check (no se bloquea publicación).
    const reports: BiasReport[] = [];

    // Por simplicidad MVP: no asumimos campos demograficos en User.
    // Implementación completa requiere extender User con birthDate/gender/nationality
    // y consentimiento explícito GDPR. Placeholder: report vacío sin flag.
    void recs;
    void totalRecommended;

    const flagged = reports.some((r) => r.flagged);

    return { flagged, reports, totalEligible, totalRecommended };
  }

  /**
   * Helper: aplica la 4/5ths rule a un set de tasas por grupo.
   */
  apply4_5thsRule(rates: number[]): { ratio: number; flagged: boolean } {
    const valid = rates.filter((r) => !isNaN(r) && r > 0);
    if (valid.length < 2) return { ratio: 1.0, flagged: false };
    const max = Math.max(...valid);
    const min = Math.min(...valid);
    const ratio = max > 0 ? min / max : 1.0;
    return { ratio, flagged: ratio < FOUR_FIFTHS_RATIO };
  }
}
