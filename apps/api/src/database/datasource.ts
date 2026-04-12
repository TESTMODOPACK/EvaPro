/**
 * datasource.ts — DataSource standalone para el TypeORM CLI.
 *
 * Este archivo se usa SOLO por el CLI de TypeORM (migration:generate,
 * migration:run, migration:revert). No se usa en el runtime de NestJS
 * (que tiene su propio DataSource via TypeOrmModule.forRootAsync).
 *
 * Lee DATABASE_URL del .env o de la variable de entorno directa.
 *
 * Uso:
 *   npx typeorm-ts-node-commonjs migration:generate src/database/migrations/MyMigration -d src/database/datasource.ts
 *   npx typeorm-ts-node-commonjs migration:run -d src/database/datasource.ts
 *   npx typeorm-ts-node-commonjs migration:revert -d src/database/datasource.ts
 *
 * O via los scripts de package.json:
 *   npm run migration:generate -- src/database/migrations/MyMigration
 *   npm run migration:run
 *   npm run migration:revert
 */
import { DataSource } from 'typeorm';
import * as path from 'path';

// Cargar .env si existe (para dev local). En Docker/Render la variable
// ya esta en el entorno.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
} catch {
  // dotenv not installed or .env not found — use env vars directly
}

const isProduction = process.env.NODE_ENV === 'production';
const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('DATABASE_URL is not set. Cannot run migrations.');
  process.exit(1);
}

export default new DataSource({
  type: 'postgres',
  url: dbUrl,
  ssl: isProduction && process.env.DB_SSL !== 'false'
    ? { rejectUnauthorized: false }
    : false,
  // En modo CLI, TypeORM necesita las entidades para comparar el schema.
  // Usamos glob pattern que cubre TODOS los entity files.
  entities: [path.join(__dirname, '../modules/**/entities/*.entity.{ts,js}')],
  // Carpeta donde se generan y leen las migraciones.
  migrations: [path.join(__dirname, 'migrations/*.{ts,js}')],
  // No sincronizar — las migraciones son el unico mecanismo de cambio
  // de schema permitido (el motivo por el que creamos este archivo).
  synchronize: false,
  // Logging de queries de migracion para debug
  logging: ['query', 'error'],
});
