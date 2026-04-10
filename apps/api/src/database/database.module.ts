import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

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
        return {
          type: 'postgres',
          url: configService.get<string>('DATABASE_URL'),
          autoLoadEntities: true,
          synchronize,
          // SSL: enabled for Render, disabled for Docker (DB_SSL=false)
          ssl: isProduction && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}

