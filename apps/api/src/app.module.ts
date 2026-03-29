import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
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
import { PostulantsModule } from './modules/postulants/postulants.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
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
    PostulantsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
})
export class AppModule {}
