/**
 * template-filter.ts — Helper de Fase 2 del plan de auditoria de evaluaciones.
 *
 * Las plantillas (`FormTemplate.sections`) pueden tener preguntas distintas
 * segun el tipo de evaluador (self, manager, peer, direct_report, external).
 * Esto se modela via campo opcional `applicableTo: string[]` a nivel de
 * seccion y/o pregunta.
 *
 * Antes de Fase 2: una sola plantilla servia las MISMAS preguntas a todos
 * los evaluadores, lo cual no respetaba la convencion industria de que un
 * peer no debe responder preguntas que solo el manager puede observar
 * (ej. "asume responsabilidad por resultados del equipo").
 *
 * Backwards-compat: si `applicableTo` esta ausente o vacio, la
 * seccion/pregunta aplica a TODOS los evaluadores (comportamiento default
 * pre-Fase 2). No requiere migration de datos — los templates seed
 * existentes siguen funcionando sin cambios.
 *
 * Reglas:
 *   1. Si la SECCION tiene `applicableTo` y NO incluye el rol → toda la
 *      seccion se omite.
 *   2. Si la PREGUNTA tiene `applicableTo` y NO incluye el rol → la
 *      pregunta se omite (pero la seccion puede seguir si tiene otras
 *      preguntas aplicables).
 *   3. Si ambos casos pasan, la pregunta se incluye.
 *   4. Una seccion sin preguntas aplicables (todas filtradas) se omite
 *      del output (no mostrar secciones vacias al evaluador).
 *
 * Funcion pura: no muta el input, retorna nuevo array. Safe para cachear.
 */

export interface TemplateSection {
  id?: string;
  title?: string;
  applicableTo?: string[];
  questions?: TemplateQuestion[];
  [key: string]: unknown;
}

export interface TemplateQuestion {
  id?: string;
  text?: string;
  type?: string;
  applicableTo?: string[];
  required?: boolean;
  scale?: { min?: number; max?: number; labels?: Record<string, string> };
  options?: string[];
  [key: string]: unknown;
}

/**
 * Decide si una entidad (seccion o pregunta) aplica a un relationType.
 * Si `applicableTo` esta ausente o es array vacio → aplica a TODOS.
 * Si esta definido → solo aplica si incluye el relationType.
 */
function isApplicableToRole(applicableTo: unknown, relationType: string): boolean {
  if (!Array.isArray(applicableTo) || applicableTo.length === 0) {
    return true; // sin filtro = aplica a todos (backwards-compat)
  }
  return applicableTo.includes(relationType);
}

/**
 * Filtra las secciones y preguntas del template segun el relationType del
 * evaluador. Retorna un array nuevo sin mutar el original.
 *
 * @param sections Array de secciones del template (FormTemplate.sections)
 * @param relationType El rol del evaluador: 'self' | 'manager' | 'peer' |
 *                     'direct_report' | 'external'
 * @returns Array de secciones filtradas (puede estar vacio si nada aplica)
 *
 * @example
 *   const sections = [
 *     { id: 's1', title: 'Comunicacion', questions: [
 *       { id: 'q1', text: 'Comunica claro', applicableTo: ['manager','peer'] },
 *       { id: 'q2', text: 'Te entiendo cuando hablo', applicableTo: ['self'] },
 *     ]},
 *     { id: 's2', title: 'Liderazgo', applicableTo: ['manager','direct_report'], questions: [...] },
 *   ];
 *   filterTemplateForRelation(sections, 'peer')
 *   // Retorna solo la seccion 1 con la pregunta 1 (sin q2 porque es solo self).
 *   // Seccion 2 se omite porque applicableTo no incluye 'peer'.
 */
export function filterTemplateForRelation(
  sections: TemplateSection[] | null | undefined,
  relationType: string,
): TemplateSection[] {
  if (!Array.isArray(sections)) return [];

  return sections
    .filter((sec) => isApplicableToRole(sec.applicableTo, relationType))
    .map((sec) => {
      const filteredQuestions = Array.isArray(sec.questions)
        ? sec.questions.filter((q) => isApplicableToRole(q.applicableTo, relationType))
        : [];
      return {
        ...sec,
        questions: filteredQuestions,
      };
    })
    // Si despues del filtrado la seccion quedo sin preguntas, la omitimos
    // (no mostrar secciones vacias al evaluador). Esto cubre el caso donde
    // la seccion NO tiene applicableTo (default: aplica a todos) pero
    // todas sus preguntas tienen applicableTo que excluye al rol actual.
    .filter((sec) => Array.isArray(sec.questions) && sec.questions.length > 0);
}

/**
 * Helper opcional para reportes — extrae todos los question IDs aplicables
 * a un rol. Util para validateRequiredAnswers donde necesitamos saber que
 * preguntas son obligatorias para ese rol.
 */
export function getApplicableQuestionIds(
  sections: TemplateSection[] | null | undefined,
  relationType: string,
): string[] {
  return filterTemplateForRelation(sections, relationType)
    .flatMap((sec) => sec.questions ?? [])
    .map((q) => q.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
}
