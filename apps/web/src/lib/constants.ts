/**
 * Defaults for tenant-configurable custom settings.
 * Each key matches the key used in tenant.settings JSONB.
 */

export const CUSTOM_SETTINGS_DEFAULTS: Record<string, string[]> = {
  calibrationCausals: [
    'Ajuste por desempeño real observado',
    'Consideración de circunstancias excepcionales',
    'Alineación con el equipo',
    'Contexto adicional del período evaluado',
    'Inconsistencia en la autoevaluación',
    'Reconocimiento de logros no capturados',
    'Criterio del comité calibrador',
  ],
  evaluationScaleLabels: [
    '1 - Insuficiente',
    '2 - Necesita mejora',
    '3 - Cumple expectativas',
    '4 - Supera expectativas',
    '5 - Excepcional',
  ],
  competencyCategories: [
    'Liderazgo',
    'Competencias técnicas',
    'Valores organizacionales',
    'Comunicación',
    'Trabajo en equipo',
    'Orientación a resultados',
  ],
  objectiveTypes: [
    'Estratégico',
    'Operativo',
    'Desarrollo profesional',
    'Individual',
  ],
  potentialLevels: [
    'Alto potencial',
    'Potencial medio',
    'En desarrollo',
  ],
  evaluationPeriods: [
    'Anual',
    'Semestral',
    'Trimestral',
  ],
};

export const CUSTOM_SETTINGS_META: Record<string, { label: string; description: string }> = {
  calibrationCausals: {
    label: 'Causales de Calibración',
    description: 'Razones disponibles al ajustar puntajes en sesiones de calibración',
  },
  evaluationScaleLabels: {
    label: 'Escalas de Evaluación',
    description: 'Etiquetas para los niveles de la escala de desempeño',
  },
  competencyCategories: {
    label: 'Categorías de Competencias',
    description: 'Tipos de competencias que se evalúan en la organización',
  },
  objectiveTypes: {
    label: 'Tipos de Objetivos',
    description: 'Clasificación de objetivos disponibles para los colaboradores',
  },
  potentialLevels: {
    label: 'Niveles de Potencial',
    description: 'Etiquetas para clasificar el potencial de los colaboradores',
  },
  evaluationPeriods: {
    label: 'Períodos de Evaluación',
    description: 'Frecuencias de evaluación disponibles en la organización',
  },
};

export const CUSTOM_SETTINGS_KEYS = Object.keys(CUSTOM_SETTINGS_DEFAULTS);
