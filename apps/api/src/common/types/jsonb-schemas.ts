/**
 * Shared TypeScript interfaces for JSONB columns across the EVA360 schema.
 *
 * Why this exists:
 *   Several entities store structured data in JSONB columns using `any`.
 *   That erases compile-time safety and invites silent schema drift — a bug
 *   that's hard to diagnose because the DB accepts anything. These interfaces
 *   document the expected shape of each column and let TypeScript catch
 *   mismatches at write time.
 *
 * Rules:
 *   - All fields that MAY be missing are explicitly optional (`?`).
 *   - Every new producer/consumer of these columns MUST update the
 *     corresponding interface here.
 *   - Never store data that isn't documented in one of these types.
 */

// ─── Tenant.settings ────────────────────────────────────────────────────────

/**
 * Known fields stored under `tenant.settings` — this is documentation-first.
 * The index signature at the end is an escape hatch for fields added in the
 * wild; prefer adding explicit entries here over using the escape hatch.
 */
export interface TenantSettings {
  // Catalog string arrays
  /** Causales de ajuste en calibración de talento. */
  calibrationCausals?: string[];
  /** Etiquetas textuales asociadas a cada valor de la escala de desempeño. */
  evaluationScaleLabels?: string[];
  /** Tipos de objetivo seleccionables al crear OKRs. */
  objectiveTypes?: string[];
  /** Niveles de potencial usados en talent assessment. */
  potentialLevels?: string[];
  /** Periodos válidos para ciclos de evaluación. */
  evaluationPeriods?: string[];
  /** Legacy: lista de nombres de departamento (ahora hay tabla departments). */
  departments?: string[];
  /** Legacy: lista de cargos con nivel (ahora hay tabla positions). */
  positions?: Array<{ name: string; level: number }>;
  /** Requisitos seleccionables al crear un proceso de selección. */
  jobRequirements?: string[];

  // Session / security
  /** Minutos de inactividad tras los que la sesión expira (override global). */
  sessionTimeoutMinutes?: number | null;

  // Branding
  logoUrl?: string | null;
  /** #hex, primary accent color. */
  primaryColor?: string | null;
  /** #hex, alias legacy. */
  brandColor?: string;

  // Localization
  timezone?: string | null;
  dateFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | string | null;
  defaultLanguage?: 'es' | 'en' | 'pt' | string | null;

  // Email
  emailFrom?: string | null;

  // Notification preferences
  emailNotifications?: boolean;
  notificationTypes?: Record<string, boolean>;

  // Feature flags
  aiEnabled?: boolean;
  enpsEnabled?: boolean;

  // Feedback module config
  feedbackConfig?: {
    scope?: 'all' | 'department' | 'team';
    allowAnonymous?: boolean;
    minMessageLength?: number;
    allowPeerFeedback?: boolean;
    requireCompetency?: boolean;
  };

  // Onboarding wizard state
  onboarding?: {
    completed?: boolean;
    currentStep?: number;
    completedSteps?: string[];
  };

  /**
   * Escape hatch for ad-hoc fields. New explicit fields should be added above
   * rather than relying on this. Values are intentionally permissive because
   * the shape is often dynamic in the tenant settings UI.
   */
  [extra: string]: unknown;
}

// ─── EvaluationCycle.settings ───────────────────────────────────────────────

export interface CycleSettings {
  /** Si true, los evaluadores pares son auto-asignados por el sistema. */
  autoAssignPeers?: boolean;
  /** Número de pares a asignar automáticamente (default 3). */
  autoPeerCount?: number;
  /** Si true, se permite calibración de talento tras cerrar el ciclo. */
  calibrationEnabled?: boolean;
  /** Si true, los managers pueden ver auto-evaluaciones de sus reports. */
  managersSeeSelfEvals?: boolean;
  /** Plantilla/form asociado al ciclo para cada tipo de evaluación. */
  templates?: {
    selfEval?: string;
    peerEval?: string;
    managerEval?: string;
  };
  /** Fechas tope parciales (por etapa) si no se usa CycleStage. */
  deadlines?: Record<string, string>;

  /** ISO timestamp cuando el ciclo fue pausado. */
  pausedAt?: string;
  /** userId que pausó el ciclo. */
  pausedBy?: string;
  /** ISO timestamp cuando el ciclo fue reanudado. */
  resumedAt?: string;
  /** Resumen estructurado del cierre del ciclo (snapshot al momento del close). */
  closureSummary?: Record<string, unknown>;
  /** Configuración de anonimato por tipo de evaluación (peer/subordinate). */
  anonymity?: Record<string, boolean>;

  /** Escape hatch para settings específicos del ciclo aún no modelados. */
  [extra: string]: unknown;
}

// ─── Notification.metadata ──────────────────────────────────────────────────

/** Datos de contexto para renderizar links/acciones desde una notificación. */
export interface NotificationMetadata {
  cycleId?: string;
  assignmentId?: string;
  objectiveId?: string;
  surveyId?: string;
  checkinId?: string;
  planId?: string;      // development plan
  itemId?: string;      // redemption item
  redemptionId?: string;
  badgeId?: string;
  recognitionId?: string;
  challengeId?: string;
  contractId?: string;
  [extra: string]: string | number | boolean | undefined;
}

// ─── Badge.criteria ─────────────────────────────────────────────────────────

/** Regla de auto-otorgamiento de una insignia. */
export type BadgeCriteriaType =
  | 'recognitions_received'
  | 'recognitions_sent'
  | 'total_points'
  | 'feedback_given'
  | 'objectives_completed'
  | 'manual';

export interface BadgeCriteria {
  type: BadgeCriteriaType;
  /** Umbral para otorgar (N reconocimientos, N puntos, etc.). Omitido si type='manual'. */
  threshold?: number;
  /** Ventana temporal opcional ('month', 'quarter', 'year', 'all_time'). */
  period?: 'month' | 'quarter' | 'year' | 'all_time';
}

// ─── EvaluationResponse.answers ─────────────────────────────────────────────

/**
 * Mapa de `questionId → valor` dentro de una respuesta de evaluación.
 * El valor puede ser un número (escala likert/nps), string (pregunta abierta),
 * o array de strings (opciones múltiples).
 */
export type EvaluationAnswerValue = number | string | string[];
export type EvaluationAnswers = Record<string, EvaluationAnswerValue>;

// ─── AiInsight.content ──────────────────────────────────────────────────────

/**
 * Payload generado por IA para distintos tipos de insights.
 *
 * Documented shapes per insight type are captured in the individual `Ai*`
 * interfaces below; they're all merged into this union plus an `any`-valued
 * index signature so ad-hoc fields from prompts can be accessed without
 * breaking type-checking. Prefer adding explicit fields to the concrete
 * interfaces over relying on the index signature.
 */
export type AiInsightContent = AiSurveyAnalysis &
  AiPerformanceSummary &
  AiObjectiveSuggestions &
  AiDevelopmentSuggestions & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [extra: string]: any;
  };

export interface AiSurveyAnalysis {
  summary?: string;
  topStrengths?: Array<{ category: string; score: number; insight: string }>;
  criticalAreas?: Array<{ category: string; score: number; urgency: 'low' | 'medium' | 'high'; insight: string }>;
  enpsInterpretation?: string;
  suggestedInitiatives?: Array<{
    title: string;
    description?: string | null;
    priority?: string;
    department?: string | null;
    actionItems?: string[];
  }>;
  sentimentAnalysis?: { positive: number; neutral: number; negative: number };
}

export interface AiPerformanceSummary {
  overallAverage?: number;
  topPerformers?: Array<{ userId: string; score: number }>;
  atRisk?: Array<{ userId: string; reason: string }>;
  insights?: string[];
}

export interface AiObjectiveSuggestions {
  suggestions?: Array<{ title: string; description?: string; keyResults?: string[] }>;
}

export interface AiDevelopmentSuggestions {
  actions?: Array<{ title: string; description?: string; actionType?: string }>;
}

// ─── AuditLog.metadata ──────────────────────────────────────────────────────

/** Detalles libres adjuntos a un registro de auditoría. */
export type AuditLogMetadata = Record<string, string | number | boolean | null | string[]>;

// ─── Recognition.reactions ──────────────────────────────────────────────────

/** emoji → lista de userIds que reaccionaron. */
export type RecognitionReactions = Record<string, string[]>;
