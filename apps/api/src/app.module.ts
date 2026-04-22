import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { pinoLoggerConfig } from './common/logger/pino-logger.config';
import { PrometheusMiddleware } from './common/middleware/prometheus.middleware';
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
import { TeamMeetingsModule } from './modules/team-meetings/team-meetings.module';
import { MoodCheckinsModule } from './modules/mood-checkins/mood-checkins.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { UnsubscribeModule } from './modules/unsubscribe/unsubscribe.module';
import { GdprModule } from './modules/gdpr/gdpr.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { LeadsModule } from './modules/leads/leads.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { SystemErrorAuditInterceptor } from './common/interceptors/system-error-audit.interceptor';
import { NoImpersonationGuard } from './common/guards/no-impersonation.guard';

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
    // Prometheus metrics — expone /metrics con metricas default (CPU,
    // memoria, event loop, GC) + custom (http requests, duration).
    // Protegido: solo accesible desde localhost / red interna (Nginx
    // no expone /metrics al exterior). Para Grafana Cloud, configurar
    // un scraper apuntando a la IP interna del container.
    PrometheusModule.register({
      defaultMetrics: { enabled: true },
      path: '/metrics',
    }),
    // Cache in-memory global — TTL por defecto 5 min (300s). Usado por
    // servicios para cachear lookups que cambian raramente (planes,
    // tenants, competencias, badges). En Fase 3 se puede migrar a Redis
    // cambiando solo el store aqui. isGlobal: true permite inyectar
    // CACHE_MANAGER en cualquier servicio sin importar el modulo.
    CacheModule.register({
      isGlobal: true,
      ttl: 5 * 60 * 1000, // 5 minutos default en milisegundos (cache-manager v6 memory store usa ms)
      max: 500, // max 500 items en memoria (~2MB estimado)
    }),
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
    TeamMeetingsModule,
    MoodCheckinsModule,
    SignaturesModule,
    SurveysModule,
    ContractsModule,
    HealthModule,
    MetricsModule,
    UnsubscribeModule,
    GdprModule,
    PaymentsModule,
    LeadsModule,
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
    // AuditInterceptor — escribe al audit_log para endpoints con @Audited().
    // Solo actua sobre handlers que tienen el decorator; los demas pasan
    // sin costo. Fire-and-forget: no bloquea la respuesta.
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // SystemErrorAuditInterceptor — captura excepciones 5xx / no-HTTP y
    // las registra como 'system.error' en el audit log. Complementa a
    // Sentry (que reporta al dashboard externo) dejando rastro interno
    // para búsqueda forense desde el módulo de Auditoría.
    {
      provide: APP_INTERCEPTOR,
      useClass: SystemErrorAuditInterceptor,
    },
    // NoImpersonationGuard — global guard that enforces the @NoImpersonation()
    // metadata on security-sensitive handlers. It's a no-op for endpoints
    // without the decorator, so the perf cost is negligible.
    {
      provide: APP_GUARD,
      useClass: NoImpersonationGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Metricas HTTP Prometheus globales — counter de requests + histogram
    // de latencia por ruta normalizada. Excluye /health y /metrics.
    consumer.apply(PrometheusMiddleware).forRoutes('*');
  }
}
