/**
 * expected-tenant-tables.spec.ts — Valida la integridad de las dos
 * listas baseline (con/sin tenant_id) sin necesitar BD real.
 *
 * Tests del validador `validateTenantSchemaDrift()` que SI usan BD
 * van a Fase A1.5 (cuando se levante una BD test). Estos son lint-style
 * sobre las listas hardcodeadas.
 */
import {
  EXPECTED_TENANT_TABLES,
  ALLOWED_NO_TENANT_TABLES,
  formatSchemaDriftReport,
} from './expected-tenant-tables';

describe('EXPECTED_TENANT_TABLES baseline', () => {
  it('contiene exactamente 68 tablas con tenant_id (snapshot al 2026-04-27)', () => {
    // Si este conteo cambia → alguien agrego/quito una tabla. Update
    // baseline + verifica drift contra BD real con el SQL audit.
    // 67 → 68: agregada `ai_call_logs` (audit trail de llamadas a Anthropic).
    expect(EXPECTED_TENANT_TABLES.length).toBe(68);
  });

  it('no tiene duplicados', () => {
    const set = new Set(EXPECTED_TENANT_TABLES);
    expect(set.size).toBe(EXPECTED_TENANT_TABLES.length);
  });

  it('esta ordenada alfabeticamente (mantiene el diff git limpio)', () => {
    const sorted = [...EXPECTED_TENANT_TABLES].sort();
    expect(EXPECTED_TENANT_TABLES).toEqual(sorted);
  });

  it('todas las tablas usan snake_case (convencion Postgres)', () => {
    const camelCase = EXPECTED_TENANT_TABLES.filter((t) => /[A-Z]/.test(t));
    expect(camelCase).toEqual([]);
  });

  it('contiene tablas core (sanity check)', () => {
    // Si alguna falta, es bug grave en la generacion del baseline.
    const core = [
      'users',
      'evaluation_assignments',
      'evaluation_responses',
      'evaluation_cycles',
      'objectives',
      'feedback_checkins'.replace('feedback_', ''), // → checkins
      'audit_logs',
    ];
    core.forEach((t) => {
      expect(EXPECTED_TENANT_TABLES).toContain(t);
    });
  });
});

describe('ALLOWED_NO_TENANT_TABLES baseline', () => {
  it('no se solapa con EXPECTED_TENANT_TABLES (mutuamente excluyentes)', () => {
    const overlap = ALLOWED_NO_TENANT_TABLES.filter((t) =>
      EXPECTED_TENANT_TABLES.includes(t as any),
    );
    expect(overlap).toEqual([]);
  });

  it('no tiene duplicados', () => {
    const set = new Set(ALLOWED_NO_TENANT_TABLES);
    expect(set.size).toBe(ALLOWED_NO_TENANT_TABLES.length);
  });

  it('contiene la tabla raiz `tenants`', () => {
    expect(ALLOWED_NO_TENANT_TABLES).toContain('tenants');
  });

  it('contiene tablas de TypeORM infraestructura', () => {
    expect(ALLOWED_NO_TENANT_TABLES).toContain('migrations');
    expect(ALLOWED_NO_TENANT_TABLES).toContain('typeorm_metadata');
  });
});

describe('formatSchemaDriftReport', () => {
  it('reporta "alineado" cuando no hay drift', () => {
    const out = formatSchemaDriftReport({
      missingFromBaseline: [],
      removedFromDatabase: [],
      suspiciousNoTenant: [],
    });
    expect(out).toContain('alineado');
  });

  it('reporta missingFromBaseline con detalle por tabla', () => {
    const out = formatSchemaDriftReport({
      missingFromBaseline: ['new_secret_table'],
      removedFromDatabase: [],
      suspiciousNoTenant: [],
    });
    expect(out).toContain('drift');
    expect(out).toContain('new_secret_table');
    expect(out).toContain('faltan en EXPECTED_TENANT_TABLES');
  });

  it('reporta suspiciousNoTenant con flag explicativo', () => {
    const out = formatSchemaDriftReport({
      missingFromBaseline: [],
      removedFromDatabase: [],
      suspiciousNoTenant: ['orphan_table'],
    });
    expect(out).toContain('orphan_table');
    expect(out).toContain('SIN tenant_id');
  });

  it('combina los 3 tipos de drift en un solo reporte', () => {
    const out = formatSchemaDriftReport({
      missingFromBaseline: ['a'],
      removedFromDatabase: ['b'],
      suspiciousNoTenant: ['c'],
    });
    expect(out).toContain('a');
    expect(out).toContain('b');
    expect(out).toContain('c');
  });
});
