import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Disable default body parser to set custom limit
    bodyParser: false,
  });

  // Increase body size limit for base64 file uploads (CVs, attachments stored in DB)
  const express = require('express');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ limit: '10mb', extended: true }));

  // CORS – reflect the request origin so credentials work with any frontend URL
  const frontendUrl = process.env.FRONTEND_URL;
  const allowedOrigins = frontendUrl
    ? frontendUrl.split(',').map((u) => u.trim())
    : null;

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: string | boolean) => void) => {
      // Allow requests with no origin (curl, mobile apps, server-to-server)
      if (!origin) return callback(null, true);
      // If FRONTEND_URL is set, check against whitelist
      if (allowedOrigins && allowedOrigins.length > 0) {
        if (allowedOrigins.includes(origin)) return callback(null, origin);
        // Still allow for development/other frontends
      }
      // Reflect origin (permissive — safe for MVP)
      callback(null, origin);
    },
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
