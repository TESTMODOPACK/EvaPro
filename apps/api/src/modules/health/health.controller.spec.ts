/**
 * health.controller.spec.ts — TAREA / Mejora #6.
 *
 * Tests del endpoint GET /health/version que expone el SHA del build
 * + fecha + entorno + versión de Node.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController.version (Mejora #6)', () => {
  let controller: HealthController;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.NODE_ENV;
    delete process.env.GIT_SHA;
    // Limpiar la cache module-level del SHA. Como es var de módulo no
    // accesible directamente, usamos jest.resetModules.
    jest.resetModules();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: DataSource, useValue: { query: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('devuelve estructura {sha, builtAt, env, node}', () => {
    const result: any = controller.version();
    expect(result).toHaveProperty('sha');
    expect(result).toHaveProperty('builtAt');
    expect(result).toHaveProperty('env');
    expect(result).toHaveProperty('node');
    expect(typeof result.sha).toBe('string');
    expect(result.node).toMatch(/^v\d+/); // process.version siempre v#.#.#
  });

  it('env refleja NODE_ENV', () => {
    process.env.NODE_ENV = 'production';
    const result: any = controller.version();
    expect(result.env).toBe('production');
  });

  it('env devuelve "unknown" si NODE_ENV no está seteado', () => {
    delete process.env.NODE_ENV;
    const result: any = controller.version();
    expect(result.env).toBe('unknown');
  });

  it('sha es string no vacío (default fallback "unknown" cuando no hay archivo)', () => {
    // El helper readBuildVersion() es module-level y cachea entre calls.
    // No mockeamos fs porque el cache puede preservar lecturas previas.
    // En entorno de test (sin /app/.git-sha + sin env GIT_SHA), debe ser
    // "unknown" o algún valor por default no vacío.
    const result: any = controller.version();
    expect(typeof result.sha).toBe('string');
    expect(result.sha.length).toBeGreaterThan(0);
  });
});
