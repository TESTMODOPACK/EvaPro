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

/**
 * Formas verbales que en español son TAMBIÉN sustantivos de uso frecuente en
 * preguntas de competencias. Convertirlas a ciegas rompe el texto:
 *
 *   "la toma de decisiones"   → "la tomo de decisiones"
 *   "escucha activa"          → "escucho activa"
 *   "Brindo apoyo al equipo"  → "Brinda apoya al equipo"
 *   "Contribuyo al desarrollo"→ "Contribuye al desarrolla"
 *
 * Se excluyen SOLO en la dirección en que la forma ambigua es la ENTRADA. Por
 * ejemplo "apoya" (tercera) no es sustantivo, así que "Apoya a su equipo" →
 * "Apoyo a mi equipo" se sigue convirtiendo bien; lo que se bloquea es la
 * dirección contraria, donde la entrada "apoyo" pudo ser el sustantivo.
 *
 * El criterio es deliberadamente conservador: dejar un verbo sin conjugar
 * produce texto gramatical que el admin corrige de un vistazo, mientras que
 * conjugar un sustantivo produce galimatías. En un fallback best-effort,
 * quedarse corto es siempre mejor que romper.
 */
const AMBIGUOUS_AS_FIRST = new Set([
  'apoyo', 'desarrollo', 'respeto', 'documento', 'motivo', 'logro',
]);
const AMBIGUOUS_AS_THIRD = new Set([
  'ayuda', 'toma', 'mejora', 'entrega', 'escucha',
]);

/**
 * Pronombres y posesivos, primera → tercera persona.
 * `me` NO va acá: es ambiguo (reflexivo "me comunico" → "se comunica" vs.
 * dativo "me da feedback" → "le da feedback") y se resuelve por contexto.
 */
const PRONOUN_FIRST_TO_THIRD: Record<string, string> = {
  mi: 'su', mis: 'sus', mío: 'suyo', mía: 'suya',
  míos: 'suyos', mías: 'suyas', conmigo: 'con esta persona',
  yo: 'esta persona',
};

/**
 * Pronombres y posesivos, tercera → primera persona.
 * `se` NO va acá: reflexivo ("se adapta" → "me adapto") vs. impersonal
 * ("se espera que…", que no debe tocarse). Se resuelve por contexto.
 */
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

/** Aplica el reemplazo preservando la capitalización de la palabra original. */
function keepCase(original: string, replacement: string): string {
  return original[0] === original[0].toUpperCase()
    ? capitalizeFirst(replacement)
    : replacement;
}

/**
 * Convierte el texto entre personas gramaticales mirando el contexto de cada
 * palabra, no solo la palabra suelta.
 *
 * Dos reglas que un reemplazo ciego por diccionario no puede resolver:
 *
 *  1. Formas ambiguas verbo/sustantivo (ver AMBIGUOUS_AS_*): se dejan intactas.
 *  2. Reflexivos `me`/`se`: solo se convierten si la palabra siguiente es un
 *     verbo conocido de la dirección correspondiente. Así "Me comunico" pasa a
 *     "Se comunica" (reflexivo) pero "Me da feedback" pasa a "Le da feedback"
 *     (dativo), y el "se" impersonal de "Se espera que…" no se toca.
 */
function transformWords(text: string, dir: 'firstToThird' | 'thirdToFirst'): string {
  const verbs = dir === 'firstToThird' ? VERB_FIRST_TO_THIRD : VERB_THIRD_TO_FIRST;
  const pronouns = dir === 'firstToThird' ? PRONOUN_FIRST_TO_THIRD : PRONOUN_THIRD_TO_FIRST;
  const ambiguous = dir === 'firstToThird' ? AMBIGUOUS_AS_FIRST : AMBIGUOUS_AS_THIRD;

  // Se tokeniza conservando los separadores para poder mirar la palabra
  // siguiente sin perder la puntuación ni los espacios originales.
  // \p{L} con flag u para que los acentos cuenten como parte de la palabra
  // (evita que "evalúo" matchee como "eval" + "úo").
  const isWord = (t: string) => /^\p{L}+$/u.test(t);
  const tokens = text.match(/\p{L}+|[^\p{L}]+/gu) ?? [];

  /** Palabra siguiente en minúsculas, saltando espacios y puntuación. */
  const nextWord = (i: number): string | null => {
    for (let j = i + 1; j < tokens.length; j++) {
      if (isWord(tokens[j])) return tokens[j].toLowerCase();
    }
    return null;
  };

  return tokens
    .map((token, i) => {
      if (!isWord(token)) return token;
      const lower = token.toLowerCase();

      // Reflexivo vs. dativo/impersonal — decidido por el verbo que sigue.
      if (dir === 'firstToThird' && lower === 'me') {
        const next = nextWord(i);
        return keepCase(token, next && verbs[next] ? 'se' : 'le');
      }
      if (dir === 'thirdToFirst' && lower === 'se') {
        const next = nextWord(i);
        // Sin verbo conocido detrás es probablemente impersonal: no tocar.
        return next && verbs[next] ? keepCase(token, 'me') : token;
      }

      // Forma que también es sustantivo frecuente → se deja como está.
      if (ambiguous.has(lower)) return token;

      const replacement = verbs[lower] ?? pronouns[lower];
      return replacement ? keepCase(token, replacement) : token;
    })
    .join('');
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
    out = transformWords(out, 'thirdToFirst');
    return capitalizeFirst(out.trim());
  }

  // first → third
  out = transformWords(out, 'firstToThird');
  return capitalizeFirst(out.trim());
}

/** Etiqueta legible de una perspectiva (fallback al propio código). */
export function perspectiveLabel(relationType: string): string {
  return PERSPECTIVE_PROFILES[relationType]?.label ?? relationType;
}
