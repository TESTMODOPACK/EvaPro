/**
 * perspective-mirror.spec.ts — Tests de la transformación determinística
 * de perspectiva (fallback cuando la IA no está disponible).
 *
 * Cubre los casos que el motor de reglas SÍ garantiza y documenta los
 * límites conocidos (third→third no se transforma).
 */
import { RelationType } from '../../evaluations/entities/evaluation-assignment.entity';
import {
  PERSPECTIVE_PROFILES,
  perspectiveLabel,
  transformQuestionByRules,
} from './perspective-mirror';

const { MANAGER, SELF, PEER, DIRECT_REPORT } = RelationType;

describe('transformQuestionByRules', () => {
  describe('tercera → primera persona (jefatura → autoevaluación)', () => {
    it('conjuga el verbo principal', () => {
      expect(
        transformQuestionByRules('Demuestra liderazgo de forma consistente', MANAGER, SELF),
      ).toBe('Demuestro liderazgo de forma consistente');
    });

    it('quita el sujeto explícito "El colaborador"', () => {
      expect(
        transformQuestionByRules('El colaborador cumple con los plazos acordados', MANAGER, SELF),
      ).toBe('Cumplo con los plazos acordados');
    });

    it('quita el sujeto "Esta persona" y conjuga', () => {
      expect(
        transformQuestionByRules('Esta persona comparte su conocimiento', MANAGER, SELF),
      ).toBe('Comparto mi conocimiento');
    });

    it('convierte posesivos de tercera a primera', () => {
      expect(
        transformQuestionByRules('Mantiene sus compromisos con su equipo', MANAGER, SELF),
      ).toBe('Mantengo mis compromisos con mi equipo');
    });

    it('maneja verbos irregulares del diccionario', () => {
      expect(transformQuestionByRules('Tiene una actitud proactiva', MANAGER, SELF)).toBe(
        'Tengo una actitud proactiva',
      );
      expect(transformQuestionByRules('Resuelve problemas complejos', MANAGER, SELF)).toBe(
        'Resuelvo problemas complejos',
      );
    });

    it('preserva el resto de la frase sin tocar', () => {
      expect(
        transformQuestionByRules(
          'Comunica las prioridades del equipo de forma clara',
          MANAGER,
          SELF,
        ),
      ).toBe('Comunico las prioridades del equipo de forma clara');
    });
  });

  describe('primera → tercera persona (autoevaluación → jefatura)', () => {
    it('conjuga el verbo principal', () => {
      expect(
        transformQuestionByRules('Demuestro liderazgo de forma consistente', SELF, MANAGER),
      ).toBe('Demuestra liderazgo de forma consistente');
    });

    it('convierte posesivos de primera a tercera', () => {
      expect(
        transformQuestionByRules('Mantengo mis compromisos con mi equipo', SELF, MANAGER),
      ).toBe('Mantiene sus compromisos con su equipo');
    });

    it('es reversible en frases cubiertas por el diccionario', () => {
      const original = 'Comparte sus conocimientos con el equipo';
      const toSelf = transformQuestionByRules(original, MANAGER, SELF);
      const backToManager = transformQuestionByRules(toSelf, SELF, MANAGER);
      expect(backToManager).toBe(original);
    });
  });

  describe('límites conocidos y casos borde', () => {
    it('third → third devuelve el texto intacto (requiere IA para reencuadrar)', () => {
      const text = 'Demuestra liderazgo de forma consistente';
      expect(transformQuestionByRules(text, MANAGER, PEER)).toBe(text);
      expect(transformQuestionByRules(text, MANAGER, DIRECT_REPORT)).toBe(text);
      expect(transformQuestionByRules(text, PEER, DIRECT_REPORT)).toBe(text);
    });

    it('misma perspectiva devuelve el texto intacto', () => {
      const text = 'Demuestra liderazgo';
      expect(transformQuestionByRules(text, MANAGER, MANAGER)).toBe(text);
    });

    it('texto vacío o solo espacios no rompe', () => {
      expect(transformQuestionByRules('', MANAGER, SELF)).toBe('');
      expect(transformQuestionByRules('   ', MANAGER, SELF)).toBe('   ');
    });

    it('verbos fuera del diccionario se dejan intactos (no inventa)', () => {
      // "prototipa" no está en el diccionario → se preserva tal cual.
      const out = transformQuestionByRules('Prototipa soluciones técnicas', MANAGER, SELF);
      expect(out).toBe('Prototipa soluciones técnicas');
    });

    it('respeta acentos al reemplazar palabras completas', () => {
      // "evalúa" debe matchear entero, no partirse en "eval" + "úa".
      expect(transformQuestionByRules('Evalúa riesgos antes de decidir', MANAGER, SELF)).toBe(
        'Evalúo riesgos antes de decidir',
      );
    });

    it('preserva la capitalización inicial', () => {
      const out = transformQuestionByRules('Apoya al equipo', MANAGER, SELF);
      expect(out[0]).toBe(out[0].toUpperCase());
    });

    it('no altera palabras que solo contienen un verbo como substring', () => {
      // "Ofrece" → "ofrezco", pero "ofrecen" (plural) NO debe transformarse.
      expect(transformQuestionByRules('Los equipos ofrecen apoyo', MANAGER, SELF)).toBe(
        'Los equipos ofrecen apoyo',
      );
    });
  });
});

describe('PERSPECTIVE_PROFILES', () => {
  it('define las 4 perspectivas principales del ciclo', () => {
    for (const rel of [MANAGER, SELF, PEER, DIRECT_REPORT]) {
      expect(PERSPECTIVE_PROFILES[rel]).toBeDefined();
      expect(PERSPECTIVE_PROFILES[rel].label).toBeTruthy();
      expect(PERSPECTIVE_PROFILES[rel].aiInstruction).toBeTruthy();
    }
  });

  it('solo la autoevaluación usa primera persona', () => {
    expect(PERSPECTIVE_PROFILES[SELF].voice).toBe('first');
    expect(PERSPECTIVE_PROFILES[MANAGER].voice).toBe('third');
    expect(PERSPECTIVE_PROFILES[PEER].voice).toBe('third');
    expect(PERSPECTIVE_PROFILES[DIRECT_REPORT].voice).toBe('third');
  });
});

describe('perspectiveLabel', () => {
  it('devuelve la etiqueta legible', () => {
    expect(perspectiveLabel(MANAGER)).toBe('Jefatura');
    expect(perspectiveLabel(SELF)).toBe('Autoevaluación');
  });

  it('cae al propio código si el rol es desconocido', () => {
    expect(perspectiveLabel('inexistente')).toBe('inexistente');
  });
});
