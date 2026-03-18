import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // CORS – support comma-separated list of allowed origins via FRONTEND_URL
  // NOTE: credentials:true requires a specific origin (not '*')
  const frontendUrl = process.env.FRONTEND_URL;
  const allowedOrigins = frontendUrl
    ? frontendUrl.split(',').map((u) => u.trim())
    : null;

  app.enableCors({
    origin: allowedOrigins ?? true, // true = reflect request origin (permissive, dev-friendly)
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Global validation pipe – activates class-validator decorators on all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: false, // don't reject unknown – avoids breaking legacy clients
      transform: true, // auto-transform payloads to DTO class instances
    }),
  );

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`API running on port ${port}`);
  console.log(`CORS allowed origins: ${allowedOrigins ? allowedOrigins.join(', ') : 'all (reflect)'}`);
}
void bootstrap();
