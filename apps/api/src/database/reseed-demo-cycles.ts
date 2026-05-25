/**
 * reseed-demo-cycles.ts — Orquestador de limpieza + reseed para Demo Company.
 *
 * Genera un pool de 4 ciclos demo (uno por cycleType: 90/180/270/360) sobre
 * el tenant DEMO Company, usando las plantillas existentes y la TAXONOMÍA
 * NUEVA (convención estándar mayo 2026):
 *   - 90°  → solo manager
 *   - 180° → manager + self
 *   - 270° → manager + self + peer
 *   - 360° → manager + self + peer + direct_report (+ etapa calibración)
 *
 * Es la sucesora de `seed-demo-evaluations.ts` post-realineamiento:
 *   1. Limpia TODO el dato relacionado a ciclos del tenant DEMO
 *      (delegando al SQL `sql/clear-demo-company-evaluations.sql`).
 *   2. Re-ejecuta `seed-demo-evaluations.ts` que ya está actualizado a
 *      la nueva taxonomía y genera 4 ciclos closed con respuestas
 *      sintéticas + assignments + stages alineados.
 *
 * Uso (local dev):
 *   pnpm --filter @repo/api exec ts-node \
 *     -r tsconfig-paths/register \
 *     apps/api/src/database/reseed-demo-cycles.ts
 *
 * Uso (producción / VPS):
 *   docker compose exec api node dist/database/reseed-demo-cycles.js
 *
 * Variables de entorno:
 *   DATABASE_URL  — obligatoria
 *   DRY_RUN=true  — solo lista qué borraría, no ejecuta cambios
 *
 * NO REQUIERE INTERACCIÓN — está pensado para correr post-deploy del
 * realineamiento taxonomía. Idempotente: si el tenant no existe, abort.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const DATABASE_URL = process.env.DATABASE_URL;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL no está seteada. Abortando.');
  process.exit(1);
}

async function runClearSql(ds: DataSource): Promise<void> {
  // El SQL DO $$ ... $$ block no puede dividirse en statements; lo enviamos
  // como un único query. `clear-demo-company-evaluations.sql` usa \echo y
  // RAISE NOTICE — funciona con `ds.query()` que pasa el string directo a
  // node-postgres, que sí soporta multi-statement queries con DO blocks.
  const sqlPath = join(__dirname, 'sql', 'clear-demo-company-evaluations.sql');
  let sql = readFileSync(sqlPath, 'utf8');

  // Quitar líneas \echo (psql-only meta-commands; node-postgres no las parsea).
  sql = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('\\echo'))
    .join('\n');

  console.log('━━━ Paso 1/2: Limpieza de ciclos existentes ━━━');
  if (DRY_RUN) {
    console.log('  [DRY_RUN] Se ejecutaría el SQL de clear (no se hacen cambios).');
    return;
  }

  // RAISE NOTICE se imprime vía pg client notices; capturamos via listener.
  const pgClient = (ds.driver as any).master;
  if (pgClient && typeof pgClient.on === 'function') {
    pgClient.on('notice', (n: any) => console.log(`  ${n.message}`));
  }

  await ds.query(sql);
  console.log('  ✅ Limpieza completada.\n');
}

async function runSeed(): Promise<void> {
  console.log('━━━ Paso 2/2: Reseed con taxonomía nueva ━━━');
  if (DRY_RUN) {
    console.log('  [DRY_RUN] Se ejecutaría seed-demo-evaluations.ts (no se hacen cambios).');
    return;
  }

  // Invocar el seed como subproceso para garantizar aislamiento de
  // conexión / contexto (cada script abre su propia DataSource). Esto
  // evita race conditions con RLS context, pool exhaustion, y deja
  // el output del seed en stdout sin mezclar con el del clear.
  const seedScript = join(__dirname, 'seed-demo-evaluations.ts');
  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['ts-node', '-r', 'tsconfig-paths/register', seedScript],
    {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL },
    },
  );

  if (result.status !== 0) {
    throw new Error(`seed-demo-evaluations.ts falló con código ${result.status}`);
  }
  console.log('  ✅ Reseed completado.\n');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  Reseed ciclos DEMO Company — alineamiento taxonomía mayo 2026');
  console.log('═══════════════════════════════════════════════════════════════════');
  if (DRY_RUN) {
    console.log('  ⚠️  MODO DRY_RUN — no se harán cambios en la BD.');
  }
  console.log();

  const ds = new DataSource({
    type: 'postgres',
    url: DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production' && process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false }
        : false,
    synchronize: false,
    logging: false,
    extra: { max: 1 },
  });

  await ds.initialize();
  console.log('✓ Conectado a la base de datos\n');

  try {
    // ── Pre-check: verificar que existe el tenant DEMO ───────────────
    const tenantRow = await ds.query(
      `SELECT id, name FROM tenants WHERE slug = 'demo' OR name ILIKE '%demo%company%' OR name ILIKE 'demo company' LIMIT 1`,
    );
    if (!tenantRow.length) {
      console.error('✗ Tenant DEMO Company no encontrado. Abortando.');
      console.error('  (Buscado por slug=demo o name ILIKE demo%company%)');
      process.exit(1);
    }
    console.log(`✓ Tenant encontrado: ${tenantRow[0].name} (${tenantRow[0].id})\n`);

    await runClearSql(ds);
    await ds.destroy(); // cerrar conexión antes del subprocess seed
    await runSeed();

    console.log('═══════════════════════════════════════════════════════════════════');
    console.log('  ✅ Reseed completado — ciclos DEMO regenerados con taxonomía nueva');
    console.log('═══════════════════════════════════════════════════════════════════');
  } catch (err: any) {
    console.error('\n✗ Error durante reseed:', err.message || err);
    if (ds.isInitialized) await ds.destroy();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
