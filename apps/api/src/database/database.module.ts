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
        return {
          type: 'postgres',
          url: configService.get<string>('DATABASE_URL'),
          autoLoadEntities: true,
          // DB_SYNC=true on first deploy to create tables; remove after initial setup
          synchronize: !isProduction || process.env.DB_SYNC === 'true',
          // SSL: enabled for Render, disabled for Docker (DB_SSL=false)
          ssl: isProduction && process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}

