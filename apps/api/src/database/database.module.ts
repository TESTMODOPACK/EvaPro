import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

const logger = new Logger('DatabaseModule');

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isProduction = process.env.NODE_ENV === 'production';
        // SECURITY: `synchronize` auto-rewrites the schema from entity metadata
        // on startup. Enabling it in production silently drops columns, breaks
        // constraints, and loses data on any entity change. It is therefore
        // permanently disabled in production — use proper migrations instead.
        // Dev/test may still use synchronize for convenience.
        const synchronize = !isProduction;

        // ─── Connection pool ──────────────────────────────────────────
        // Configurable via env vars para ajustar sin rebuild.
        //
        // Defaults pensados para un VPS de 2-4 GB con Postgres local:
        //   max: 20  — suficiente para ~200 usuarios concurrentes sin
        //              saturar un Postgres starter (100 max_connections).
        //   min: 2   — mantener al menos 2 conexiones calientes para
        //              evitar el cold-start en requests esporadicos.
        //
        // Render Postgres starter tiene max_connections=100 compartido
        // entre todos los servicios. 20 conexiones para el API deja
        // margen para conexiones de monitoreo, seeds, migrations, etc.
        //
        // connectTimeoutMS: 5s — si Postgres no responde en 5s,
        //   el request falla con error en vez de colgarse 30s (default).
        //
        // idleTimeoutMillis: 30s — conexiones inactivas se devuelven
        //   al pool despues de 30s. Evita acumulacion de conexiones
        //   idle que cuentan contra max_connections de Postgres.
        //
        // poolErrorHandler: loguea cuando el pool se agota (todas las
        //   conexiones ocupadas y un nuevo request queda esperando).
        //   Sin esto, el timeout se confunde con "Postgres lento".
        const poolMaxRaw = parseInt(process.env.DB_POOL_MAX || (isProduction ? '20' : '10'), 10);
        const poolMinRaw = parseInt(process.env.DB_POOL_MIN || '2', 10);
        const poolMax = Number.isFinite(poolMaxRaw) && poolMaxRaw > 0 ? poolMaxRaw : 20;
        const poolMin = Number.isFinite(poolMinRaw) && poolMinRaw >= 0 ? poolMinRaw : 2;

        logger.log(
          `Pool config: max=${poolMax}, min=${poolMin}, ` +
          `connectTimeout=5s, idleTimeout=30s, env=${isProduction ? 'production' : 'development'}`,
        );

        return {
          type: 'postgres',
          url: configService.get<string>('DATABASE_URL'),
          autoLoadEntities: true,
          synchronize,
          // SSL: enabled for Render, disabled for Docker (DB_SSL=false)
          ssl: isProduction && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
          // Pool settings — pg driver (node-postgres) options
          extra: {
            // Max connections in the pool
            max: poolMax,
            // Min connections to keep idle (warm)
            min: poolMin,
            // Time to wait for a connection before throwing error (ms)
            connectionTimeoutMillis: 5000,
            // Time a connection can sit idle before being closed (ms)
            idleTimeoutMillis: 30000,
            // Allow the pool to exit cleanly when Node shuts down
            // (complementa enableShutdownHooks de main.ts)
            allowExitOnIdle: true,
          },
          // ─── Query logging ──────────────────────────────────────────
          // En dev: log de todas las queries (util para detectar N+1).
          // En prod: desactivado — las queries lentas se detectan via
          //   maxQueryExecutionTime (TypeORM loguea un warning con el
          //   SQL completo + duracion cuando excede el threshold).
          //   Errores de pool (connection refused, timeout) los captura
          //   Sentry via el exception handler global.
          //
          // NOTA: no usamos `logger: 'advanced-console'` porque TypeORM
          // usa su propio console.log interno, no el Logger de NestJS/
          // pino. Eso contamina el output JSON en prod.
          logging: !isProduction ? ['query'] : false,
          maxQueryExecutionTime: isProduction ? 3000 : 1000,
        };
      },
    }),
  ],
})
export class DatabaseModule {}

