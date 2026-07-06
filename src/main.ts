import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  app.setGlobalPrefix('api/v1');

  // ─── Swagger / OpenAPI ──────────────────────────────────────────────────────
  const swaggerConfig = new DocumentBuilder()
    .setTitle('PulseMFB External API')
    .setDescription(
      'B2B Banking-as-a-Service API. ' +
        'Read endpoints require **x-api-key**. ' +
        'Write endpoints require **x-public-key**, **x-signature** (HMAC-SHA256), and **x-timestamp**.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'ApiKey')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-public-key' }, 'HmacPublicKey')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-signature' }, 'HmacSignature')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-timestamp' }, 'HmacTimestamp')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Available at /docs — outside the api/v1 global prefix
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`PulseMFB API running on port ${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/docs`);
}
bootstrap();
