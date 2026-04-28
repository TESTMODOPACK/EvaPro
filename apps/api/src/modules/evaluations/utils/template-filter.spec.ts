/**
 * template-filter.spec.ts — Tests del helper de filtrado por relationType.
 *
 * Cubre los 6 escenarios criticos:
 *   1. Sin applicableTo → aplica a todos (backwards-compat)
 *   2. Pregunta con applicableTo → solo roles incluidos
 *   3. Seccion con applicableTo → toda la seccion excluida si no aplica
 *   4. Seccion sin preguntas aplicables → omitida del output
 *   5. Pregunta + seccion con applicableTo → AND logico (ambos deben aplicar)
 *   6. Edge cases: input null/undefined, sections vacias, etc.
 */
import {
  filterTemplateForRelation,
  getApplicableQuestionIds,
  TemplateSection,
} from './template-filter';

describe('filterTemplateForRelation', () => {
  describe('backwards-compat (sin applicableTo)', () => {
    it('seccion sin applicableTo aplica a todos los relationTypes', () => {
      const sections: TemplateSection[] = [
        { id: 's1', title: 'General', questions: [{ id: 'q1', text: 'pregunta' }] },
      ];
      for (const role of ['self', 'manager', 'peer', 'direct_report', 'external']) {
        const filtered = filterTemplateForRelation(sections, role);
        expect(filtered).toHaveLength(1);
        expect(filtered[0].questions).toHaveLength(1);
      }
    });

    it('preguntas sin applicableTo aplican a todos los roles', () => {
      const sections: TemplateSection[] = [
        {
          id: 's1',
          questions: [
            { id: 'q1' },
            { id: 'q2' },
            { id: 'q3' },
          ],
        },
      ];
      const filtered = filterTemplateForRelation(sections, 'peer');
      expect(filtered[0].questions).toHaveLength(3);
    });

    it('applicableTo array vacio = sin filtro (= aplica a todos)', () => {
      const sections: TemplateSection[] = [
        {
          id: 's1',
          applicableTo: [],
          questions: [{ id: 'q1', applicableTo: [] }],
        },
      ];
      const filtered = filterTemplateForRelation(sections, 'self');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].questions).toHaveLength(1);
    });
  });

  describe('filtrado a nivel pregunta', () => {
    const sections: TemplateSection[] = [
      {
        id: 's1',
        title: 'Mixto',
        questions: [
          { id: 'q1', applicableTo: ['self'] },
          { id: 'q2', applicableTo: ['manager', 'peer'] },
          { id: 'q3', applicableTo: ['direct_report'] },
          { id: 'q4' }, // sin filtro → todos
        ],
      },
    ];

    it('relationType=self → solo q1 + q4 (q4 sin filtro)', () => {
      const filtered = filterTemplateForRelation(sections, 'self');
      expect(filtered[0].questions?.map((q) => q.id)).toEqual(['q1', 'q4']);
    });

    it('relationType=manager → solo q2 + q4', () => {
      const filtered = filterTemplateForRelation(sections, 'manager');
      expect(filtered[0].questions?.map((q) => q.id)).toEqual(['q2', 'q4']);
    });

    it('relationType=peer → solo q2 + q4 (q2 incluye peer en applicableTo)', () => {
      const filtered = filterTemplateForRelation(sections, 'peer');
      expect(filtered[0].questions?.map((q) => q.id)).toEqual(['q2', 'q4']);
    });

    it('relationType=external → solo q4 (sin filtro), nada mas aplica', () => {
      const filtered = filterTemplateForRelation(sections, 'external');
      expect(filtered[0].questions?.map((q) => q.id)).toEqual(['q4']);
    });
  });

  describe('filtrado a nivel seccion', () => {
    const sections: TemplateSection[] = [
      { id: 's1', applicableTo: ['manager', 'direct_report'], questions: [{ id: 'q1' }] },
      { id: 's2', applicableTo: ['self'], questions: [{ id: 'q2' }] },
      { id: 's3', questions: [{ id: 'q3' }] }, // sin filtro
    ];

    it('relationType=manager → s1 + s3 (s2 excluida)', () => {
      const filtered = filterTemplateForRelation(sections, 'manager');
      expect(filtered.map((s) => s.id)).toEqual(['s1', 's3']);
    });

    it('relationType=self → solo s2 + s3', () => {
      const filtered = filterTemplateForRelation(sections, 'self');
      expect(filtered.map((s) => s.id)).toEqual(['s2', 's3']);
    });

    it('relationType=external → solo s3 (sin filtro de seccion)', () => {
      const filtered = filterTemplateForRelation(sections, 'external');
      expect(filtered.map((s) => s.id)).toEqual(['s3']);
    });
  });

  describe('AND logico (seccion + pregunta con applicableTo)', () => {
    const sections: TemplateSection[] = [
      {
        id: 's1',
        applicableTo: ['manager', 'peer'], // seccion solo manager+peer
        questions: [
          { id: 'q1', applicableTo: ['manager'] }, // solo manager
          { id: 'q2', applicableTo: ['peer'] }, // solo peer
          { id: 'q3' }, // sin filtro a nivel pregunta
        ],
      },
    ];

    it('relationType=manager → seccion aplica + q1 + q3 (q2 excluida)', () => {
      const filtered = filterTemplateForRelation(sections, 'manager');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].questions?.map((q) => q.id)).toEqual(['q1', 'q3']);
    });

    it('relationType=peer → seccion aplica + q2 + q3 (q1 excluida)', () => {
      const filtered = filterTemplateForRelation(sections, 'peer');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].questions?.map((q) => q.id)).toEqual(['q2', 'q3']);
    });

    it('relationType=self → seccion ENTERA excluida (no aplica)', () => {
      const filtered = filterTemplateForRelation(sections, 'self');
      expect(filtered).toEqual([]);
    });
  });

  describe('seccion sin preguntas aplicables → omitida', () => {
    it('seccion donde TODAS las preguntas tienen applicableTo que excluye al rol → seccion omitida', () => {
      const sections: TemplateSection[] = [
        {
          id: 's1',
          questions: [
            { id: 'q1', applicableTo: ['manager'] },
            { id: 'q2', applicableTo: ['direct_report'] },
          ],
        },
        {
          id: 's2',
          questions: [{ id: 'q3' }], // sin filtro
        },
      ];
      // Para relationType=self, s1 quedaria sin preguntas → debe omitirse
      const filtered = filterTemplateForRelation(sections, 'self');
      expect(filtered.map((s) => s.id)).toEqual(['s2']);
    });
  });

  describe('edge cases', () => {
    it('input null retorna []', () => {
      expect(filterTemplateForRelation(null, 'self')).toEqual([]);
    });

    it('input undefined retorna []', () => {
      expect(filterTemplateForRelation(undefined, 'self')).toEqual([]);
    });

    it('input array vacio retorna []', () => {
      expect(filterTemplateForRelation([], 'self')).toEqual([]);
    });

    it('seccion sin questions retorna [] (filtrada por estar vacia)', () => {
      const sections: TemplateSection[] = [{ id: 's1' }];
      expect(filterTemplateForRelation(sections, 'self')).toEqual([]);
    });

    it('preserva otros campos de seccion (no muta input)', () => {
      const sections: TemplateSection[] = [
        {
          id: 's1',
          title: 'Test',
          customField: 'preserved',
          questions: [{ id: 'q1' }],
        },
      ];
      const filtered = filterTemplateForRelation(sections, 'self');
      expect(filtered[0].title).toBe('Test');
      expect(filtered[0].customField).toBe('preserved');
    });

    it('NO muta el input original', () => {
      const sections: TemplateSection[] = [
        {
          id: 's1',
          questions: [{ id: 'q1', applicableTo: ['manager'] }, { id: 'q2' }],
        },
      ];
      const before = JSON.stringify(sections);
      filterTemplateForRelation(sections, 'self');
      expect(JSON.stringify(sections)).toBe(before);
    });
  });
});

describe('getApplicableQuestionIds', () => {
  it('retorna IDs de todas las preguntas filtradas', () => {
    const sections: TemplateSection[] = [
      {
        id: 's1',
        questions: [
          { id: 'q1', applicableTo: ['self'] },
          { id: 'q2', applicableTo: ['manager'] },
          { id: 'q3' },
        ],
      },
      {
        id: 's2',
        applicableTo: ['manager'],
        questions: [{ id: 'q4' }],
      },
    ];
    expect(getApplicableQuestionIds(sections, 'manager')).toEqual(['q2', 'q3', 'q4']);
    expect(getApplicableQuestionIds(sections, 'self')).toEqual(['q1', 'q3']);
  });

  it('filtra preguntas sin id', () => {
    const sections: TemplateSection[] = [
      {
        id: 's1',
        questions: [
          { id: 'q1' },
          { text: 'sin id' }, // sin id → debe filtrarse
        ],
      },
    ];
    expect(getApplicableQuestionIds(sections, 'self')).toEqual(['q1']);
  });

  it('input null retorna []', () => {
    expect(getApplicableQuestionIds(null, 'self')).toEqual([]);
  });
});
