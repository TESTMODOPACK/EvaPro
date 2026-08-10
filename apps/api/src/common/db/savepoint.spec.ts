/**
 * savepoint.spec.ts — Contrato del helper que aísla trabajo opcional
 * dentro de un SAVEPOINT para que no rompa la transacción del request.
 */
import { Logger } from '@nestjs/common';
import { inSavepoint } from './savepoint';

describe('inSavepoint', () => {
  /** Manager falso: `transaction(cb)` ejecuta el callback como haría TypeORM. */
  const makeManager = () =>
    ({
      transaction: jest.fn(async (cb: any) => cb({ marker: 'nested-manager' })),
    } as any);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.clearAllMocks());

  it('devuelve el resultado del trabajo cuando todo sale bien', async () => {
    const manager = makeManager();
    const result = await inSavepoint(manager, async () => 42, { fallback: 0 });

    expect(result).toBe(42);
    expect(manager.transaction).toHaveBeenCalledTimes(1);
  });

  it('ejecuta el trabajo SIEMPRE dentro de la transacción anidada (savepoint)', async () => {
    const manager = makeManager();
    const work = jest.fn(async () => 'ok');

    await inSavepoint(manager, work, { fallback: null });

    // Recibe el manager anidado, no el externo — así la query participa
    // del savepoint y no de la transacción principal.
    expect(work).toHaveBeenCalledWith({ marker: 'nested-manager' });
  });

  it('devuelve el fallback si el trabajo falla, sin propagar el error', async () => {
    const manager = makeManager();

    const result = await inSavepoint(
      manager,
      async () => {
        throw new Error('relation "foo" does not exist');
      },
      { fallback: [] as string[] },
    );

    expect(result).toEqual([]);
  });

  it('no propaga aunque falle la transacción entera (savepoint no disponible)', async () => {
    const manager = {
      transaction: jest.fn(async () => {
        throw new Error('savepoint failed');
      }),
    } as any;

    await expect(
      inSavepoint(manager, async () => 'x', { fallback: 'fb' }),
    ).resolves.toBe('fb');
  });

  it('loguea el fallo con contexto cuando se pasa un logger', async () => {
    const manager = makeManager();
    const logger = new Logger('Test');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    await inSavepoint(
      manager,
      async () => {
        throw new Error('boom');
      },
      { fallback: 0, logger, context: 'uso de departamento' },
    );

    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain('uso de departamento');
    expect(msg).toContain('boom');
  });

  it('sin logger falla en silencio pero igual devuelve el fallback', async () => {
    const manager = makeManager();
    await expect(
      inSavepoint(manager, async () => { throw new Error('x'); }, { fallback: 'safe' }),
    ).resolves.toBe('safe');
  });

  it('soporta fallback tipado complejo', async () => {
    const manager = makeManager();
    const fallback = { rows: [] as number[], total: 0 };

    const result = await inSavepoint(
      manager,
      async () => { throw new Error('fail'); },
      { fallback },
    );

    expect(result).toBe(fallback);
  });
});
