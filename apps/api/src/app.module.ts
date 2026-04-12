import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { pinoLoggerConfig } from './common/logger/pino-logger.config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { EvaluationsModule } from './modules/evaluations/evaluations.module';
import { TemplatesModule } from './modules/templates/templates.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { ObjectivesModule } from './modules/objectives/objectives.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { TalentModule } from './modules/talent/talent.module';
import { DevelopmentModule } from './modules/development/development.module';
import { OrgDevelopmentModule } from './modules/org-development/org-development.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { AiInsightsModule } from './modules/ai-insights/ai-insights.module';
import { RecognitionModule } from './modules/recognition/recognition.module';
import { DeiModule } from './modules/dei/dei.module';
import { SystemModule } from './modules/system/system.module';
import { RecruitmentModule } from './modules/recruitment/recruitment.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { HealthModule } from './modules/health/health.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Sentry — debe ir primero (ademas del import de instrument.ts en
    // main.ts) para que los tracing hooks registren los controllers/
    // services de TODOS los modulos de abajo. Si SENTRY_DSN no esta
    // seteado, el init() es no-op y SentryModule queda pasivo.
    SentryModule.forRoot(),
    // Logger estructurado (pino) — debe ir ANTES de cualquier modulo que
    // use `@InjectPinoLogger` o `new Logger()`. Provee un Logger global
    // que reemplaza al default de Nest.
    LoggerModule.forRoot(pinoLoggerConfig),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    EvaluationsModule,
    TemplatesModule,
    AuditModule,
    ReportsModule,
    NotificationsModule,
    FeedbackModule,
    ObjectivesModule,
    SubscriptionsModule,
    TalentModule,
    DevelopmentModule,
    OrgDevelopmentModule,
    UploadsModule,
    AiInsightsModule,
    RecognitionModule,
    DeiModule,
    SystemModule,
    RecruitmentModule,
    SignaturesModule,
    SurveysModule,
    ContractsModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // SentryGlobalFilter atrapa TODAS las excepciones no-manejadas y las
    // reporta a Sentry. Se registra como APP_FILTER para que corra al
    // final de la cadena de filters. Ya esta configurado con la
    // whitelist de ignoreErrors en instrument.ts, asi que los 4xx de
    // cliente (BadRequest, NotFound, Unauthorized, Forbidden, Conflict)
    // se filtran antes de llegar a Sentry.
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
