/**
 * perspective-mirror.ts — Replicación "espejo" de subplantillas entre
 * perspectivas de evaluación (jun 2026).
 *
 * Caso de uso: el admin arma la subplantilla de JEFATURA y quiere la misma
 * batería de preguntas para AUTOEVALUACIÓN (u otra perspectiva) sin
 * reescribirla a mano. Copiar literal no sirve: "Demuestra liderazgo de
 * forma consistente" leído por el propio evaluado debe decir "Demuestro
 * liderazgo de forma consistente".
 *
 * Dos motores de transformación:
 *   1. IA (Claude) — camino principal. Reescribe con naturalidad y ajusta
 *      el encuadre por rol (un par observa la colaboración; un reporte
 *      directo observa el liderazgo recibido).
 *   2. Reglas determinísticas (este archivo) — fallback cuando no hay
 *      cuota IA, falla la API o el admin elige no usarla. Es best-effort:
 *      cubre pronombres/posesivos y los verbos más frecuentes en
 *      evaluaciones, pero el español tiene demasiados irregulares para
 *      garantizar perfección. Por eso TODA pregunta generada por reglas
 *      se marca con `needsReview: true` para que el admin la revise.
 */

import { RelationType } from '../../evaluations/entities/evaluation-assignment.entity';

/** Voz gramatical con la que se redacta cada perspectiva. */
type Voice = 'first' | 'third';

export interface PerspectiveProfile {
  /** Etiqueta legible (es-CL) para UI y prompts. */
  label: string;
  /** first = el evaluador habla de sí mismo (autoevaluación). */
  voice: Voice;
  /** Qué observa realmente este evaluador — guía el encuadre de la IA. */
  aiInstruction: string;
}

/**
 * Perfil por relationType. `aiInstruction` se inyecta en el prompt para
 * que Claude no solo conjugue, sino que reencuadre la pregunta hacia lo
 * que ese evaluador puede observar de primera mano.
 */
export const PERSPECTIVE_PROFILES: Record<string, PerspectiveProfile> = {
  [RelationType.MANAGER]: {
    label: 'Jefatura',
    voice: 'third',
    aiInstruction:
      'La jefatura evalúa a un colaborador de su equipo. Habla en tercera persona sobre el evaluado y se enfoca en desempeño, resultados y cumplimiento de expectativas del rol.',
  },
  [RelationType.SELF]: {
    label: 'Autoevaluación',
    voice: 'first',
    aiInstruction:
      'El propio colaborador se autoevalúa. Habla en PRIMERA persona ("Demuestro...", "Aplico...", "Considero que..."). Mantiene el foco en la autorreflexión sobre su propio desempeño.',
  },
  [RelationType.PEER]: {
    label: 'Pares',
    voice: 'third',
    aiInstruction:
      'Un par (colega del mismo nivel) evalúa a quien trabaja con él. Habla en tercera persona y se enfoca en lo que un par SÍ observa: colaboración diaria, apoyo mutuo, comunicación en proyectos compartidos. Evita preguntas sobre gestión de desempeño o decisiones jerárquicas que un par no presencia.',
  },
  [RelationType.DIRECT_REPORT]: {
    label: 'Reportes directos',
    voice: 'third',
    aiInstruction:
      'Un colaborador evalúa a SU jefatura (feedback ascendente). Habla en tercera persona sobre el líder y se enfoca en la calidad del liderazgo RECIBIDO: claridad de expectativas, retroalimentación, apoyo al desarrollo, trato. Evita preguntas sobre resultados de negocio que un reporte directo no puede juzgar.',
  },
  [RelationType.EXTERNAL]: {
    label: 'Evaluador externo',
    voice: 'third',
    aiInstruction:
      'Un evaluador externo (cliente, proveedor o stakeholder) evalúa a la persona. Habla en tercera persona y se limita a lo observable en la relación comercial o de servicio.',
  },
};

/**
 * Verbos frecuentes en cuestionarios de evaluación, mapeados de primera a
 * tercera persona del singular (presente indicativo). Incluye irregulares
 * (mantengo→mantiene, tengo→tiene) donde la regla general falla.
 *
 * Se usa en ambos sentidos: la tabla inversa se deriva automáticamente.
 */
const VERB_FIRST_TO_THIRD: Record<string, string> = {
  // Ser / estar / haber
  soy: 'es', estoy: 'está', tengo: 'tiene', he: 'ha',
  // Alta frecuencia en competencias
  demuestro: 'demuestra', aplico: 'aplica', mantengo: 'mantiene',
  cumplo: 'cumple', logro: 'logra', alcanzo: 'alcanza',
  comparto: 'comparte', comunico: 'comunica', colaboro: 'colabora',
  apoyo: 'apoya', ayudo: 'ayuda', facilito: 'facilita',
  resuelvo: 'resuelve', propongo: 'propone', identifico: 'identifica',
  analizo: 'analiza', evalúo: 'evalúa', priorizo: 'prioriza',
  planifico: 'planifica', organizo: 'organiza', gestiono: 'gestiona',
  ejecuto: 'ejecuta', entrego: 'entrega', asumo: 'asume',
  tomo: 'toma', decido: 'decide', respondo: 'responde',
  escucho: 'escucha', reconozco: 'reconoce', valoro: 'valora',
  motivo: 'motiva', inspiro: 'inspira', oriento: 'orienta',
  delego: 'delega', superviso: 'supervisa', lidero: 'lidera',
  desarrollo: 'desarrolla', mejoro: 'mejora', aprendo: 'aprende',
  comprendo: 'comprende', entiendo: 'entiende', conozco: 'conoce',
  adapto: 'adapta', actúo: 'actúa', participo: 'participa',
  contribuyo: 'contribuye', incluyo: 'incluye', construyo: 'construye',
  respeto: 'respeta', cuido: 'cuida', considero: 'considera',
  puedo: 'puede', hago: 'hace', digo: 'dice', veo: 've', doy: 'da',
  busco: 'busca', ofrezco: 'ofrece', atiendo: 'atiende',
  promuevo: 'promueve', sugiero: 'sugiere', anticipo: 'anticipa',
  documento: 'documenta', reporto: 'reporta', informo: 'informa',
};

/** Tabla inversa (tercera → primera). Derivada para no duplicar datos. */
const VERB_THIRD_TO_FIRST: Record<string, string> = Object.fromEntries(
  Object.entries(VERB_FIRST_TO_THIRD).map(([first, third]) => [third, first]),
);

/** Pronombres y posesivos, primera → tercera persona. */
const PRONOUN_FIRST_TO_THIRD: Record<string, string> = {
  mi: 'su', mis: 'sus', mío: 'suyo', mía: 'suya',
  míos: 'suyos', mías: 'suyas', me: 'le', conmigo: 'con esta persona',
  yo: 'esta persona',
};

/** Pronombres y posesivos, tercera → primera persona. */
const PRONOUN_THIRD_TO_FIRST: Record<string, string> = {
  su: 'mi', sus: 'mis', suyo: 'mío', suya: 'mía',
  suyos: 'míos', suyas: 'mías', le: 'me',
};

/**
 * Sujetos explícitos que aparecen al inicio de preguntas en tercera
 * persona. Al pasar a autoevaluación se eliminan (el sujeto es implícito:
 * "El colaborador demuestra X" → "Demuestro X").
 */
const THIRD_PERSON_SUBJECTS = [
  'el colaborador',
  'la colaboradora',
  'el evaluado',
  'la evaluada',
  'esta persona',
  'la persona evaluada',
  'mi jefatura',
  'su jefatura',
];

/** Capitaliza la primera letra respetando el resto del string. */
function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Reemplaza palabras completas usando un diccionario, preservando la
 * capitalización original de cada ocurrencia. Case-insensitive en el
 * match, case-preserving en el resultado.
 */
function replaceWords(text: string, dict: Record<string, string>): string {
  if (Object.keys(dict).length === 0) return text;
  // \p{L} con flag u para que los acentos cuenten como parte de la palabra
  // (evita que "evalúo" matchee como "eval" + "úo").
  return text.replace(/\p{L}+/gu, (word) => {
    const replacement = dict[word.toLowerCase()];
    if (!replacement) return word;
    // Preservar capitalización inicial de la palabra original.
    return word[0] === word[0].toUpperCase()
      ? capitalizeFirst(replacement)
      : replacement;
  });
}

/**
 * Transforma el texto de una pregunta entre perspectivas usando reglas
 * determinísticas (fallback sin IA).
 *
 * Alcance real:
 *   - third → first: quita el sujeto explícito, conjuga verbos conocidos
 *     y ajusta posesivos ("Su equipo" → "Mi equipo").
 *   - first → third: conjuga a tercera y ajusta posesivos.
 *   - third → third (ej. jefatura → pares): NO cambia el texto. El
 *     reencuadre por rol requiere reescritura semántica, que solo la IA
 *     hace bien; devolver el original es preferible a inventar.
 *
 * @returns el texto transformado. Siempre marcar `needsReview` en el
 *          resultado: las reglas son best-effort, no perfectas.
 */
export function transformQuestionByRules(
  text: string,
  from: string,
  to: string,
): string {
  const fromVoice = PERSPECTIVE_PROFILES[from]?.voice ?? 'third';
  const toVoice = PERSPECTIVE_PROFILES[to]?.voice ?? 'third';

  if (!text?.trim()) return text;
  // Misma voz gramatical → sin transformación mecánica posible.
  if (fromVoice === toVoice) return text;

  let out = text;

  if (fromVoice === 'third' && toVoice === 'first') {
    // 1. Quitar sujeto explícito al inicio ("El colaborador demuestra…").
    const lower = out.toLowerCase();
    for (const subject of THIRD_PERSON_SUBJECTS) {
      if (lower.startsWith(subject + ' ')) {
        out = out.slice(subject.length + 1);
        break;
      }
    }
    // 2. Conjugar verbos + ajustar pronombres.
    out = replaceWords(out, { ...VERB_THIRD_TO_FIRST, ...PRONOUN_THIRD_TO_FIRST });
    return capitalizeFirst(out.trim());
  }

  // first → third
  out = replaceWords(out, { ...VERB_FIRST_TO_THIRD, ...PRONOUN_FIRST_TO_THIRD });
  return capitalizeFirst(out.trim());
}

/** Etiqueta legible de una perspectiva (fallback al propio código). */
export function perspectiveLabel(relationType: string): string {
  return PERSPECTIVE_PROFILES[relationType]?.label ?? relationType;
}
