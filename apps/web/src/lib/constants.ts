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
  departments: [
    'Tecnología',
    'Recursos Humanos',
    'Ventas',
    'Marketing',
    'Operaciones',
    'Finanzas',
    'Legal',
    'Administración',
  ],
  jobRequirements: [
    'Educación media completa',
    'Título técnico de nivel superior',
    'Título profesional universitario',
    'Postgrado / Magíster',
    'Certificaciones profesionales vigentes',
    'Sin experiencia requerida',
    '1-2 años de experiencia en cargo similar',
    '3-5 años de experiencia en cargo similar',
    '5-10 años de experiencia en el área',
    'Más de 10 años de experiencia',
    'Experiencia en liderazgo de equipos',
    'Experiencia en gestión de proyectos',
    'Dominio de herramientas Office / Google Workspace',
    'Manejo de software especializado del área',
    'Conocimiento de normativa legal del sector',
    'Manejo de ERP / sistemas de gestión',
    'Habilidades de análisis de datos',
    'Manejo de idioma inglés (nivel intermedio o superior)',
    'Trabajo en equipo',
    'Comunicación efectiva',
    'Orientación a resultados',
    'Capacidad de resolución de problemas',
    'Liderazgo y toma de decisiones',
    'Adaptabilidad al cambio',
    'Proactividad e iniciativa',
    'Disponibilidad para trabajar presencial',
    'Disponibilidad para trabajo remoto/híbrido',
    'Disponibilidad para viajar',
    'Disponibilidad inmediata',
    'Licencia de conducir vigente',
    'Currículum vitae actualizado',
    'Certificado de antecedentes',
    'Referencias laborales (mínimo 2)',
    'Pretensiones de renta',
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
  departments: {
    label: 'Departamentos',
    description: 'Departamentos de la organización disponibles para asignar a colaboradores',
  },
  jobRequirements: {
    label: 'Requisitos de Cargo',
    description: 'Requisitos predefinidos que se pueden seleccionar al crear un proceso de evaluación de postulantes',
  },
};

export const CUSTOM_SETTINGS_KEYS = Object.keys(CUSTOM_SETTINGS_DEFAULTS);
